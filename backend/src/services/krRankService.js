import * as repo from '../repositories/krRankRepository.js';
import * as autoTradingRepo from '../repositories/autoTradingRepository.js';
import { KisTradingService, maskPayload } from './kisTradingService.js';
import { getValidAccessToken } from './kisTokenManager.js';
import { getDomesticFluctuationRanking, getDomesticTodayMinuteCandles, getDomesticHolidays } from './marketDataService.js';
import {
  ENTRY_WINDOWS,
  resolveEntryWindow,
  selectRankingCandidates,
  computeBuyQuantity,
  evaluateFastStopLoss,
  evaluateSell,
  kstNowMinutes,
  parseHhmmMinutes,
  makeKrRankIdempotencyKey,
  checkBuyCandidate,
  maxFluctuationRateForEntryWindow
} from './krRankStrategyEngine.js';

const LOCK_KEY = 'evaluate';
const RANKING_SNAPSHOT_SIZE = 10;
// 매수 필터(분봉 단기 흐름 검사)에서 검사할 상위 후보 개수.
// 상위 후보들을 점수화해 고르되, 너무 크면 KIS 호출이 늘어 rate limit 위험이 있어 제한한다.
const BUY_FILTER_CANDIDATE_LIMIT = 5;
// 같은 (날짜·전략·구간·방향) 주문이 실패로 누적되면 더 시도하지 않는 한도.
const ORDER_RETRY_LIMIT = 5;
// 상한가를 조회하지 못했을 때 쓰는 보수적 배수 (가격제한폭 상단 = 전일종가 × 1.3 이하).
const PRICE_LIMIT_MULTIPLIER = 1.3;
// 판단 로그·주문 이력·진입 목록 페이징 기본/최대 페이지 크기.
const PAGE_SIZE_DEFAULT = 50;
const PAGE_SIZE_MAX = 200;

function normalizePaging({ limit, offset } = {}) {
  const limitNum = Math.min(Math.max(Math.trunc(Number(limit)) || PAGE_SIZE_DEFAULT, 1), PAGE_SIZE_MAX);
  const offsetNum = Math.max(Math.trunc(Number(offset)) || 0, 0);
  return { limit: limitNum, offset: offsetNum };
}

// ── 전략 CRUD ─────────────────────────────────────────────────────────────

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

export function startStrategy(userId, id) {
  const strategy = requireStrategy(userId, id);
  const started = repo.startStrategy(userId, id);
  const liveOrderEnabled = autoTradingRepo.getSettings(userId).liveOrderEnabled;
  repo.createDecisionLog(userId, {
    strategyId: strategy.id,
    decision: 'SKIP',
    liveOrderEnabled,
    evaluationSource: 'MANUAL',
    reason: `한국 국장 상승률 랭킹 전략을 시작했습니다. 서버가 30초 간격으로 평가하며, 오전 09:10 진입(${strategy.autoBudgetEnabled ? '매수 금액 자동(매수가능금액 전액)' : `매수 금액 ${fmt(strategy.morningBudget)}원`})${strategy.lunchEntryEnabled ? `, 점심 11:30 진입(${strategy.autoBudgetEnabled ? '매수 금액 자동(매수가능금액 전액)' : `매수 금액 ${fmt(strategy.lunchBudget)}원`})` : ''}에 상승률 상위 종목을 매수합니다. 실주문 설정: ${liveOrderEnabled ? '켜짐' : '꺼짐'}.`
  });
  return started;
}

export function stopStrategy(userId, id) {
  requireStrategy(userId, id);
  return repo.stopStrategy(userId, id);
}

export function listOrders(userId, strategyId = null, paging = {}) {
  if (strategyId) requireStrategy(userId, strategyId, { includeDeleted: true });
  const { limit, offset } = normalizePaging(paging);
  const items = repo.listOrders(userId, { strategyId, limit, offset });
  const total = repo.countOrders(userId, { strategyId });
  return { items, total, limit, offset };
}

export function listRoundTripOrders(userId, strategyId, paging = {}) {
  requireStrategy(userId, strategyId, { includeDeleted: true });
  const { limit, offset } = normalizePaging(paging);
  const items = repo.listRoundTripOrders(userId, { strategyId, limit, offset });
  const total = repo.countRoundTripOrders(userId, { strategyId });
  return { items, total, limit, offset };
}

export function listDecisionLogs(userId, strategyId, paging = {}) {
  requireStrategy(userId, strategyId, { includeDeleted: true });
  const { limit, offset } = normalizePaging(paging);
  const items = repo.listDecisionLogs(userId, strategyId, { limit, offset });
  const total = repo.countDecisionLogs(userId, strategyId);
  return { items, total, limit, offset };
}

export function listEntries(userId, strategyId, paging = {}) {
  requireStrategy(userId, strategyId, { includeDeleted: true });
  const { limit, offset } = normalizePaging(paging);
  const items = repo.listEntries(userId, strategyId, { limit, offset });
  const total = repo.countEntries(userId, strategyId);
  return { items, total, limit, offset };
}

// 한국 랭킹 전략 탭 요약: 실주문 설정 + 전략 목록.
export function getOverview(userId) {
  return {
    liveOrderEnabled: autoTradingRepo.getSettings(userId).liveOrderEnabled,
    strategies: repo.listStrategies(userId)
  };
}

// ── 평가 ──────────────────────────────────────────────────────────────────

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
    if (scheduled && !isKrMarketOpen()) {
      // 장 운영 시간 외 SKIP은 30초마다 폴링이라 로그를 만들지 않고 평가 시각만 갱신한다.
      return saveSkip(userId, strategy, '한국 장 운영 시간이 아니라 주문하지 않습니다.', evaluationSource, { noLog: true });
    }
    if (scheduled && !(await isKrTradingDay(userId))) {
      // 공휴일 등 휴장일에는 평일·시간 조건을 통과해도 매수하지 않는다. 폴링이라 로그는 남기지 않는다.
      return saveSkip(userId, strategy, '한국 증시 휴장일이라 주문하지 않습니다.', evaluationSource, { noLog: true });
    }
    // 평가 본 흐름에 들어가기 전에 미체결 주문의 실제 체결가를 KIS에서 끌어와 DB에 채운다.
    // 화면 렌더링이 아니라 평가 tick(이미 30초마다 도는 작업)에 끼워, 추가 폴링 없이 갱신한다.
    // 실패해도 평가는 계속 진행한다 — 체결가는 다음 tick에 다시 시도하면 된다.
    try {
      await syncOrderFills(userId, { strategyId: id });
    } catch {
      // 동기화 실패는 평가를 막지 않는다.
    }
    return await evaluateUnlocked(userId, strategy, evaluationSource);
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
      // 일시적 오류로 전략을 ERROR(영구 정지)로 만들지 않는다. RUNNING을 유지해 다음 tick에 재시도.
      repo.markEvaluation(strategy.userId, strategy.id, {
        decision: 'ERROR',
        errorMessage: error.message || '자동 평가에 실패했습니다.'
      });
    }
  }
}

