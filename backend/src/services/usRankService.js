import * as repo from '../repositories/usRankRepository.js';
import * as autoTradingRepo from '../repositories/autoTradingRepository.js';
import { KisTradingService, maskPayload } from './kisTradingService.js';
import { getValidAccessToken } from './kisTokenManager.js';
import { getOverseasFluctuationRanking } from './marketDataService.js';
import {
  DEFAULT_FORCE_CLOSE_KST,
  DEFAULT_STOP_LOSS_RATE,
  DEFAULT_TARGET_PROFIT_RATE,
  computeBuyQuantity,
  computeCycleProfitRate,
  etTradeDate,
  evaluateSell,
  isUsForceCloseTime,
  isUsRegularSession,
  kstNowMinutes,
  makeUsRankIdempotencyKey,
  parseHhmmMinutes,
  selectRankingCandidate
} from './usRankStrategyEngine.js';

const LOCK_KEY = 'evaluate';
const RANKING_SNAPSHOT_SIZE = 10;
const ORDER_RETRY_LIMIT = 5;
// 미국은 시장가가 없어 현재가 지정가로 매수한다. 급등주가 호가를 위로 이탈하면 체결이 안 될 수 있는데,
// 미체결 주문을 취소·재시도하지 않으면 그날 내내 멈춘다(진입 구간이 없어 종일 막힘).
// 매수 주문이 이 시간(ms)을 넘겨도 체결되지 않으면 취소하고 이번 매매를 접어 다음 후보로 넘어간다.
const BUY_STALE_LIMIT_MS = 3 * 60 * 1000;

export function createStrategy(userId, input) {
  return repo.createStrategy(userId, normalizeStrategyInput(input));
}

export function listStrategies(userId) {
  return repo.listStrategies(userId);
}

export function getStrategy(userId, id) {
  return requireStrategy(userId, id);
}

export function updateStrategy(userId, id, input) {
  requireStrategy(userId, id);
  return repo.updateStrategy(userId, id, normalizeStrategyInput(input));
}

export function deleteStrategy(userId, id) {
  requireStrategy(userId, id);
  repo.deleteStrategy(userId, id);
}

export async function startStrategy(userId, id) {
  const strategy = requireStrategy(userId, id);
  if (strategy.cycleCompleted) {
    throw badRequest('이미 누적 목표 수익률을 달성해 종료된 전략입니다. 다시 운용하려면 새 전략을 만드세요.');
  }
  const started = repo.startStrategy(userId, id);
  const liveOrderEnabled = autoTradingRepo.getSettings(userId).liveOrderEnabled;
  // 누적 목표 수익률이 설정돼 있고 아직 baseline이 없으면 시작 시점의 USD 매수가능금액을 스냅샷한다.
  let baselineUsd = strategy.cycleBaselineUsd;
  if (strategy.cycleTargetProfitRate && (baselineUsd == null || baselineUsd <= 0)) {
    try {
      await getValidAccessToken(userId);
      const trading = new KisTradingService(userId);
      const buyingPower = await trading.getBuyingPower('TQQQ', { market: 'US', currency: 'USD', exchange: 'NAS', price: 0 });
      baselineUsd = Number(buyingPower.cashAvailable || 0);
      if (baselineUsd > 0) repo.setCycleBaseline(userId, id, baselineUsd);
    } catch (error) {
      // baseline 조회 실패는 치명적이지 않다. 첫 평가 tick에서 다시 시도된다.
    }
  }
  const cycleNote = strategy.cycleTargetProfitRate
    ? ` 누적 목표 +${pct(strategy.cycleTargetProfitRate)}${baselineUsd ? ` (기준 ${fmt(baselineUsd)} USD)` : ''} 달성 시 자동 종료.`
    : '';
  repo.createDecisionLog(userId, {
    strategyId: strategy.id,
    decision: 'SKIP',
    liveOrderEnabled,
    evaluationSource: 'MANUAL',
    reason: `전략을 시작했습니다. 미국 정규장 ET 10:00~16:00 동안 1분마다 평가합니다. 실주문 ${liveOrderEnabled ? '켜짐' : '꺼짐'}.${cycleNote}`
  });
  return started;
}

export function stopStrategy(userId, id) {
  requireStrategy(userId, id);
  return repo.stopStrategy(userId, id);
}

export function listTrades(userId, strategyId) {
  requireStrategy(userId, strategyId);
  return repo.listTrades(userId, { strategyId });
}

export function listOrders(userId, strategyId) {
  requireStrategy(userId, strategyId);
  return repo.listOrders(userId, { strategyId });
}

export function listDecisionLogs(userId, strategyId) {
  requireStrategy(userId, strategyId);
  return repo.listDecisionLogs(userId, strategyId);
}

export function getOverview(userId) {
  return {
    liveOrderEnabled: autoTradingRepo.getSettings(userId).liveOrderEnabled,
    strategies: repo.listStrategies(userId)
  };
}