async function evaluateUnlocked(userId, strategy, evaluationSource) {
  const liveOrderEnabled = autoTradingRepo.getSettings(userId).liveOrderEnabled;
  // 1분 폴링이라 할 일이 없는 tick은 KIS 호출 없이 일찍 끝낸다.
  // 무보유이고 진입 구간이 아니거나, 이미 그 구간 진입을 마쳤으면 바로 종료한다.
  // 사용자가 직접 누른 평가(MANUAL)는 응답으로 사유를 보여주기 위해 기록하지만,
  // 스케줄러(SCHEDULED) 평가에서 매분 반복되는 idle SKIP은 노이즈라 로그를 생략한다.
  const noLogIfScheduled = evaluationSource !== 'MANUAL';
  if (!strategy.holdingSymbol) {
    const window = resolveEntryWindow(new Date(), { lunchEntryEnabled: strategy.lunchEntryEnabled });
    if (!window) {
      return saveDecision(userId, strategy, {
        decision: 'SKIP', liveOrderEnabled, evaluationSource,
        reason: '지금은 오전·점심 진입 구간이 아니라 매수 평가를 하지 않습니다.',
        noLog: noLogIfScheduled
      });
    }
    // 진입 기록이 종결 상태(매수 완료 / 후보 없음)면 KIS 호출 없이 끝낸다.
    // 종목은 골랐지만 아직 매수가 안 된 상태(SELECTED)면 매수 재시도를 위해 그대로 진행한다.
    const existing = repo.getEntry(strategy.id, kstToday(), window);
    if (existing && (existing.bought || existing.status === 'NO_CANDIDATE')) {
      return saveDecision(userId, strategy, {
        decision: 'SKIP', entryWindow: window, liveOrderEnabled, evaluationSource,
        reason: existing.bought
          ? `오늘 ${ENTRY_WINDOWS[window].label} 진입 매수를 마쳤습니다.`
          : `오늘 ${ENTRY_WINDOWS[window].label} 진입: 매수 대상이 없어 매수하지 않았습니다.`,
        noLog: noLogIfScheduled
      });
    }
  }
  const trading = new KisTradingService(userId);
  let contextReady = false;
  try {
    await getValidAccessToken(userId);
    contextReady = true;
    if (strategy.holdingSymbol) {
      return await evaluateSellPath(userId, strategy, { trading, liveOrderEnabled, evaluationSource });
    }
    return await evaluateEntryPath(userId, strategy, { trading, liveOrderEnabled, evaluationSource });
  } catch (error) {
    const message = contextReady
      ? (error.message || '한국 랭킹 전략 평가에 실패했습니다.')
      : 'KIS access token 발급에 실패했습니다. App Key, App Secret, 계좌 설정을 확인하세요.';
    const log = repo.createDecisionLog(userId, {
      strategyId: strategy.id,
      decision: 'ERROR',
      liveOrderEnabled,
      evaluationSource,
      reason: message
    });
    // 일시적 KIS 오류로 전략을 ERROR(영구 정지)시키지 않는다. RUNNING을 유지해 다음 tick에 재시도.
    repo.markEvaluation(userId, strategy.id, { decision: 'ERROR', errorMessage: message });
    return { strategy: repo.getStrategy(userId, strategy.id), decision: log, order: null };
  }
}