export async function evaluateStrategy(userId, id, { scheduled = false } = {}) {
  const evaluationSource = scheduled ? 'SCHEDULED' : 'MANUAL';
  const strategy = requireStrategy(userId, id);
  if (strategy.status !== 'RUNNING') {
    return saveSkip(userId, strategy, '전략이 실행 중이 아니라 평가하지 않습니다.', evaluationSource);
  }
  const lockedUntil = new Date(Date.now() + 2 * 60 * 1000).toISOString();
  if (!repo.acquireLock(userId, id, LOCK_KEY, lockedUntil)) {
    return saveSkip(userId, strategy, '이미 평가가 진행 중입니다.', evaluationSource);
  }
  try {
    if (scheduled && !isUsRegularSession()) {
      return saveSkip(userId, strategy, '미국 정규장 시간이 아니라 평가하지 않습니다.', evaluationSource, { noLog: true });
    }
    try {
      return await evaluateUnlocked(userId, strategy, evaluationSource);
    } catch (error) {
      // 평가 도중 발생한 에러(주로 KIS API 실패)도 판단 로그에 ERROR로 남겨 사용자가 원인을 추적할 수 있게 한다.
      const message = error.message || '평가 중 오류가 발생했습니다.';
      const liveOrderEnabled = autoTradingRepo.getSettings(userId).liveOrderEnabled;
      repo.markEvaluation(userId, strategy.id, { decision: 'ERROR', errorMessage: message });
      const log = repo.createDecisionLog(userId, {
        strategyId: strategy.id,
        decision: 'ERROR',
        liveOrderEnabled,
        evaluationSource,
        reason: message
      });
      return { strategy: repo.getStrategy(userId, strategy.id), decision: log, order: null };
    }
  } finally {
    repo.releaseLock(id, LOCK_KEY);
  }
}

export async function evaluateRunningStrategies() {
  const strategies = repo.listRunningStrategies();
  for (const strategy of strategies) {
    try {
      await evaluateStrategy(strategy.userId, strategy.id, { scheduled: true });
    } catch (error) {
      const message = error.message || '미국장 랭킹 전략 자동 평가에 실패했습니다.';
      repo.markEvaluation(strategy.userId, strategy.id, { decision: 'ERROR', errorMessage: message });
      // 사용자가 판단 로그에서 바로 원인을 볼 수 있어야 한다. lastErrorMessage만으로는
      // 시간순 추적이 어렵고 디버깅 효율이 떨어진다.
      try {
        const liveOrderEnabled = autoTradingRepo.getSettings(strategy.userId).liveOrderEnabled;
        repo.createDecisionLog(strategy.userId, {
          strategyId: strategy.id,
          decision: 'ERROR',
          liveOrderEnabled,
          evaluationSource: 'SCHEDULED',
          reason: `자동 평가 실패: ${message}`
        });
      } catch (_logError) {
        // 로그 기록 실패는 평가 흐름을 중단하지 않는다.
      }
    }
  }
}

async function evaluateUnlocked(userId, strategy, evaluationSource) {
  const tradeDate = etTradeDate();
  const liveOrderEnabled = autoTradingRepo.getSettings(userId).liveOrderEnabled;
  const unlocked = repo.clearDayLockedOutIfStale(userId, strategy.id, tradeDate);
  strategy = unlocked || strategy;

  if (strategy.cycleCompleted) {
    return saveDecision(userId, strategy, {
      decision: 'SKIP',
      liveOrderEnabled,
      evaluationSource,
      reason: '누적 목표 수익률을 달성해 종료된 전략입니다.',
      noLog: evaluationSource !== 'MANUAL'
    });
  }

  if (!isUsRegularSession()) {
    return saveDecision(userId, strategy, {
      decision: 'SKIP',
      liveOrderEnabled,
      evaluationSource,
      reason: '미국 정규장이 아니라 평가를 건너뜁니다.',
      noLog: evaluationSource !== 'MANUAL'
    });
  }

  // 누적 목표가 설정됐는데 baseline(시작 자본)이 비어 있으면 — 시작 시 KIS 조회 실패 등 —
  // 평가 시점에 매수가능금액을 다시 조회해 채운다. 못 채우면 이번 tick은 누적 목표 검사를 건너뛰고
  // 다음 tick에 다시 시도한다. (baseline이 없으면 누적 목표가 영영 작동하지 않던 문제 보완)
  if (strategy.cycleTargetProfitRate && !(strategy.cycleBaselineUsd > 0)) {
    try {
      const tradingForBaseline = await readyTrading(userId);
      const buyingPower = await tradingForBaseline.getBuyingPower('TQQQ', { market: 'US', currency: 'USD', exchange: 'NAS', price: 0 });
      const baseline = Number(buyingPower.cashAvailable || 0);
      if (baseline > 0) {
        strategy = repo.setCycleBaseline(userId, strategy.id, baseline) || strategy;
      }
    } catch (_error) {
      // baseline 재조회 실패는 치명적이지 않다. 다음 tick에서 다시 시도한다.
    }
  }

  if (strategy.holdingSymbol) {
    const trading = await readyTrading(userId);
    return evaluateSellPath(userId, strategy, { trading, tradeDate, liveOrderEnabled, evaluationSource });
  }

  if (strategy.dayLockedOut && strategy.dayLockedOutAt === tradeDate) {
    return saveDecision(userId, strategy, {
      decision: 'SKIP',
      tradeDate,
      liveOrderEnabled,
      evaluationSource,
      reason: `오늘 ${lockReasonLabel(strategy.dayLockReason)}로 신규 매수를 멈춥니다.`,
      noLog: evaluationSource !== 'MANUAL'
    });
  }

  if (isForceCloseWindow(strategy.forceCloseKst)) {
    return saveDecision(userId, strategy, {
      decision: 'SKIP',
      tradeDate,
      liveOrderEnabled,
      evaluationSource,
      reason: `강제 청산 시각(${strategy.forceCloseKst} KST)이 지나 신규 매수를 시작하지 않습니다.`,
      noLog: evaluationSource !== 'MANUAL'
    });
  }

  const trading = await readyTrading(userId);
  return evaluateEntryPath(userId, strategy, { trading, tradeDate, liveOrderEnabled, evaluationSource });
}