// 보유 종목이 있을 때: 목표 수익/손절 매도 판단.
async function evaluateSellPath(userId, strategy, { trading, liveOrderEnabled, evaluationSource }) {
  const symbol = strategy.holdingSymbol;
  const entryWindow = strategy.holdingEntryWindow || 'MORNING';
  const price = await trading.getCurrentPrice(symbol, { market: 'KR' });
  const balance = await trading.getBalance(symbol, { market: 'KR', currency: 'KRW' });
  const holdingQuantity = Math.floor(Number(balance.quantity || 0));
  const averagePrice = Number(balance.averagePrice || 0);
  const currentPrice = Number(price.price || 0);

  if (holdingQuantity <= 0) {
    // KIS 잔고에 보유분이 없다 → 외부 매도/미체결 등. 보유 상태를 해제하고 다음 진입을 기다린다.
    repo.clearHolding(userId, strategy.id);
    return saveDecision(userId, strategy, {
      decision: 'SKIP',
      entryWindow,
      selectedSymbol: symbol,
      selectedSymbolName: strategy.holdingSymbolName,
      currentPrice,
      averagePrice,
      holdingQuantity,
      liveOrderEnabled,
      evaluationSource,
      reason: `보유 종목 ${symbol}의 잔고 수량이 0이라 보유 상태를 해제했습니다.`
    });
  }

  const isLunch = entryWindow === 'LUNCH';
  const targetProfitRate = isLunch ? strategy.lunchTargetProfitRate : strategy.morningTargetProfitRate;
  const stopLossRate = isLunch ? strategy.lunchStopLossRate : strategy.morningStopLossRate;
  const liquidateTime = isLunch ? strategy.lunchLiquidateTime : strategy.morningLiquidateTime;
  let sell = evaluateSell({
    currentPrice, averagePrice, targetProfitRate, stopLossRate,
    liquidateTime, nowMinutes: kstNowMinutes()
  });
  let entryFailureReason = null;
  if (sell.decision === 'HOLD') {
    try {
      const candles = await getDomesticTodayMinuteCandles(userId, symbol);
      const profitRate = averagePrice > 0 ? (currentPrice - averagePrice) / averagePrice : 0;
      const failure = evaluateFastStopLoss(candles, { profitRate });
      if (failure.failed) {
        entryFailureReason = failure.reason;
        sell = {
          decision: 'SELL',
          sellReason: 'ENTRY_FAILED',
          profitRate: averagePrice > 0 ? (currentPrice - averagePrice) / averagePrice : 0
        };
      }
    } catch {
      // 분봉 확인 실패는 기존 목표/손절 판단에 맡긴다.
    }
  }
  const profitPct = (sell.profitRate * 100).toFixed(2);

  if (sell.decision === 'HOLD') {
    const liquidateNote = liquidateTime ? `, 청산 시각 ${liquidateTime} KST 미도달` : '';
    const blockedEntryNote = describeBlockedEntryWindow(strategy, entryWindow, symbol);
    return saveDecision(userId, strategy, {
      decision: 'HOLD',
      entryWindow,
      selectedSymbol: symbol,
      selectedSymbolName: strategy.holdingSymbolName,
      currentPrice,
      averagePrice,
      holdingQuantity,
      liveOrderEnabled,
      evaluationSource,
      reason: `${symbol} 보유 중 (수익률 ${profitPct}%). ${ENTRY_WINDOWS[entryWindow].label} 진입 기준 목표 수익률 ${(targetProfitRate * 100).toFixed(1)}% / 손절 -${(stopLossRate * 100).toFixed(1)}% 미도달${liquidateNote}이라 보유를 유지합니다.${blockedEntryNote}`
    });
  }

  // SELL — 전량 매도.
  const reasonLabel = sell.sellReason === 'TARGET'
    ? '목표 수익 도달'
    : sell.sellReason === 'STOP_LOSS'
      ? '손절 기준 도달'
      : sell.sellReason === 'ENTRY_FAILED'
        ? `빠른 손절${entryFailureReason ? ` (${entryFailureReason})` : ''}`
      : `청산 시각 도달 (${liquidateTime} KST)`;
  const activeTargetOrder = repo.getActiveSellOrder({
    strategyId: strategy.id,
    entryWindow,
    symbol,
    sellReason: 'TARGET'
  });
  if (activeTargetOrder) {
    if (sell.sellReason === 'TARGET') {
      if (!activeTargetOrder.liveOrderEnabled || activeTargetOrder.status === 'DECIDED' || activeTargetOrder.status === 'DRY_RUN') {
        const filled = repo.updateOrder(userId, activeTargetOrder.id, {
          status: 'FILLED',
          filledQuantity: holdingQuantity,
          remainingQuantity: 0,
          averageFilledPrice: currentPrice
        });
        repo.clearHolding(userId, strategy.id);
        return saveDecision(userId, strategy, {
          decision: 'SELL', entryWindow, sellReason: 'TARGET',
          selectedSymbol: symbol, selectedSymbolName: strategy.holdingSymbolName,
          currentPrice, averagePrice, holdingQuantity,
          expectedQuantity: holdingQuantity, expectedPrice: currentPrice,
          expectedAmount: holdingQuantity * currentPrice,
          liveOrderEnabled, evaluationSource, orderId: filled.id,
          reason: `${symbol} 목표 수익 도달 전량 매도 (수익률 ${profitPct}%). 실주문 실행 설정이 꺼져 있어 기록으로 체결 처리했습니다.`
        });
      }
      return saveDecision(userId, strategy, {
        decision: 'SKIP', entryWindow, sellReason: 'TARGET',
        selectedSymbol: symbol, selectedSymbolName: strategy.holdingSymbolName,
        currentPrice, averagePrice, holdingQuantity, liveOrderEnabled, evaluationSource,
        orderId: activeTargetOrder.id,
        reason: `${symbol} 목표 수익 조건입니다. 이미 걸어 둔 목표가 주문의 체결을 기다립니다.`
      });
    }
    const cancelResult = await cancelTargetBeforeDefensiveSell(userId, trading, activeTargetOrder);
    if (!cancelResult.ok) {
      return saveDecision(userId, strategy, {
        decision: 'SKIP', entryWindow, sellReason: sell.sellReason,
        selectedSymbol: symbol, selectedSymbolName: strategy.holdingSymbolName,
        currentPrice, averagePrice, holdingQuantity, liveOrderEnabled, evaluationSource,
        orderId: activeTargetOrder.id,
        reason: `${symbol} ${reasonLabel}(수익률 ${profitPct}%)이나 기존 목표가 주문 취소가 확인되지 않아 새 매도 주문을 만들지 않습니다. ${cancelResult.reason}`
      });
    }
  }
  const idempotencyKey = makeKrRankIdempotencyKey({
    tradeDate: kstToday(), strategyId: strategy.id, entryWindow, side: 'SELL'
  });
  // 같은 매도가 이미 접수돼 있으면 체결을 기다린다(다음 tick에 잔고 0으로 확인되면 보유 해제).
  if (repo.hasNonFailedOrder(idempotencyKey)) {
    return saveDecision(userId, strategy, {
      decision: 'SKIP', entryWindow,
      selectedSymbol: symbol, selectedSymbolName: strategy.holdingSymbolName,
      currentPrice, averagePrice, holdingQuantity, liveOrderEnabled, evaluationSource,
      reason: `${symbol} 매도 주문이 이미 접수돼 있어 체결을 기다립니다.`
    });
  }
  // 매도가 한도만큼 실패하면 더 시도하지 않는다(영구 실패 무한 재시도 방지).
  if (repo.countFailedOrders(idempotencyKey) >= ORDER_RETRY_LIMIT) {
    return saveDecision(userId, strategy, {
      decision: 'SKIP', entryWindow,
      selectedSymbol: symbol, selectedSymbolName: strategy.holdingSymbolName,
      currentPrice, averagePrice, holdingQuantity, liveOrderEnabled, evaluationSource,
      reason: `${symbol} 매도가 ${ORDER_RETRY_LIMIT}회 실패해 더 시도하지 않습니다. 계좌를 직접 확인하세요.`
    });
  }
  const openOrders = await safeOpenOrders(trading, symbol);
  const guard = checkOrderSafety({
    side: 'SELL', quantity: holdingQuantity, openOrders, idempotencyKey, holdingQuantity
  });

  const baseOrder = {
    strategyId: strategy.id,
    symbol,
    symbolName: strategy.holdingSymbolName,
    side: 'SELL',
    entryWindow,
    sellReason: sell.sellReason,
    quantity: holdingQuantity,
    orderPrice: currentPrice,
    estimatedAmount: holdingQuantity * currentPrice,
    idempotencyKey,
    liveOrderEnabled
  };

  if (!guard.ok) {
    // 안전 검증 미통과 = "지금은 못 함". 주문 행을 만들지 않고 다음 tick에 다시 매도를 시도한다.
    return saveDecision(userId, strategy, {
      decision: 'SKIP', entryWindow,
      selectedSymbol: symbol, selectedSymbolName: strategy.holdingSymbolName,
      currentPrice, averagePrice, holdingQuantity, liveOrderEnabled, evaluationSource,
      reason: `${symbol} ${reasonLabel}(수익률 ${profitPct}%)이나 ${guard.reason} 다음 평가에서 다시 시도합니다.`
    });
  }

  const order = await placeOrder(userId, trading, baseOrder, {
    liveOrderEnabled,
    decisionReason: `${symbol} ${reasonLabel} 전량 매도 (수익률 ${profitPct}%).`
  });
  // 보유 해제는 여기서 하지 않는다. 접수(ACCEPTED)는 체결이 아니므로, 다음 tick에 KIS 잔고가
  // 0으로 확인될 때(위 holdingQuantity<=0 분기) 해제한다 — 미체결 매도로 포지션을 잃지 않도록.
  return saveDecision(userId, strategy, {
    decision: 'SELL', entryWindow, sellReason: sell.sellReason,
    selectedSymbol: symbol, selectedSymbolName: strategy.holdingSymbolName,
    currentPrice, averagePrice, holdingQuantity,
    expectedQuantity: holdingQuantity, expectedPrice: currentPrice,
    expectedAmount: baseOrder.estimatedAmount,
    liveOrderEnabled, evaluationSource, orderId: order.id,
    reason: `${symbol} ${reasonLabel} 전량 매도 (수익률 ${profitPct}%). ${orderStatusNote(order, liveOrderEnabled)}`
  });
}