async function evaluateSellPath(userId, strategy, { trading, tradeDate, liveOrderEnabled, evaluationSource }) {
  const symbol = strategy.holdingSymbol;
  const exchange = strategy.holdingExchange || strategy.exchange;
  const price = await trading.getCurrentPrice(symbol, { market: 'US', exchange });
  const balance = await trading.getBalance(symbol, { market: 'US', currency: 'USD', exchange });
  const currentPrice = Number(price.price || 0);
  const holdingQuantity = Math.floor(Number(balance.quantity || strategy.holdingQuantity || 0));
  const averagePrice = Number(balance.averagePrice || strategy.holdingAveragePrice || 0);
  const cashAvailable = Number(balance.cashAvailable || 0);

  if (holdingQuantity <= 0) {
    repo.clearHolding(userId, strategy.id);
    return saveDecision(userId, strategy, {
      decision: 'SKIP',
      tradeDate,
      selectedSymbol: symbol,
      selectedSymbolName: strategy.holdingSymbolName,
      selectedExchange: exchange,
      currentPrice,
      averagePrice,
      holdingQuantity,
      cashAvailable,
      liveOrderEnabled,
      evaluationSource,
      reason: `${symbol} 잔고 수량이 0이라 보유 상태를 해제했습니다.`
    });
  }

  const forceCloseTriggered = isUsForceCloseTime(new Date(), strategy.forceCloseKst);
  // 보유 중인 매매 사이클의 trade 행. 누적 손익 계산(기대 체결 수량)과 trade 갱신에 같은 행을 쓴다.
  const openTrade = repo.getOpenTrade(strategy.id);
  // 누적 손익(실현+미실현)이 baseline 대비 cycle_target_profit_rate 이상이면 사이클 완료 트리거.
  // 매수가능금액(현금)은 매수 직후 정산 지연으로 이중계산을 일으켜 쓰지 않는다.
  const cycleProfitRate = strategy.cycleTargetProfitRate
    ? computeCycleProfitRate({
        baselineUsd: strategy.cycleBaselineUsd,
        realizedProfitUsd: repo.sumRealizedProfitUsd(strategy.id),
        holdingQuantity,
        currentPrice,
        averagePrice
      })
    : null;
  // 정산 안전장치: 영구 종료를 부르는 CYCLE_COMPLETE는 매수 체결이 충분히 정산된 뒤에만 인정한다.
  // 매수 직후 부분 체결·정산 지연으로 KIS 보유 수량이 기대 수량보다 적게 잡히는 구간에서는
  // 평가손익이 과소·과대 평가될 수 있어 사이클 완료(영구 정지)를 보류한다(다음 tick 재평가).
  // 손절·익절·강제 청산은 평단 대비 현재가만 보므로 이 보류와 무관하게 그대로 동작한다.
  const expectedQuantity = Math.floor(Number(openTrade?.entryQuantity || 0));
  const fullySettled = expectedQuantity <= 0 || holdingQuantity >= expectedQuantity;
  const cycleTargetReached = fullySettled
    && cycleProfitRate != null
    && Number.isFinite(cycleProfitRate)
    && cycleProfitRate >= Number(strategy.cycleTargetProfitRate);
  const sell = evaluateSell({
    currentPrice,
    averagePrice,
    targetProfitRate: strategy.targetProfitRate,
    stopLossRate: strategy.stopLossRate,
    forceCloseTriggered,
    cycleTargetReached
  });
  // 보유 중인 매매 사이클의 trade 행을 정확히 같은 행으로 다룬다.
  //  - openTrade(SELECTED|BOUGHT) 있으면 그것을 사용. SELECTED라면 진입 후 BOUGHT 갱신이 실패한
  //    상태이므로 KIS 잔고 기준 평단가·수량으로 BOUGHT 보정.
  //  - openTrade가 전혀 없는 경우(외부 HTS 매수 등 우리 기록 외 보유)에만 새 trade 행을 만든다.
  let trade;
  if (openTrade) {
    trade = openTrade;
    if (trade.status !== 'BOUGHT') {
      trade = repo.updateTradeOutcome(trade.id, {
        status: 'BOUGHT',
        entryPrice: averagePrice || trade.selectedPrice || currentPrice,
        entryQuantity: holdingQuantity
      }) || trade;
    }
  } else {
    trade = repo.createTrade(userId, {
      strategyId: strategy.id,
      tradeDate,
      tradeSeq: repo.nextTradeSeq(strategy.id, tradeDate),
      symbol,
      symbolName: strategy.holdingSymbolName,
      exchange,
      selectedPrice: currentPrice,
      selectedFluctuationRate: null,
      status: 'BOUGHT'
    });
    trade = repo.updateTradeOutcome(trade.id, {
      entryPrice: averagePrice || currentPrice,
      entryQuantity: holdingQuantity
    }) || trade;
  }

  if (sell.decision === 'HOLD') {
    const profitPct = (sell.profitRate * 100).toFixed(2);
    return saveDecision(userId, strategy, {
      decision: 'HOLD',
      tradeId: trade.id,
      tradeDate,
      tradeSeq: trade.tradeSeq,
      selectedSymbol: symbol,
      selectedSymbolName: strategy.holdingSymbolName,
      selectedExchange: exchange,
      currentPrice,
      averagePrice,
      holdingQuantity,
      cashAvailable,
      profitRate: sell.profitRate,
      liveOrderEnabled,
      evaluationSource,
      reason: `${symbol} 보유 중 (수익률 ${profitPct}%). 익절 +${pct(strategy.targetProfitRate)} / 손절 -${pct(strategy.stopLossRate)} / 청산 ${strategy.forceCloseKst} KST 모두 미도달.`
    });
  }

  const idempotencyKey = makeUsRankIdempotencyKey({
    tradeDate,
    strategyId: strategy.id,
    tradeSeq: trade.tradeSeq,
    side: 'SELL'
  });
  if (repo.hasNonFailedOrder(idempotencyKey)) {
    return saveDecision(userId, strategy, {
      decision: 'SKIP',
      tradeId: trade.id,
      tradeDate,
      tradeSeq: trade.tradeSeq,
      selectedSymbol: symbol,
      selectedSymbolName: strategy.holdingSymbolName,
      selectedExchange: exchange,
      currentPrice,
      averagePrice,
      holdingQuantity,
      cashAvailable,
      profitRate: sell.profitRate,
      liveOrderEnabled,
      evaluationSource,
      reason: `${symbol} 매도 주문이 이미 접수돼 있어 체결을 기다립니다.`
    });
  }
  if (repo.countFailedOrders(idempotencyKey) >= ORDER_RETRY_LIMIT) {
    return saveDecision(userId, strategy, {
      decision: 'SKIP',
      tradeId: trade.id,
      tradeDate,
      tradeSeq: trade.tradeSeq,
      selectedSymbol: symbol,
      selectedSymbolName: strategy.holdingSymbolName,
      selectedExchange: exchange,
      currentPrice,
      averagePrice,
      holdingQuantity,
      cashAvailable,
      profitRate: sell.profitRate,
      liveOrderEnabled,
      evaluationSource,
      reason: `${symbol} 매도가 ${ORDER_RETRY_LIMIT}회 실패해 더 시도하지 않습니다. 계좌를 직접 확인하세요.`
    });
  }

  const openOrders = await safeOpenOrders(trading, symbol, exchange);
  const guard = checkOrderSafety({ side: 'SELL', quantity: holdingQuantity, openOrders, idempotencyKey, holdingQuantity });
  if (!guard.ok) {
    return saveDecision(userId, strategy, {
      decision: 'SKIP',
      tradeId: trade.id,
      tradeDate,
      tradeSeq: trade.tradeSeq,
      selectedSymbol: symbol,
      selectedSymbolName: strategy.holdingSymbolName,
      selectedExchange: exchange,
      currentPrice,
      averagePrice,
      holdingQuantity,
      cashAvailable,
      profitRate: sell.profitRate,
      liveOrderEnabled,
      evaluationSource,
      reason: `${symbol} ${sellReasonLabel(sell.sellReason)} 조건이나 ${guard.reason} 다음 평가에서 다시 시도합니다.`
    });
  }

  const estimatedAmount = holdingQuantity * currentPrice;
  const order = await placeOrder(userId, trading, {
    strategyId: strategy.id,
    tradeId: trade.id,
    symbol,
    symbolName: strategy.holdingSymbolName,
    exchange,
    side: 'SELL',
    sellReason: sell.sellReason,
    quantity: holdingQuantity,
    orderPrice: currentPrice,
    estimatedAmount,
    idempotencyKey,
    liveOrderEnabled
  }, {
    liveOrderEnabled,
    decisionReason: `${symbol} ${sellReasonLabel(sell.sellReason)} 전량 매도 (수익률 ${(sell.profitRate * 100).toFixed(2)}%).`
  });

  if (order.status !== 'FAILED' && order.status !== 'REJECTED') {
    repo.updateTradeOutcome(trade.id, {
      status: 'CLOSED',
      exitPrice: currentPrice,
      exitReason: sell.sellReason,
      profitRate: sell.profitRate,
      close: true
    });
    repo.clearHolding(userId, strategy.id);
    if (sell.sellReason === 'STOP_LOSS' || sell.sellReason === 'FORCE_CLOSE') {
      repo.setDayLockedOut(userId, strategy.id, { tradeDate, reason: sell.sellReason });
    }
    if (sell.sellReason === 'CYCLE_COMPLETE') {
      repo.markCycleCompleted(userId, strategy.id);
    }
  }

  const log = saveDecision(userId, strategy, {
    decision: 'SELL',
    sellReason: sell.sellReason,
    tradeId: trade.id,
    tradeDate,
    tradeSeq: trade.tradeSeq,
    selectedSymbol: symbol,
    selectedSymbolName: strategy.holdingSymbolName,
    selectedExchange: exchange,
    currentPrice,
    averagePrice,
    holdingQuantity,
    cashAvailable,
    expectedQuantity: holdingQuantity,
    expectedPrice: currentPrice,
    expectedAmount: estimatedAmount,
    profitRate: sell.profitRate,
    liveOrderEnabled,
    evaluationSource,
    orderId: order.id,
    reason: `${symbol} ${sellReasonLabel(sell.sellReason)} 전량 매도 (수익률 ${(sell.profitRate * 100).toFixed(2)}%). ${orderStatusNote(order, liveOrderEnabled)}`
  });
  repo.attachOrderIdToDecisionLog(log.decision?.id, order.id);
  return { ...log, order };
}

async function evaluateEntryPath(userId, strategy, { trading, tradeDate, liveOrderEnabled, evaluationSource }) {
  // 무보유 상태에서 누적 실현손익이 baseline 대비 목표 수익률 이상이면 사이클을 즉시 완료한다.
  // 예: 매도 직후 누적 실현손익이 baseline×target을 넘었을 때 다음 tick에서 신규 매수 없이 STOPPED.
  // 매수가능금액(현금) 대신 실현손익으로 계산해 정산 지연에 영향받지 않게 한다.
  if (strategy.cycleTargetProfitRate && strategy.cycleBaselineUsd > 0) {
    const cycleProfitRate = computeCycleProfitRate({
      baselineUsd: strategy.cycleBaselineUsd,
      realizedProfitUsd: repo.sumRealizedProfitUsd(strategy.id),
      holdingQuantity: 0,
      currentPrice: 0
    });
    if (cycleProfitRate != null && cycleProfitRate >= Number(strategy.cycleTargetProfitRate)) {
      repo.markCycleCompleted(userId, strategy.id);
      return saveDecision(userId, strategy, {
        decision: 'SKIP',
        tradeDate,
        profitRate: cycleProfitRate,
        liveOrderEnabled,
        evaluationSource,
        reason: `누적 목표 수익률 +${pct(strategy.cycleTargetProfitRate)} 달성(현재 +${pct(cycleProfitRate)}). 전략을 종료합니다.`
      });
    }
  }

  let trade = repo.getOpenTrade(strategy.id);
  // 이전 거래일에 남은 미정리 매매(주로 미체결로 SELECTED인 채 장 마감된 건)는 오늘 이어받지 않는다.
  // getOpenTrade는 날짜 필터가 없어 전날 SELECTED를 돌려줄 수 있는데, 그대로 쓰면 어제 1위 종목을
  // 오늘 사버린다. 혹시 남아 있을 미체결 주문은 best-effort 취소하고 매매를 FAILED로 닫은 뒤 새로 시작.
  if (trade && trade.tradeDate !== tradeDate) {
    const staleKey = makeUsRankIdempotencyKey({ tradeDate: trade.tradeDate, strategyId: strategy.id, tradeSeq: trade.tradeSeq, side: 'BUY' });
    await cancelBuyOrderBestEffort(userId, trading, repo.getActiveOrderByIdempotencyKey(staleKey));
    repo.updateTradeOutcome(trade.id, {
      status: 'FAILED',
      errorMessage: '이전 거래일 미체결 매매를 정리하고 새 거래일을 시작합니다.',
      close: true
    });
    trade = null;
  }
  let rankingSnapshot = trade?.rankingSnapshot || null;
  if (!trade) {
    const ranking = await getOverseasFluctuationRanking(userId, { exchange: strategy.exchange });
    const picked = selectRankingCandidate(ranking);
    rankingSnapshot = (ranking || []).slice(0, RANKING_SNAPSHOT_SIZE);
    if (!picked) {
      // 후보 없음은 trade 행을 만들지 않고 decision log만 남긴다. 매분 폴링이라
      // 스케줄러 SCHEDULED는 noLog로 노이즈를 줄이고 MANUAL은 사유를 응답에 보여주기 위해 기록.
      return saveDecision(userId, strategy, {
        decision: 'SKIP',
        tradeDate,
        rankingSnapshot,
        liveOrderEnabled,
        evaluationSource,
        reason: '미국 상승률 랭킹에서 유효한 매수 후보가 없어 이번 tick은 건너뜁니다.',
        noLog: evaluationSource !== 'MANUAL'
      });
    }
    trade = repo.createTrade(userId, {
      strategyId: strategy.id,
      tradeDate,
      tradeSeq: repo.nextTradeSeq(strategy.id, tradeDate),
      status: 'SELECTED',
      symbol: picked.symbol,
      symbolName: picked.name,
      exchange: picked.exchange,
      selectedPrice: picked.price,
      selectedFluctuationRate: picked.fluctuationRate,
      rankingSnapshot
    });
  }

  const symbol = trade.symbol;
  const exchange = trade.exchange || strategy.exchange;
  const idempotencyKey = makeUsRankIdempotencyKey({ tradeDate, strategyId: strategy.id, tradeSeq: trade.tradeSeq, side: 'BUY' });
  if (repo.hasNonFailedOrder(idempotencyKey)) {
    // 매수 주문은 접수(ACCEPTED)됐을 뿐 체결이 아니다. 낙관적으로 보유 처리하면
    // 미체결 종목을 다음 tick에 매도 평가해 잘못된 청산을 부른다(직전 사고 원인).
    // KIS 잔고로 실제 체결 수량을 확인한 뒤에만 보유로 전환한다.
    const balance = await trading.getBalance(symbol, { market: 'US', currency: 'USD', exchange });
    const filledQuantity = Math.floor(Number(balance.quantity || 0));
    if (filledQuantity > 0) {
      const filledAvg = Number(balance.averagePrice || trade.entryPrice || trade.selectedPrice || 0);
      repo.updateTradeOutcome(trade.id, { status: 'BOUGHT', entryPrice: filledAvg, entryQuantity: filledQuantity });
      repo.setHolding(userId, strategy.id, {
        symbol,
        symbolName: trade.symbolName,
        exchange,
        quantity: filledQuantity,
        averagePrice: filledAvg
      });
      return saveDecision(userId, strategy, {
        decision: 'SKIP',
        tradeId: trade.id,
        tradeDate,
        tradeSeq: trade.tradeSeq,
        selectedSymbol: symbol,
        selectedSymbolName: trade.symbolName,
        selectedExchange: exchange,
        currentPrice: filledAvg,
        averagePrice: filledAvg,
        holdingQuantity: filledQuantity,
        rankingSnapshot,
        liveOrderEnabled,
        evaluationSource,
        reason: `${symbol} 매수 체결 확인(${filledQuantity}주, 평단 ${fmt(filledAvg)} USD). 보유로 전환했습니다.`
      });
    }
    // 실주문 미체결이 오래 머물면(급등주 호가 이탈 등) 취소하고 이번 매매를 접어 다음 후보로 넘어간다.
    // 취소하지 않으면 종일 같은 미체결 주문에 묶여 stall된다.
    if (liveOrderEnabled) {
      const activeOrder = repo.getActiveOrderByIdempotencyKey(idempotencyKey);
      const restingMs = activeOrder ? Date.now() - sqliteUtcToMs(activeOrder.createdAt) : 0;
      if (activeOrder && restingMs >= BUY_STALE_LIMIT_MS) {
        await cancelBuyOrderBestEffort(userId, trading, activeOrder);
        // 취소-체결 경합 방지: 취소 직후 잔고를 다시 확인해 그 사이 체결됐으면 보유로 전환한다.
        const recheck = await trading.getBalance(symbol, { market: 'US', currency: 'USD', exchange });
        const refilled = Math.floor(Number(recheck.quantity || 0));
        if (refilled > 0) {
          const filledAvg = Number(recheck.averagePrice || trade.entryPrice || trade.selectedPrice || 0);
          repo.updateTradeOutcome(trade.id, { status: 'BOUGHT', entryPrice: filledAvg, entryQuantity: refilled });
          repo.setHolding(userId, strategy.id, { symbol, symbolName: trade.symbolName, exchange, quantity: refilled, averagePrice: filledAvg });
          return saveDecision(userId, strategy, {
            decision: 'SKIP', tradeId: trade.id, tradeDate, tradeSeq: trade.tradeSeq,
            selectedSymbol: symbol, selectedSymbolName: trade.symbolName, selectedExchange: exchange,
            currentPrice: filledAvg, averagePrice: filledAvg, holdingQuantity: refilled,
            rankingSnapshot, liveOrderEnabled, evaluationSource,
            reason: `${symbol} 취소 직전 매수 체결 확인(${refilled}주). 보유로 전환했습니다.`
          });
        }
        repo.updateTradeOutcome(trade.id, {
          status: 'FAILED',
          errorMessage: '미체결 지정가 매수를 취소하고 다음 후보로 넘어갑니다.',
          close: true
        });
        return saveDecision(userId, strategy, {
          decision: 'SKIP', tradeId: trade.id, tradeDate, tradeSeq: trade.tradeSeq,
          selectedSymbol: symbol, selectedSymbolName: trade.symbolName, selectedExchange: exchange,
          rankingSnapshot, liveOrderEnabled, evaluationSource,
          reason: `${symbol} 매수가 ${Math.round(BUY_STALE_LIMIT_MS / 60000)}분간 체결되지 않아 주문을 취소하고 이번 매매를 접습니다. 다음 평가에서 새 후보를 찾습니다.`
        });
      }
    }
    return saveDecision(userId, strategy, {
      decision: 'SKIP',
      tradeId: trade.id,
      tradeDate,
      tradeSeq: trade.tradeSeq,
      selectedSymbol: symbol,
      selectedSymbolName: trade.symbolName,
      selectedExchange: exchange,
      rankingSnapshot,
      liveOrderEnabled,
      evaluationSource,
      reason: `${symbol} 매수 주문이 접수됐으나 아직 체결되지 않아 보유 전환을 보류합니다. 체결을 기다립니다.`
    });
  }
  if (repo.countFailedOrders(idempotencyKey) >= ORDER_RETRY_LIMIT) {
    // 같은 trade로 계속 SKIP을 만들면 무한 노이즈가 되고 다음 매매 사이클이 영원히 못 시작된다.
    // 이 trade는 FAILED로 닫아 다음 tick부터 새 trade(다른 trade_seq, 다른 idempotency_key)로 재시도되게 한다.
    repo.updateTradeOutcome(trade.id, {
      status: 'FAILED',
      errorMessage: `매수가 ${ORDER_RETRY_LIMIT}회 실패해 매매 사이클을 닫습니다.`,
      close: true
    });
    return saveDecision(userId, strategy, {
      decision: 'SKIP',
      tradeId: trade.id,
      tradeDate,
      tradeSeq: trade.tradeSeq,
      selectedSymbol: symbol,
      selectedSymbolName: trade.symbolName,
      selectedExchange: exchange,
      rankingSnapshot,
      liveOrderEnabled,
      evaluationSource,
      reason: `${symbol} 매수가 ${ORDER_RETRY_LIMIT}회 실패해 이번 매매 사이클을 닫고 다음 tick에서 새 사이클을 시작합니다.`
    });
  }

  const priceQuote = await trading.getCurrentPrice(symbol, { market: 'US', exchange });
  const currentPrice = Number(priceQuote.price || trade.selectedPrice || 0);
  const buyingPower = await trading.getBuyingPower(symbol, { market: 'US', currency: 'USD', exchange, price: currentPrice });
  const cashAvailable = Number(buyingPower.cashAvailable || 0);
  const budget = cashAvailable;
  const quantity = computeBuyQuantity(budget, currentPrice);
  if (quantity <= 0) {
    return saveDecision(userId, strategy, {
      decision: 'SKIP',
      tradeId: trade.id,
      tradeDate,
      tradeSeq: trade.tradeSeq,
      selectedSymbol: symbol,
      selectedSymbolName: trade.symbolName,
      selectedExchange: exchange,
      currentPrice,
      cashAvailable,
      rankingSnapshot,
      liveOrderEnabled,
      evaluationSource,
      reason: `${symbol} 매수 대상이나 매수가능금액 ${fmt(cashAvailable)} USD로 1주도 매수할 수 없습니다.`
    });
  }

  const estimatedAmount = quantity * currentPrice;
  const openOrders = await safeOpenOrders(trading, symbol, exchange);
  const guard = checkOrderSafety({ side: 'BUY', quantity, openOrders, idempotencyKey, cashAvailable, estimatedAmount });
  if (!guard.ok) {
    return saveDecision(userId, strategy, {
      decision: 'SKIP',
      tradeId: trade.id,
      tradeDate,
      tradeSeq: trade.tradeSeq,
      selectedSymbol: symbol,
      selectedSymbolName: trade.symbolName,
      selectedExchange: exchange,
      currentPrice,
      cashAvailable,
      rankingSnapshot,
      liveOrderEnabled,
      evaluationSource,
      reason: `${symbol} 매수 대상이나 ${guard.reason} 다음 평가에서 다시 시도합니다.`
    });
  }

  const order = await placeOrder(userId, trading, {
    strategyId: strategy.id,
    tradeId: trade.id,
    symbol,
    symbolName: trade.symbolName,
    exchange,
    side: 'BUY',
    quantity,
    orderPrice: currentPrice,
    estimatedAmount,
    idempotencyKey,
    liveOrderEnabled
  }, {
    liveOrderEnabled,
    decisionReason: `${trade.tradeSeq}번째 매매: ${symbol} ${quantity}주 매수. 매수가능금액 전액 기준.`
  });
  // 실주문(ACCEPTED 등)은 접수일 뿐 체결이 아니므로 보유로 즉시 전환하지 않는다.
  // 다음 tick의 체결 확인 분기(hasNonFailedOrder)에서 KIS 잔고로 실제 체결을 확인한 뒤 전환한다.
  // 반면 DRY_RUN(실주문 OFF)은 실제 주문이 없어 확인할 잔고가 없으므로 즉시 보유로 시뮬레이션한다.
  if (order.status === 'DRY_RUN') {
    repo.updateTradeOutcome(trade.id, {
      status: 'BOUGHT',
      entryPrice: currentPrice,
      entryQuantity: quantity
    });
    repo.setHolding(userId, strategy.id, {
      symbol,
      symbolName: trade.symbolName,
      exchange,
      quantity,
      averagePrice: currentPrice
    });
  }

  const log = saveDecision(userId, strategy, {
    decision: 'BUY',
    tradeId: trade.id,
    tradeDate,
    tradeSeq: trade.tradeSeq,
    selectedSymbol: symbol,
    selectedSymbolName: trade.symbolName,
    selectedExchange: exchange,
    currentPrice,
    cashAvailable,
    expectedQuantity: quantity,
    expectedPrice: currentPrice,
    expectedAmount: estimatedAmount,
    rankingSnapshot,
    liveOrderEnabled,
    evaluationSource,
    orderId: order.id,
    reason: `${trade.tradeSeq}번째 매매: ${symbol} ${quantity}주 매수. 매수가능금액 전액 기준. ${orderStatusNote(order, liveOrderEnabled)}`
  });
  repo.attachOrderIdToDecisionLog(log.decision?.id, order.id);
  return { ...log, order };
}