// 무보유일 때: 진입 구간에서 종목을 골라 시장가 매수한다.
// 진입 기록이 없으면 랭킹을 조회해 새로 만들고, 이미 있으면(아직 매수 전) 그 종목으로 매수를
// 재시도한다 — 매수가 성공할 때까지(재시도 한도 안에서) 같은 진입 구간을 이어 시도한다.
async function evaluateEntryPath(userId, strategy, { trading, liveOrderEnabled, evaluationSource }) {
  const entryWindow = resolveEntryWindow(new Date(), { lunchEntryEnabled: strategy.lunchEntryEnabled });
  if (!entryWindow) {
    return saveDecision(userId, strategy, {
      decision: 'SKIP', liveOrderEnabled, evaluationSource,
      reason: '지금은 오전·점심 진입 구간이 아니라 매수 평가를 하지 않습니다.'
    });
  }
  const tradeDate = kstToday();
  const label = ENTRY_WINDOWS[entryWindow].label;

  // 진입 기록: 매수 완료면 종료, 종목이 정해진(SELECTED) 상태면 그 종목으로 매수 재시도.
  // 종목이 아직 없으면(진입 기록 없음 또는 레거시 NO_CANDIDATE) 랭킹+단기 흐름 필터로 재평가한다.
  let entry = repo.getEntry(strategy.id, tradeDate, entryWindow);
  let rankingSnapshot = entry ? entry.rankingSnapshot : null;
  if (entry?.bought) {
    return saveDecision(userId, strategy, {
      decision: 'SKIP', entryWindow, liveOrderEnabled, evaluationSource,
      reason: `오늘 ${label} 진입 매수를 마쳤습니다.`
    });
  }

  // 매수 대상이 아직 없으면 매 tick 랭킹을 다시 조회·필터링한다.
  // (예전에는 첫 tick에서 전원 거절되면 NO_CANDIDATE를 박아 그 구간 내내 재평가를 안 했다 — 좋은 셋업을 놓침)
  if (!entry || !entry.selectedSymbol) {
    // 랭킹 조회 실패 시 예외가 상위로 전파되어 ERROR로 기록된다(진입 기록 미생성 → 다음 tick 재시도).
    const ranking = await getDomesticFluctuationRanking(userId);
    rankingSnapshot = (ranking || []).slice(0, RANKING_SNAPSHOT_SIZE);
    // 구간별 등락률 상한 미만 후보를 모은 뒤, 매수 필터(분봉 단기 흐름)와 점수로 한 번 더 거른다.
    const maxFluctuationRate = maxFluctuationRateForEntryWindow(entryWindow);
    const candidates = selectRankingCandidates(ranking, { maxFluctuationRate })
      .slice(0, BUY_FILTER_CANDIDATE_LIMIT);
    const filterResult = await pickFirstFilteredCandidate(userId, candidates, { trading, strategy, entryWindow });
    const picked = filterResult.picked;
    let preparedBuyPlan = filterResult.buyPlan || null;

    if (!picked) {
      // 후보 없음/전원 거절: 진입 기록을 만들지 않고(또는 레거시 기록을 SELECTED로 굳히지 않고) SKIP만 한다.
      // 다음 tick에 랭킹을 다시 본다. 스케줄러 SKIP은 매분 폴링 노이즈를 막기 위해 로그를 남기지 않는다.
      const reason = candidates.length === 0
        ? `${label} 진입: 등락률 ${maxFluctuationRate * 100}% 미만 매수 대상이 없어 다음 평가에서 다시 확인합니다.`
        : `${label} 진입: 상위 ${candidates.length}개 후보가 단기 흐름·매수가능금액 검사에서 거절되어 다음 평가에서 다시 확인합니다. ${filterResult.rejections.map((r) => `${r.symbol}: ${r.reason}`).join(' / ')}`;
      return saveDecision(userId, strategy, {
        decision: 'SKIP', entryWindow, liveOrderEnabled, evaluationSource, rankingSnapshot, reason,
        noLog: evaluationSource !== 'MANUAL'
      });
    }

    if (entry) {
      // 레거시 NO_CANDIDATE 기록을 종목 확정으로 승격.
      entry = repo.updateEntrySelection(entry.id, {
        selectedSymbol: picked.symbol, selectedSymbolName: picked.name,
        selectedPrice: picked.price, selectedFluctuationRate: picked.fluctuationRate,
        rankingSnapshot
      });
    } else {
      entry = repo.createEntry(userId, {
        strategyId: strategy.id, tradeDate, entryWindow,
        status: 'SELECTED',
        selectedSymbol: picked.symbol, selectedSymbolName: picked.name,
        selectedPrice: picked.price, selectedFluctuationRate: picked.fluctuationRate,
        rankingSnapshot, bought: false
      });
      if (!entry) {
        return saveDecision(userId, strategy, {
          decision: 'SKIP', entryWindow, liveOrderEnabled, evaluationSource, rankingSnapshot,
          reason: `${label} 진입이 이미 기록되어 있어 중복 진입을 막았습니다.`
        });
      }
    }
    entry._preparedBuyPlan = preparedBuyPlan;
  }

  // 여기서부터 entry는 종목이 정해진 SELECTED 상태다. 매수(또는 재시도)를 진행한다.
  let symbol = entry.selectedSymbol;
  let symbolName = entry.selectedSymbolName;
  const idempotencyKey = makeKrRankIdempotencyKey({ tradeDate, strategyId: strategy.id, entryWindow, side: 'BUY' });

  if (repo.hasNonFailedOrder(idempotencyKey)) {
    // 매수 주문이 이미 접수돼 있다. 접수(ACCEPTED)는 체결이 아니므로 낙관적으로 보유 처리하면
    // 미체결분을 다음 tick에 매도 평가할 수 있다. 실주문은 KIS 잔고로 체결을 확인한 뒤에만 보유로 전환한다.
    // 기록 모드(DRY_RUN)는 실제 주문·잔고가 없으므로 시뮬레이션으로 즉시 보유 전환한다.
    if (!liveOrderEnabled) {
      repo.updateEntryOutcome(entry.id, { status: 'BOUGHT', bought: true });
      repo.setHolding(userId, strategy.id, { symbol, symbolName, entryWindow });
      const buyOrder = repo.getActiveOrderByIdempotencyKey?.(idempotencyKey) || null;
      if (buyOrder) await ensureKrTargetSellOrder(userId, trading, buyOrder);
      return saveDecision(userId, strategy, {
        decision: 'SKIP', entryWindow, selectedSymbol: symbol, selectedSymbolName: symbolName,
        liveOrderEnabled, evaluationSource, reason: `${label} 진입: ${symbol} 매수 기록이 이미 있어 보유로 둡니다(기록 모드).`
      });
    }
    const balance = await trading.getBalance(symbol, { market: 'KR', currency: 'KRW' });
    const filledQuantity = Math.floor(Number(balance.quantity || 0));
    if (filledQuantity > 0) {
      repo.updateEntryOutcome(entry.id, { status: 'BOUGHT', bought: true });
      repo.setHolding(userId, strategy.id, { symbol, symbolName, entryWindow });
      const buyOrder = repo.getActiveOrderByIdempotencyKey?.(idempotencyKey) || null;
      if (buyOrder) {
        await ensureKrTargetSellOrder(userId, trading, {
          ...buyOrder,
          status: 'FILLED',
          filledQuantity,
          averageFilledPrice: Number(balance.averagePrice || buyOrder.averageFilledPrice || buyOrder.orderPrice || 0)
        });
      }
      return saveDecision(userId, strategy, {
        decision: 'SKIP', entryWindow, selectedSymbol: symbol, selectedSymbolName: symbolName,
        liveOrderEnabled, evaluationSource,
        reason: `${label} 진입: ${symbol} 매수 체결 확인(${filledQuantity}주). 보유로 전환했습니다.`
      });
    }
    return saveDecision(userId, strategy, {
      decision: 'SKIP', entryWindow, selectedSymbol: symbol, selectedSymbolName: symbolName,
      liveOrderEnabled, evaluationSource,
      reason: `${label} 진입: ${symbol} 매수 주문이 접수됐으나 아직 체결되지 않아 보유 전환을 보류합니다.`
    });
  }
  if (repo.countFailedOrders(idempotencyKey) >= ORDER_RETRY_LIMIT) {
    return saveDecision(userId, strategy, {
      decision: 'SKIP', entryWindow, selectedSymbol: symbol, selectedSymbolName: symbolName,
      liveOrderEnabled, evaluationSource,
      reason: `${label} 진입: ${symbol} 매수가 ${ORDER_RETRY_LIMIT}회 실패해 더 시도하지 않습니다.`
    });
  }

  let buyPlan = entry._preparedBuyPlan || await buildKrBuyPlan(trading, strategy, entryWindow, {
    symbol,
    price: entry.selectedPrice
  });

  if (buyPlan.quantity <= 0) {
    // 예전 배포에서 이미 고가 종목이 SELECTED로 고정된 경우를 풀고, 같은 tick에서 다음 후보를 찾는다.
    const ranking = await getDomesticFluctuationRanking(userId);
    rankingSnapshot = (ranking || []).slice(0, RANKING_SNAPSHOT_SIZE);
    const candidates = selectRankingCandidates(ranking, { maxFluctuationRate: MAX_FLUCTUATION_RATE })
      .filter((candidate) => candidate.symbol !== symbol)
      .slice(0, BUY_FILTER_CANDIDATE_LIMIT);
    const filterResult = await pickFirstFilteredCandidate(userId, candidates, { trading, strategy, entryWindow });
    if (filterResult.picked) {
      entry = repo.updateEntrySelection(entry.id, {
        selectedSymbol: filterResult.picked.symbol,
        selectedSymbolName: filterResult.picked.name,
        selectedPrice: filterResult.picked.price,
        selectedFluctuationRate: filterResult.picked.fluctuationRate,
        rankingSnapshot
      });
      symbol = entry.selectedSymbol;
      symbolName = entry.selectedSymbolName;
      buyPlan = filterResult.buyPlan;
    } else {
      repo.clearEntrySelection(entry.id, { rankingSnapshot });
      const budgetNote = strategy.autoBudgetEnabled
        ? `매수가능금액 ${fmt(buyPlan.cashAvailable)}원(자동 예산 모드)`
        : `매수 금액 한도 ${fmt(buyPlan.entryBudget)}원·매수가능금액 ${fmt(buyPlan.cashAvailable)}원`;
      const rejectionNote = filterResult.rejections.length > 0
        ? ` 다음 후보도 조건을 통과하지 못했습니다. ${filterResult.rejections.map((r) => `${r.symbol}: ${r.reason}`).join(' / ')}`
        : ' 다음 후보가 없습니다.';
      return saveDecision(userId, strategy, {
        decision: 'SKIP', entryWindow, selectedSymbol: symbol, selectedSymbolName: symbolName,
        currentPrice: buyPlan.currentPrice, cashAvailable: buyPlan.cashAvailable, rankingSnapshot, liveOrderEnabled, evaluationSource,
        reason: `${label} 진입: ${symbol} ${budgetNote}으로 1주도 매수할 수 없어 후보에서 제외했습니다.${rejectionNote}`,
        noLog: evaluationSource !== 'MANUAL'
      });
    }
  }

  const { currentPrice, cashAvailable, quantity, estimatedAmount } = buyPlan;

  if (quantity <= 0) {
    return saveDecision(userId, strategy, {
      decision: 'SKIP', entryWindow, selectedSymbol: symbol, selectedSymbolName: symbolName,
      currentPrice, cashAvailable, rankingSnapshot, liveOrderEnabled, evaluationSource,
      reason: `${label} 진입: ${symbol} 매수가능금액으로 1주도 매수할 수 없습니다.`,
      noLog: evaluationSource !== 'MANUAL'
    });
  }

  const openOrders = await safeOpenOrders(trading, symbol);
  const guard = checkOrderSafety({ side: 'BUY', quantity, openOrders, idempotencyKey, cashAvailable, estimatedAmount });
  if (!guard.ok) {
    // 안전 검증 미통과 = "지금은 못 함". 주문 행을 만들지 않고 진입 기록은 SELECTED 유지 → 다음 tick 재시도.
    return saveDecision(userId, strategy, {
      decision: 'SKIP', entryWindow, selectedSymbol: symbol, selectedSymbolName: symbolName,
      currentPrice, cashAvailable, rankingSnapshot, liveOrderEnabled, evaluationSource,
      reason: `${label} 진입: ${symbol} 매수 대상이나 ${guard.reason} 다음 평가에서 다시 시도합니다.`
    });
  }

  const order = await placeOrder(userId, trading, {
    strategyId: strategy.id, entryId: entry.id, symbol, symbolName, side: 'BUY', entryWindow,
    quantity, orderPrice: currentPrice, estimatedAmount, idempotencyKey, liveOrderEnabled
  }, {
    liveOrderEnabled,
    decisionReason: `${label} 진입: ${symbol} ${quantity}주 시장가 매수.`
  });
  // 기록 모드(DRY_RUN)는 실제 주문이 없어 즉시 보유로 시뮬레이션한다.
  // 실주문(ACCEPTED 등)은 접수일 뿐 체결이 아니므로 보유 전환을 미루고, 다음 tick의
  // hasNonFailedOrder 분기에서 KIS 잔고로 체결을 확인한 뒤 전환한다(미체결분 오평가 방지).
  if (order.status === 'DRY_RUN') {
    repo.updateEntryOutcome(entry.id, { status: 'BOUGHT', bought: true });
    repo.setHolding(userId, strategy.id, { symbol, symbolName, entryWindow });
    await ensureKrTargetSellOrder(userId, trading, order);
  }
  // 실패면 진입 기록은 SELECTED 그대로 — 다음 tick에 재시도(한도 안에서).
  return saveDecision(userId, strategy, {
    decision: 'BUY', entryWindow, selectedSymbol: symbol, selectedSymbolName: symbolName,
    currentPrice, cashAvailable,
    expectedQuantity: quantity, expectedPrice: currentPrice, expectedAmount: estimatedAmount,
    rankingSnapshot, liveOrderEnabled, evaluationSource, orderId: order.id,
    reason: `${label} 진입: ${symbol} ${quantity}주 시장가 매수. ${orderStatusNote(order, liveOrderEnabled)}`
  });
}