async function placeOrder(userId, trading, baseOrder, { liveOrderEnabled, decisionReason }) {
  const orderInput = {
    ...baseOrder,
    market: 'US',
    currency: 'USD',
    // KIS 미국 일반 매수 주문은 문서상 일반 시장가가 없어 현재가 지정가로 전송한다.
    orderType: 'LIMIT',
    decisionReason
  };
  if (!liveOrderEnabled) {
    return repo.createOrder(userId, {
      ...orderInput,
      status: 'DRY_RUN',
      requestPayloadMasked: maskPayload(orderInput)
    });
  }
  try {
    const result = baseOrder.side === 'BUY'
      ? await trading.placeBuyOrder(orderInput)
      : await trading.placeSellOrder(orderInput);
    return repo.createOrder(userId, {
      ...orderInput,
      status: result.status || 'ACCEPTED',
      kisOrderNo: result.orderNo,
      kisOriginalOrderNo: result.originalOrderNo,
      requestPayloadMasked: result.requestPayloadMasked || maskPayload(orderInput),
      responsePayloadMasked: result.responsePayloadMasked
    });
  } catch (error) {
    return repo.createOrder(userId, {
      ...orderInput,
      status: 'FAILED',
      requestPayloadMasked: maskPayload(orderInput),
      responsePayloadMasked: error.safePayload || null,
      errorMessage: error.message || 'KIS 주문 요청에 실패했습니다.'
    });
  }
}