// ── 체결가 동기화 ─────────────────────────────────────────────────────────

// 미체결(접수/부분체결/UNKNOWN) 상태인 실주문의 실제 체결가를 KIS 체결조회로 가져와
// kr_rank_orders.average_filled_price·filled_quantity·status를 갱신한다.
//
// 호출 원칙: 화면 렌더링이 아니라 "주문 이벤트"나 사용자의 명시적 동기화 요청 때만 호출한다.
// 평가 tick(30초), 주문 직후 지연 트리거, 수동 동기화에서만 KIS 체결조회를 사용한다.
// 종결 상태라도 실체결가가 비어 있는 FILLED 주문은 과거 이력 보정 대상이다.
//
// 같은 종목의 여러 주문은 KIS 체결조회를 1회만 호출하고 주문번호로 매칭한다(KIS 호출 절감).
export async function syncOrderFills(userId, { strategyId = null, limit = 20 } = {}) {
  if (strategyId) requireStrategy(userId, strategyId, { includeDeleted: true });
  const candidates = repo.listFillSyncCandidates(userId, { strategyId, limit });
  if (candidates.length === 0) return [];
  let trading;
  try {
    await getValidAccessToken(userId);
    trading = new KisTradingService(userId);
  } catch {
    // KIS 토큰 발급 실패는 일시적일 수 있다. 다음 호출에서 재시도.
    return [];
  }

  // 같은 symbol에 대한 KIS 체결조회는 1회만 호출하고 캐시한다(주문번호로 행 매칭).
  const historyCache = new Map();
  const updated = [];
  for (const order of candidates) {
    try {
      const dateWindow = orderHistoryDateWindow(order);
      const cacheKey = `${order.symbol}::${dateWindow.startDate}::${dateWindow.endDate}`;
      let history = historyCache.get(cacheKey);
      if (history == null) {
        try {
          history = await trading.getOrderHistory(order.symbol, {
            market: 'KR',
            ...dateWindow
          });
        } catch {
          history = [];
        }
        if (!Array.isArray(history)) history = [];
        historyCache.set(cacheKey, history);
      }
      const matched = history.find((row) => (
        (order.kisOrderNo && row.orderNo === order.kisOrderNo)
        || (order.kisOriginalOrderNo && row.originalOrderNo === order.kisOriginalOrderNo)
      ));
      if (!matched) continue;
      const filledQty = Math.floor(Number(matched.filledQuantity || 0));
      const remaining = matched.remainingQuantity != null && matched.remainingQuantity !== ''
        ? Number(matched.remainingQuantity)
        : null;
      const avgFilledPrice = Number(matched.averageFilledPrice || 0);
      // 체결 정보가 전혀 없으면(아직 체결 전) 갱신하지 않는다 — 다음 tick에 다시 시도.
      if (filledQty <= 0 && avgFilledPrice <= 0) continue;

      const status = matched.status === 'FILLED' || (remaining != null && remaining <= 0 && filledQty > 0)
        ? 'FILLED'
        : (filledQty > 0 ? 'PARTIALLY_FILLED' : order.status);

      const result = repo.updateOrder(userId, order.id, {
        status,
        // updateOrder는 NULL을 그대로 덮어쓰니, 새 데이터가 없으면 기존 값으로 유지한다.
        filledQuantity: filledQty > 0 ? filledQty : (order.filledQuantity ?? null),
        remainingQuantity: remaining != null ? remaining : (order.remainingQuantity ?? null),
        averageFilledPrice: avgFilledPrice > 0 ? avgFilledPrice : (order.averageFilledPrice ?? null)
      });
      if (result) updated.push(result);
      if (result?.side === 'BUY' && result.status === 'FILLED') {
        await ensureKrTargetSellOrder(userId, trading, result);
      }
    } catch {
      // 한 주문의 동기화 실패는 다른 주문 처리를 막지 않는다.
    }
  }
  return updated;
}