function checkOrderSafety({
  side, quantity, openOrders, idempotencyKey,
  cashAvailable = 0, estimatedAmount = 0, holdingQuantity = 0
}) {
  if (!Number.isFinite(quantity) || quantity <= 0) return { ok: false, reason: '주문 수량이 0이라 주문하지 않습니다.' };
  if (Array.isArray(openOrders) && openOrders.length > 0) return { ok: false, reason: '미체결 주문이 있어 신규 주문을 만들지 않습니다.' };
  if (repo.hasNonFailedOrder(idempotencyKey)) return { ok: false, reason: '같은 주문이 이미 접수돼 있습니다.' };
  if (side === 'BUY' && cashAvailable < estimatedAmount) {
    return { ok: false, reason: `매수가능금액이 부족합니다. 필요 ${fmt(estimatedAmount)} USD, 가능 ${fmt(cashAvailable)} USD.` };
  }
  if (side === 'SELL' && holdingQuantity < quantity) {
    return { ok: false, reason: `보유 수량이 부족합니다. 필요 ${quantity}주, 보유 ${holdingQuantity}주.` };
  }
  return { ok: true };
}

function saveDecision(userId, strategy, input) {
  const evaluationSource = input.evaluationSource || 'SCHEDULED';
  const decision = input.decision;
  if (input.noLog) {
    repo.touchEvaluation(userId, strategy.id);
    return { strategy: repo.getStrategy(userId, strategy.id), decision: null, order: null };
  }
  if (decision === 'SKIP' && evaluationSource !== 'MANUAL') {
    repo.touchEvaluation(userId, strategy.id);
  } else {
    repo.markEvaluation(userId, strategy.id, {
      decision,
      errorMessage: decision === 'ERROR' ? input.reason : null
    });
  }
  const log = repo.createDecisionLog(userId, { strategyId: strategy.id, ...input });
  return { strategy: repo.getStrategy(userId, strategy.id), decision: log, order: null };
}

function saveSkip(userId, strategy, reason, evaluationSource, { noLog = false } = {}) {
  const liveOrderEnabled = autoTradingRepo.getSettings(userId).liveOrderEnabled;
  return saveDecision(userId, strategy, { decision: 'SKIP', liveOrderEnabled, evaluationSource, reason, noLog });
}

async function readyTrading(userId) {
  await getValidAccessToken(userId);
  return new KisTradingService(userId);
}

async function safeOpenOrders(trading, symbol, exchange) {
  try {
    return await trading.getOpenOrders(symbol, { market: 'US', currency: 'USD', exchange });
  } catch {
    return [];
  }
}

function normalizeStrategyInput(input = {}) {
  const autoBudgetEnabled = true;
  const fixedBuyUsdAmount = 0;
  const targetProfitRate = positiveNumber(input.targetProfitRate ?? DEFAULT_TARGET_PROFIT_RATE, '익절 기준');
  const stopLossRate = positiveNumber(input.stopLossRate ?? DEFAULT_STOP_LOSS_RATE, '손절 기준');
  const forceCloseKst = requireHhmm(input.forceCloseKst || DEFAULT_FORCE_CLOSE_KST, '강제 청산 시각');
  const forceMinutes = parseHhmmMinutes(forceCloseKst);
  if (forceMinutes === null || forceMinutes >= 12 * 60) {
    throw badRequest('강제 청산 시각은 KST 새벽 시간대(00:00~11:59)로 입력하세요. 예: 04:30');
  }
  const exchange = normalizeExchange(input.exchange);
  // 누적 목표 수익률은 선택값. 빈/0 이하 입력은 미사용으로 처리(null 저장).
  let cycleTargetProfitRate = null;
  if (input.cycleTargetProfitRate != null && input.cycleTargetProfitRate !== '') {
    const value = Number(input.cycleTargetProfitRate);
    if (!Number.isFinite(value) || value <= 0) {
      throw badRequest('누적 목표 수익률은 0보다 커야 합니다.');
    }
    cycleTargetProfitRate = value;
  }
  return {
    autoBudgetEnabled,
    fixedBuyUsdAmount,
    targetProfitRate,
    stopLossRate,
    forceCloseKst,
    exchange,
    cycleTargetProfitRate
  };
}