// 주문 접수 직후(체결까지 보통 수 초)에 호출해, 다음 30초 tick보다 빠르게 체결가를 갱신한다.
// 비동기 fire-and-forget — 호출자는 await 하지 않는다. 실패해도 다음 평가 tick이 재시도한다.
function scheduleFillSyncAfterPlacement(userId, strategyId) {
  setTimeout(() => {
    syncOrderFills(userId, { strategyId }).catch(() => {});
  }, 3000).unref?.();
}

function orderHistoryDateWindow(order) {
  const raw = String(order?.createdAt || '').trim();
  const normalized = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/.test(raw)
    ? `${raw.replace(' ', 'T')}Z`
    : raw;
  const base = normalized ? new Date(normalized) : new Date();
  const date = Number.isNaN(base.getTime()) ? new Date() : base;
  return {
    startDate: compactDateInKst(addDays(date, -1)),
    endDate: compactDateInKst(addDays(date, 1))
  };
}

function addDays(date, days) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function compactDateInKst(date) {
  const parts = {};
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== 'literal') parts[part.type] = part.value;
  }
  return `${parts.year}${parts.month}${parts.day}`;
}

// ── 주문 실행 ─────────────────────────────────────────────────────────────

// 실주문 OFF면 DRY_RUN 기록만, ON이면 KIS로 실제 전송. 실패해도 재시도하지 않는다.
async function placeOrder(userId, trading, baseOrder, { liveOrderEnabled, decisionReason }) {
  const orderInput = {
    ...baseOrder,
    market: 'KR',
    currency: 'KRW',
    // 기본은 시장가다. 목표 수익 선주문만 지정가로 넘긴다.
    orderType: baseOrder.orderType || 'MARKET',
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
      ? await trading.placeBuyOrder({ ...orderInput })
      : await trading.placeSellOrder({ ...orderInput });
    const created = repo.createOrder(userId, {
      ...orderInput,
      status: result.status || 'ACCEPTED',
      kisOrderNo: result.orderNo,
      kisOriginalOrderNo: result.originalOrderNo,
      requestPayloadMasked: result.requestPayloadMasked || maskPayload(orderInput),
      responsePayloadMasked: result.responsePayloadMasked
    });
    // 시장가는 보통 수 초 내 체결되므로, 다음 30초 tick을 기다리지 않고
    // 3초 뒤 1회 체결조회로 실체결가를 일찍 끌어오게 한다. 실패해도 다음 tick이 재시도.
    if (created && created.kisOrderNo) {
      scheduleFillSyncAfterPlacement(userId, baseOrder.strategyId);
    }
    return created;
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

async function ensureKrTargetSellOrder(userId, trading, buyOrder) {
  if (!buyOrder || buyOrder.side !== 'BUY') return null;
  const strategy = repo.getStrategy(userId, buyOrder.strategyId, { includeDeleted: true });
  if (!strategy) return null;
  const entryWindow = buyOrder.entryWindow || strategy.holdingEntryWindow || 'MORNING';
  const existing = repo.getActiveSellOrder({
    strategyId: strategy.id,
    entryWindow,
    symbol: buyOrder.symbol,
    sellReason: 'TARGET'
  });
  if (existing) return existing;

  const quantity = Math.floor(Number(buyOrder.filledQuantity || buyOrder.quantity || 0));
  const averageFilledPrice = Number(buyOrder.averageFilledPrice || buyOrder.orderPrice || 0);
  if (quantity <= 0 || averageFilledPrice <= 0) return null;
  const targetProfitRate = entryWindow === 'LUNCH'
    ? strategy.lunchTargetProfitRate
    : strategy.morningTargetProfitRate;
  const targetPrice = Math.ceil(averageFilledPrice * (1 + Number(targetProfitRate || 0)));
  const idempotencyKey = `${makeKrRankIdempotencyKey({
    tradeDate: kstToday(),
    strategyId: strategy.id,
    entryWindow,
    side: 'SELL'
  })}-TARGET`;
  if (repo.hasNonFailedOrder(idempotencyKey)) return null;

  const baseOrder = {
    strategyId: strategy.id,
    entryId: buyOrder.entryId,
    symbol: buyOrder.symbol,
    symbolName: buyOrder.symbolName || strategy.holdingSymbolName,
    side: 'SELL',
    entryWindow,
    sellReason: 'TARGET',
    quantity,
    orderPrice: targetPrice,
    estimatedAmount: quantity * targetPrice,
    idempotencyKey,
    liveOrderEnabled: buyOrder.liveOrderEnabled,
    orderType: 'LIMIT'
  };
  const decisionReason = `${buyOrder.symbol} 매수 체결 확인 후 목표 수익 지정가 매도 예약 (${fmt(targetPrice)}원).`;
  if (!buyOrder.liveOrderEnabled) {
    return repo.createOrder(userId, {
      ...baseOrder,
      status: 'DECIDED',
      decisionReason,
      requestPayloadMasked: maskPayload({ ...baseOrder, market: 'KR', currency: 'KRW', decisionReason })
    });
  }
  return placeOrder(userId, trading, baseOrder, {
    liveOrderEnabled: true,
    decisionReason
  });
}

async function cancelTargetBeforeDefensiveSell(userId, trading, order) {
  if (!order) return { ok: true, reason: '' };
  if (!order.liveOrderEnabled || order.status === 'DECIDED' || order.status === 'DRY_RUN') {
    repo.updateOrder(userId, order.id, { status: 'CANCELED' });
    return { ok: true, reason: '기존 목표가 예정 기록을 취소했습니다.' };
  }
  if (!order.kisOrderNo) {
    return { ok: false, reason: 'KIS 주문번호가 없어 목표가 주문 취소를 확인할 수 없습니다.' };
  }
  try {
    await trading.cancelOpenOrder({
      market: 'KR',
      symbol: order.symbol,
      kisOrderNo: order.kisOrderNo,
      kisOriginalOrderNo: order.kisOriginalOrderNo,
      quantity: order.quantity,
      remainingQuantity: order.remainingQuantity ?? order.quantity
    });
    repo.updateOrder(userId, order.id, { status: 'CANCELED' });
    return { ok: true, reason: '기존 목표가 주문을 취소했습니다.' };
  } catch (error) {
    return { ok: false, reason: error.message || '취소 요청 실패' };
  }
}

// ── 안전 검증 (autoTradingSafetyGuard 와 동등, kr_rank_orders 기준 중복 검사) ──

function checkOrderSafety({
  side, quantity, openOrders, idempotencyKey,
  cashAvailable = 0, estimatedAmount = 0, holdingQuantity = 0
}) {
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return { ok: false, reason: '주문 수량이 0이라 주문하지 않습니다.' };
  }
  if (Array.isArray(openOrders) && openOrders.length > 0) {
    // KIS 미체결 목록 기준. DB 주문 상태는 시장가 체결 후에도 ACCEPTED로 남을 수 있어 쓰지 않는다.
    return { ok: false, reason: '미체결 주문이 있어 신규 주문을 만들지 않습니다.' };
  }
  if (repo.hasNonFailedOrder(idempotencyKey)) {
    return { ok: false, reason: '같은 주문이 이미 접수돼 있습니다.' };
  }
  if (side === 'BUY' && cashAvailable < estimatedAmount) {
    return { ok: false, reason: `매수가능금액이 부족합니다. 필요 ${fmt(estimatedAmount)}원, 가능 ${fmt(cashAvailable)}원.` };
  }
  if (side === 'SELL' && holdingQuantity < quantity) {
    return { ok: false, reason: `보유 수량이 부족합니다. 필요 ${quantity}주, 보유 ${holdingQuantity}주.` };
  }
  return { ok: true };
}

// ── 헬퍼 ──────────────────────────────────────────────────────────────────

// 1분 간격 폴링의 모든 평가(HOLD·SKIP 포함)를 판단 로그에 기록한다.
// 단, 호출 측에서 noLog: true를 넘긴 평가(장 운영 시간 외 SKIP 등)는 로그를 만들지 않는다.
function saveDecision(userId, strategy, input) {
  const evaluationSource = input.evaluationSource || 'SCHEDULED';
  const decision = input.decision;
  if (decision === 'SKIP' && evaluationSource !== 'MANUAL') {
    // 스케줄러 idle SKIP: last_decision은 보존하고 평가 시각만 갱신.
    repo.touchEvaluation(userId, strategy.id);
  } else {
    repo.markEvaluation(userId, strategy.id, {
      decision,
      errorMessage: decision === 'ERROR' ? input.reason : null
    });
  }
  const log = input.noLog
    ? null
    : repo.createDecisionLog(userId, { strategyId: strategy.id, ...input });
  const order = input.orderId ? repo.getOrder(userId, input.orderId) : null;
  return { strategy: repo.getStrategy(userId, strategy.id), decision: log, order };
}

function saveSkip(userId, strategy, reason, evaluationSource, { noLog = false } = {}) {
  const liveOrderEnabled = autoTradingRepo.getSettings(userId).liveOrderEnabled;
  return saveDecision(userId, strategy, { decision: 'SKIP', liveOrderEnabled, evaluationSource, reason, noLog });
}

async function safeOpenOrders(trading, symbol) {
  try {
    return await trading.getOpenOrders(symbol, { market: 'KR', currency: 'KRW' });
  } catch {
    return [];
  }
}

// 상위 후보를 순서대로 보면서 매수 필터(시가·VWAP·거래량·장대 음봉·고점 돌파)를 적용한다.
// 통과 후보 중 점수가 가장 높은 후보를 picked로 반환한다. 모두 거절되면 picked=null과 거절 사유 목록을 함께 돌려준다.
// 분봉 조회가 실패한 후보는 단기 흐름 확인 불가로 보수적으로 건너뛴다.
async function pickFirstFilteredCandidate(userId, candidates, { trading = null, strategy = null, entryWindow = null } = {}) {
  const rejections = [];
  const accepted = [];
  for (const candidate of candidates) {
    let candles = [];
    try {
      candles = await getDomesticTodayMinuteCandles(userId, candidate.symbol);
    } catch (error) {
      rejections.push({ symbol: candidate.symbol, reason: `분봉 조회 실패(${error.message || '알 수 없음'})` });
      continue;
    }
    const check = checkBuyCandidate(candles, { candidate });
    if (!check.ok) {
      rejections.push({ symbol: candidate.symbol, reason: check.reason });
      continue;
    }
    accepted.push({ picked: candidate, score: check.score ?? 0, rejections });
  }
  accepted.sort((a, b) => b.score - a.score);
  if (!trading || !strategy || !entryWindow) {
    return accepted[0] || { picked: null, rejections };
  }
  for (const result of accepted) {
    let buyPlan;
    try {
      buyPlan = await buildKrBuyPlan(trading, strategy, entryWindow, result.picked);
    } catch (error) {
      rejections.push({ symbol: result.picked.symbol, reason: `매수가능금액 확인 실패(${error.message || '알 수 없음'})` });
      continue;
    }
    if (buyPlan.quantity <= 0) {
      const budgetNote = strategy.autoBudgetEnabled
        ? `매수가능금액 ${fmt(buyPlan.cashAvailable)}원`
        : `매수 금액 한도 ${fmt(buyPlan.entryBudget)}원·매수가능금액 ${fmt(buyPlan.cashAvailable)}원`;
      rejections.push({
        symbol: result.picked.symbol,
        reason: `${budgetNote}으로 ${fmt(buyPlan.marginPrice)}원 기준 1주도 살 수 없음`
      });
      continue;
    }
    return { ...result, buyPlan, rejections };
  }
  return { picked: null, rejections };
}

async function buildKrBuyPlan(trading, strategy, entryWindow, candidate) {
  const [priceQuote, buyingPower] = await Promise.all([
    trading.getCurrentPrice(candidate.symbol, { market: 'KR' }),
    trading.getBuyingPower(candidate.symbol, { market: 'KR', currency: 'KRW', price: candidate.price })
  ]);
  const currentPrice = Number(priceQuote.price) || Number(candidate.price) || 0;
  const marginPrice = Number(priceQuote.upperLimitPrice) > 0
    ? Number(priceQuote.upperLimitPrice)
    : currentPrice * PRICE_LIMIT_MULTIPLIER;
  const cashAvailable = Number(buyingPower.cashAvailable || 0);
  const entryBudget = strategy.autoBudgetEnabled
    ? cashAvailable
    : (entryWindow === 'LUNCH' ? strategy.lunchBudget : strategy.morningBudget);
  const quantity = computeBuyQuantity(Math.min(entryBudget, cashAvailable), marginPrice);
  return {
    currentPrice,
    marginPrice,
    cashAvailable,
    entryBudget,
    quantity,
    estimatedAmount: quantity * currentPrice
  };
}

// 보유 종목 때문에 신규 진입이 차단되는 상황을 사유에 명시한다.
// 지금이 어떤 진입 구간이고, 그 구간에 대한 오늘의 진입 기록이 아직 없으면
// "다른 매수분 보유 중이라 이번 구간 진입을 건너뜁니다" 메모를 돌려준다.
// 같은 구간이라도 오늘 새 진입을 못 하는 경우(예: 어제 매수분 오버나잇 보유)도 포함된다.
function describeBlockedEntryWindow(strategy, holdingEntryWindow, symbol) {
  const currentWindow = resolveEntryWindow(new Date(), { lunchEntryEnabled: strategy.lunchEntryEnabled });
  if (!currentWindow) return '';
  const todayEntry = repo.getEntry(strategy.id, kstToday(), currentWindow);
  if (todayEntry) return '';
  const currentLabel = ENTRY_WINDOWS[currentWindow].label;
  const holdingLabel = ENTRY_WINDOWS[holdingEntryWindow].label;
  return ` 지금은 ${currentLabel} 진입 구간이지만 ${holdingLabel} 매수분(${symbol}) 보유 중이라 ${currentLabel} 진입을 건너뜁니다.`;
}

function orderStatusNote(order, liveOrderEnabled) {
  if (order.status === 'FAILED' || order.status === 'REJECTED') {
    return `주문 실패: ${order.errorMessage || '거절됨'} (자동 재시도하지 않습니다.)`;
  }
  if (!liveOrderEnabled || order.status === 'DRY_RUN') {
    return '실주문 실행 설정이 꺼져 있어 실제 주문 없이 기록만 저장했습니다.';
  }
  return 'KIS에 주문을 전송했습니다.';
}

function normalizeStrategyInput(input = {}) {
  const lunchEntryEnabled = input.lunchEntryEnabled === true;
  const autoBudgetEnabled = input.autoBudgetEnabled === true;
  // 자동 예산 모드면 매수 금액은 평가 시점 KIS 매수가능금액을 그대로 쓰므로 입력값을 검증하지 않고 0으로 저장한다.
  const morningBudget = autoBudgetEnabled ? 0 : positiveNumber(input.morningBudget, '오전 매수 금액');
  const morningTargetProfitRate = positiveNumber(input.morningTargetProfitRate, '오전 목표 수익률');
  const morningStopLossRate = positiveNumber(input.morningStopLossRate, '오전 손절 기준');
  // 오전 진입 구간(09:10) 이전 시각으로 청산을 잡으면 매수 직후 즉시 청산되어 의미 없는 거래가 된다.
  const morningLiquidateTime = optionalHhmm(
    input.morningLiquidateTime, '오전 청산 시각',
    { afterMinutes: ENTRY_WINDOWS.MORNING.startMinutes, afterLabel: '오전 진입 시각(09:10)' }
  );

  // 점심 진입을 켜면 하루 두 번 매수하므로 점심 매수 금액·목표 수익률·손절 기준을 따로 입력받는다.
  // 점심 진입이 꺼져 있으면 lunch_* 값은 사용하지 않으므로 오전 값으로 채워 둔다.
  let lunchBudget = 0;
  let lunchTargetProfitRate = morningTargetProfitRate;
  let lunchStopLossRate = morningStopLossRate;
  let lunchLiquidateTime = null;
  if (lunchEntryEnabled) {
    lunchBudget = autoBudgetEnabled ? 0 : positiveNumber(input.lunchBudget, '점심 매수 금액');
    lunchTargetProfitRate = positiveNumber(input.lunchTargetProfitRate, '점심 목표 수익률');
    lunchStopLossRate = positiveNumber(input.lunchStopLossRate, '점심 손절 기준');
    // 점심 진입 시각(11:30) 이전 시각으로 청산을 잡으면 점심 매수 직후 즉시 청산된다.
    lunchLiquidateTime = optionalHhmm(
      input.lunchLiquidateTime, '점심 청산 시각',
      { afterMinutes: ENTRY_WINDOWS.LUNCH.startMinutes, afterLabel: '점심 진입 시각(11:30)' }
    );
  }
  return {
    morningBudget, morningTargetProfitRate, morningStopLossRate, morningLiquidateTime,
    lunchEntryEnabled, lunchBudget, lunchTargetProfitRate, lunchStopLossRate, lunchLiquidateTime,
    autoBudgetEnabled
  };
}

function positiveNumber(value, label) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw badRequest(`${label}은(는) 0보다 커야 합니다.`);
  return n;
}

// 'HH:MM' KST 24시간 표기 검증. 빈 값/null이면 청산 시각을 쓰지 않는다는 뜻으로 null 반환.
// afterMinutes를 주면 그 시각보다 뒤여야 한다(매수 직후 즉시 청산 footgun 차단).
function optionalHhmm(value, label, { afterMinutes = null, afterLabel = null } = {}) {
  if (value == null || value === '') return null;
  const minutes = parseHhmmMinutes(value);
  if (minutes == null) throw badRequest(`${label}은(는) 'HH:MM' 24시간 표기여야 합니다 (예: 14:30).`);
  if (afterMinutes != null && minutes <= afterMinutes) {
    throw badRequest(`${label}은(는) ${afterLabel} 이후여야 합니다. 그 이전이면 매수 직후 즉시 청산됩니다.`);
  }
  return value;
}

function requireStrategy(userId, id, { includeDeleted = false } = {}) {
  const strategy = repo.getStrategy(userId, Number(id), { includeDeleted });
  if (!strategy) throw notFound('한국 랭킹 전략을 찾을 수 없습니다.');
  return strategy;
}

function isKrMarketOpen() {
  const kst = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  const day = kst.getDay();
  if (day === 0 || day === 6) return false;
  const minutes = kst.getHours() * 60 + kst.getMinutes();
  return minutes >= 9 * 60 && minutes <= 15 * 60 + 30;
}