function normalizeExchange(value) {
  const raw = String(value || 'NAS').trim().toUpperCase();
  if (['ALL', 'NAS', 'NYS', 'AMS'].includes(raw)) return raw;
  if (raw === 'NASDAQ' || raw === 'NASD') return 'NAS';
  if (raw === 'NYSE') return 'NYS';
  if (raw === 'AMEX' || raw === 'AMX') return 'AMS';
  throw badRequest('거래소는 전체, NASDAQ, NYSE, AMEX 중 하나여야 합니다.');
}

function requireHhmm(value, label) {
  const minutes = parseHhmmMinutes(value);
  if (minutes == null) throw badRequest(`${label}은(는) 'HH:MM' 24시간 표기여야 합니다. 예: 04:30`);
  return String(value).trim().padStart(5, '0');
}

function isForceCloseWindow(forceCloseKst) {
  const force = parseHhmmMinutes(forceCloseKst);
  const now = kstNowMinutes();
  return force != null && now < 12 * 60 && now >= Math.max(0, force - 1);
}

function requireStrategy(userId, id) {
  const strategy = repo.getStrategy(userId, Number(id));
  if (!strategy) throw notFound('미국장 랭킹 전략을 찾을 수 없습니다.');
  return strategy;
}

function positiveNumber(value, label) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw badRequest(`${label}은(는) 0보다 커야 합니다.`);
  return n;
}

function orderStatusNote(order, liveOrderEnabled) {
  if (order.status === 'FAILED' || order.status === 'REJECTED') {
    return `주문 실패: ${order.errorMessage || '거절됨'}`;
  }
  if (!liveOrderEnabled || order.status === 'DRY_RUN') {
    return '실주문 실행 설정이 꺼져 있어 실제 주문 없이 기록만 저장했습니다.';
  }
  return 'KIS에 주문을 전송했습니다.';
}

function sellReasonLabel(reason) {
  if (reason === 'TARGET') return '익절';
  if (reason === 'STOP_LOSS') return '손절';
  if (reason === 'FORCE_CLOSE') return '강제 청산';
  if (reason === 'CYCLE_COMPLETE') return '누적 목표 달성';
  return reason || '-';
}

function lockReasonLabel(reason) {
  if (reason === 'STOP_LOSS') return '손절';
  if (reason === 'FORCE_CLOSE') return '강제 청산';
  return '당일 잠금';
}

function pct(rate) {
  return `${(Number(rate || 0) * 100).toFixed(1)}%`;
}

function fmt(value) {
  return Number(value || 0).toLocaleString('ko-KR', { maximumFractionDigits: 2 });
}

// SQLite datetime('now')은 'YYYY-MM-DD HH:MM:SS'(UTC, 시간대 표기 없음)이라 그대로 Date에 넣으면
// 로컬 시각으로 잘못 파싱된다. UTC임을 명시해 ms로 변환한다. 파싱 불가면 0.
function sqliteUtcToMs(value) {
  if (!value) return 0;
  const raw = String(value).trim();
  const normalized = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/.test(raw)
    ? `${raw.replace(' ', 'T')}Z`
    : raw;
  const ms = Date.parse(normalized);
  return Number.isFinite(ms) ? ms : 0;
}

// 미체결 매수 주문을 best-effort로 취소하고 주문 행을 CANCELED로 표시한다. 실패해도 던지지 않는다.
async function cancelBuyOrderBestEffort(userId, trading, order) {
  if (!order) return;
  try {
    if (order.kisOrderNo) {
      await trading.cancelOpenOrder({
        market: 'US',
        symbol: order.symbol,
        exchange: order.exchange,
        kisOrderNo: order.kisOrderNo,
        kisOriginalOrderNo: order.kisOriginalOrderNo,
        quantity: order.quantity,
        remainingQuantity: order.remainingQuantity ?? order.quantity
      });
    }
  } catch (_error) {
    // KIS가 "이미 체결/취소된 주문" 등으로 거절해도 무시한다. 호출 측에서 잔고를 다시 확인한다.
  }
  try {
    repo.updateOrder(userId, order.id, { status: 'CANCELED' });
  } catch (_error) {
    // 주문 행 상태 갱신 실패는 흐름을 막지 않는다.
  }
}

function badRequest(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function notFound(message) {
  const error = new Error(message);
  error.status = 404;
  return error;
}