// 휴장일 판정 결과는 시장 전체에 공통이라 날짜별로 1회만 KIS에 묻고 프로세스 캐시에 담는다
// (KIS 안내: 국내휴장일조회는 1일 1회 호출 권장). 평일·장중에만 호출되므로 호출량이 적다.
let krTradingDayCache = { date: null, isOpen: null };

async function isKrTradingDay(userId) {
  const today = kstYyyymmdd();
  if (krTradingDayCache.date === today && krTradingDayCache.isOpen !== null) {
    return krTradingDayCache.isOpen;
  }
  try {
    const holidays = await getDomesticHolidays(userId, today);
    const todayEntry = holidays.find((row) => row.date === today);
    // 응답에 오늘이 없으면 보수적으로 개장일로 간주해 기존 동작(평일·시간 체크)에 맡긴다.
    const isOpen = todayEntry ? todayEntry.isOpen : true;
    krTradingDayCache = { date: today, isOpen };
    return isOpen;
  } catch {
    // 휴장일 API 실패는 평가를 막지 않는다. 평일·시간 체크에 위임(개장일로 간주)하고 다음 tick에 재시도.
    return true;
  }
}

function kstYyyymmdd() {
  return kstToday().replace(/-/g, '');
}

function kstToday() {
  const kst = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  const y = kst.getFullYear();
  const m = String(kst.getMonth() + 1).padStart(2, '0');
  const d = String(kst.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function fmt(value) {
  return Number(value || 0).toLocaleString('ko-KR', { maximumFractionDigits: 0 });
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
