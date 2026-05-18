import * as repo from '../repositories/krRankRepository.js';
import * as autoTradingRepo from '../repositories/autoTradingRepository.js';
import { KisTradingService, maskPayload } from './kisTradingService.js';
import { getValidAccessToken } from './kisTokenManager.js';
import { getDomesticFluctuationRanking } from './marketDataService.js';
import {
  ENTRY_WINDOWS,
  resolveEntryWindow,
  selectRankingCandidate,
  computeBuyQuantity,
  evaluateSell,
  makeKrRankIdempotencyKey,
  MAX_FLUCTUATION_RATE
} from './krRankStrategyEngine.js';

const LOCK_KEY = 'evaluate';
const RANKING_SNAPSHOT_SIZE = 10;

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
    reason: `한국 국장 상승률 랭킹 전략을 시작했습니다. 서버가 1분 간격으로 평가하며, 오전 09:10 진입(매수 금액 ${fmt(strategy.morningBudget)}원)${strategy.lunchEntryEnabled ? `, 점심 11:30 진입(매수 금액 ${fmt(strategy.lunchBudget)}원)` : ''}에 상승률 상위 종목을 매수합니다. 실주문 설정: ${liveOrderEnabled ? '켜짐' : '꺼짐'}.`
  });
  return started;
}

export function stopStrategy(userId, id) {
  requireStrategy(userId, id);
  return repo.stopStrategy(userId, id);
}

export function listOrders(userId, strategyId = null) {
  if (strategyId) requireStrategy(userId, strategyId);
  return repo.listOrders(userId, { strategyId });
}

export function listDecisionLogs(userId, strategyId) {
  requireStrategy(userId, strategyId);
  return repo.listDecisionLogs(userId, strategyId);
}

export function listEntries(userId, strategyId) {
  requireStrategy(userId, strategyId);
  return repo.listEntries(userId, strategyId);
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
      return saveSkip(userId, strategy, '한국 장 운영 시간이 아니라 주문하지 않습니다.', evaluationSource);
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
      repo.setStrategyError(strategy.userId, strategy.id, error.message || '자동 평가에 실패했습니다.');
    }
  }
}

async function evaluateUnlocked(userId, strategy, evaluationSource) {
  const liveOrderEnabled = autoTradingRepo.getSettings(userId).liveOrderEnabled;
  // 1분 폴링이라 할 일이 없는 tick은 KIS 호출 없이 일찍 끝낸다.
  // 무보유이고 진입 구간이 아니거나, 이미 그 구간 진입을 마쳤으면 바로 종료한다.
  if (!strategy.holdingSymbol) {
    const window = resolveEntryWindow(new Date(), { lunchEntryEnabled: strategy.lunchEntryEnabled });
    if (!window) {
      return saveDecision(userId, strategy, {
        decision: 'SKIP', liveOrderEnabled, evaluationSource,
        reason: '지금은 오전·점심 진입 구간이 아니라 매수 평가를 하지 않습니다.'
      });
    }
    if (repo.getEntry(strategy.id, kstToday(), window)) {
      return saveDecision(userId, strategy, {
        decision: 'SKIP', entryWindow: window, liveOrderEnabled, evaluationSource,
        reason: `오늘 ${ENTRY_WINDOWS[window].label} 진입은 이미 실행했습니다. 같은 진입 구간에서는 다시 매수하지 않습니다.`
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
    repo.setStrategyError(userId, strategy.id, message);
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
  const sell = evaluateSell({ currentPrice, averagePrice, targetProfitRate, stopLossRate });
  const profitPct = (sell.profitRate * 100).toFixed(2);

  if (sell.decision === 'HOLD') {
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
      reason: `${symbol} 보유 중 (수익률 ${profitPct}%). ${ENTRY_WINDOWS[entryWindow].label} 진입 기준 목표 수익률 ${(targetProfitRate * 100).toFixed(1)}% / 손절 -${(stopLossRate * 100).toFixed(1)}% 미도달이라 보유를 유지합니다.`
    });
  }

  // SELL — 전량 매도.
  const reasonLabel = sell.sellReason === 'TARGET' ? '목표 수익 도달' : '손절 기준 도달';
  const openOrders = await safeOpenOrders(trading, symbol);
  const idempotencyKey = makeKrRankIdempotencyKey({
    tradeDate: kstToday(), strategyId: strategy.id, entryWindow, side: 'SELL'
  });
  const guard = checkOrderSafety({
    userId, strategyId: strategy.id, side: 'SELL', quantity: holdingQuantity,
    openOrders, idempotencyKey, holdingQuantity
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
    const order = repo.createOrder(userId, {
      ...baseOrder, status: 'FAILED', decisionReason: guard.reason, errorMessage: guard.reason
    });
    return saveDecision(userId, strategy, {
      decision: 'SELL', entryWindow, sellReason: sell.sellReason,
      selectedSymbol: symbol, selectedSymbolName: strategy.holdingSymbolName,
      currentPrice, averagePrice, holdingQuantity,
      expectedQuantity: holdingQuantity, expectedPrice: currentPrice,
      expectedAmount: baseOrder.estimatedAmount,
      liveOrderEnabled, evaluationSource, orderId: order.id,
      reason: `${symbol} ${reasonLabel}(수익률 ${profitPct}%)이나 ${guard.reason}`
    });
  }

  const order = await placeOrder(userId, trading, baseOrder, {
    liveOrderEnabled,
    decisionReason: `${symbol} ${reasonLabel} 전량 매도 (수익률 ${profitPct}%).`
  });
  // 매도 주문이 접수(또는 모의 기록)되면 보유 상태를 해제한다. 같은 진입 구간 재매수는 진입 기록으로 막힌다.
  if (order.status !== 'FAILED' && order.status !== 'REJECTED') {
    repo.clearHolding(userId, strategy.id);
  }
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

// 무보유일 때: 진입 구간에서 상승률 랭킹 조회 → 종목 선택 → 매수.
async function evaluateEntryPath(userId, strategy, { trading, liveOrderEnabled, evaluationSource }) {
  const now = new Date();
  const entryWindow = resolveEntryWindow(now, { lunchEntryEnabled: strategy.lunchEntryEnabled });
  if (!entryWindow) {
    return saveDecision(userId, strategy, {
      decision: 'SKIP', liveOrderEnabled, evaluationSource,
      reason: '지금은 오전·점심 진입 구간이 아니라 매수 평가를 하지 않습니다.'
    });
  }
  const tradeDate = kstToday();
  if (repo.getEntry(strategy.id, tradeDate, entryWindow)) {
    return saveDecision(userId, strategy, {
      decision: 'SKIP', entryWindow, liveOrderEnabled, evaluationSource,
      reason: `오늘 ${ENTRY_WINDOWS[entryWindow].label} 진입은 이미 실행했습니다. 같은 진입 구간에서는 다시 매수하지 않습니다.`
    });
  }

  // 랭킹 조회 실패 시 예외가 상위로 전파되어 ERROR로 기록되고 진입 기록은 만들지 않는다(다음 tick 재시도).
  const ranking = await getDomesticFluctuationRanking(userId);
  const candidate = selectRankingCandidate(ranking, { maxFluctuationRate: MAX_FLUCTUATION_RATE });
  const rankingSnapshot = (ranking || []).slice(0, RANKING_SNAPSHOT_SIZE);

  const entry = repo.createEntry(userId, {
    strategyId: strategy.id,
    tradeDate,
    entryWindow,
    status: candidate ? 'SELECTED' : 'NO_CANDIDATE',
    selectedSymbol: candidate?.symbol,
    selectedSymbolName: candidate?.name,
    selectedPrice: candidate?.price,
    selectedFluctuationRate: candidate?.fluctuationRate,
    rankingSnapshot,
    bought: false
  });
  if (!entry) {
    // 동시 평가가 먼저 진입 기록을 만들었다 → 중복 진입 방지.
    return saveDecision(userId, strategy, {
      decision: 'SKIP', entryWindow, liveOrderEnabled, evaluationSource, rankingSnapshot,
      reason: `${ENTRY_WINDOWS[entryWindow].label} 진입이 이미 기록되어 있어 중복 진입을 막았습니다.`
    });
  }

  if (!candidate) {
    return saveDecision(userId, strategy, {
      decision: 'SKIP', entryWindow, liveOrderEnabled, evaluationSource, rankingSnapshot,
      reason: `${ENTRY_WINDOWS[entryWindow].label} 진입: 상승률 랭킹에서 등락률 ${MAX_FLUCTUATION_RATE * 100}% 미만 매수 대상이 없어 매수하지 않습니다.`
    });
  }

  // 매수 수량 계산. 진입 구간별 매수 금액 한도와 가용 현금 중 작은 값을 최대한 사용한다.
  const entryBudget = entryWindow === 'LUNCH' ? strategy.lunchBudget : strategy.morningBudget;
  const buyingPower = await trading.getBuyingPower(candidate.symbol, { market: 'KR', currency: 'KRW', price: candidate.price });
  const cashAvailable = Number(buyingPower.cashAvailable || 0);
  const spendable = Math.min(entryBudget, cashAvailable);
  const quantity = computeBuyQuantity(spendable, candidate.price);
  const fluctPct = (candidate.fluctuationRate * 100).toFixed(2);

  if (quantity <= 0) {
    repo.updateEntryOutcome(entry.id, { status: 'SKIPPED', bought: false });
    return saveDecision(userId, strategy, {
      decision: 'SKIP', entryWindow,
      selectedSymbol: candidate.symbol, selectedSymbolName: candidate.name,
      currentPrice: candidate.price, cashAvailable, rankingSnapshot,
      liveOrderEnabled, evaluationSource,
      reason: `${ENTRY_WINDOWS[entryWindow].label} 진입: ${candidate.symbol}(등락률 ${fluctPct}%) 선택. 매수 금액 한도 ${fmt(entryBudget)}원·매수가능금액 ${fmt(cashAvailable)}원으로 1주도 매수할 수 없어 매수하지 않습니다.`
    });
  }

  const openOrders = await safeOpenOrders(trading, candidate.symbol);
  const idempotencyKey = makeKrRankIdempotencyKey({
    tradeDate, strategyId: strategy.id, entryWindow, side: 'BUY'
  });
  const estimatedAmount = quantity * candidate.price;
  const guard = checkOrderSafety({
    userId, strategyId: strategy.id, side: 'BUY', quantity,
    openOrders, idempotencyKey, cashAvailable, estimatedAmount
  });

  const baseOrder = {
    strategyId: strategy.id,
    entryId: entry.id,
    symbol: candidate.symbol,
    symbolName: candidate.name,
    side: 'BUY',
    entryWindow,
    quantity,
    orderPrice: candidate.price,
    estimatedAmount,
    idempotencyKey,
    liveOrderEnabled
  };

  if (!guard.ok) {
    repo.updateEntryOutcome(entry.id, { status: 'SKIPPED', bought: false });
    const order = repo.createOrder(userId, {
      ...baseOrder, status: 'FAILED', decisionReason: guard.reason, errorMessage: guard.reason
    });
    return saveDecision(userId, strategy, {
      decision: 'BUY', entryWindow,
      selectedSymbol: candidate.symbol, selectedSymbolName: candidate.name,
      currentPrice: candidate.price, cashAvailable,
      expectedQuantity: quantity, expectedPrice: candidate.price, expectedAmount: estimatedAmount,
      rankingSnapshot, liveOrderEnabled, evaluationSource, orderId: order.id,
      reason: `${ENTRY_WINDOWS[entryWindow].label} 진입: ${candidate.symbol} 매수 대상이나 ${guard.reason}`
    });
  }

  const order = await placeOrder(userId, trading, baseOrder, {
    liveOrderEnabled,
    decisionReason: `${ENTRY_WINDOWS[entryWindow].label} 진입: ${candidate.symbol}(등락률 ${fluctPct}%) ${quantity}주 매수.`
  });
  if (order.status !== 'FAILED' && order.status !== 'REJECTED') {
    repo.updateEntryOutcome(entry.id, { status: 'BOUGHT', bought: true });
    repo.setHolding(userId, strategy.id, {
      symbol: candidate.symbol, symbolName: candidate.name, entryWindow
    });
  } else {
    repo.updateEntryOutcome(entry.id, { status: 'SKIPPED', bought: false });
  }
  return saveDecision(userId, strategy, {
    decision: 'BUY', entryWindow,
    selectedSymbol: candidate.symbol, selectedSymbolName: candidate.name,
    currentPrice: candidate.price, cashAvailable,
    expectedQuantity: quantity, expectedPrice: candidate.price, expectedAmount: estimatedAmount,
    rankingSnapshot, liveOrderEnabled, evaluationSource, orderId: order.id,
    reason: `${ENTRY_WINDOWS[entryWindow].label} 진입: ${candidate.symbol}(등락률 ${fluctPct}%) ${quantity}주 매수. ${orderStatusNote(order, liveOrderEnabled)}`
  });
}

// ── 주문 실행 ─────────────────────────────────────────────────────────────

// 실주문 OFF면 DRY_RUN 기록만, ON이면 KIS로 실제 전송. 실패해도 재시도하지 않는다.
async function placeOrder(userId, trading, baseOrder, { liveOrderEnabled, decisionReason }) {
  const orderInput = {
    ...baseOrder,
    market: 'KR',
    currency: 'KRW',
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

// ── 안전 검증 (autoTradingSafetyGuard 와 동등, kr_rank_orders 기준 중복 검사) ──

function checkOrderSafety({
  userId, strategyId, side, quantity, openOrders, idempotencyKey,
  cashAvailable = 0, estimatedAmount = 0, holdingQuantity = 0
}) {
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return { ok: false, reason: '주문 수량이 0이라 주문하지 않습니다.' };
  }
  if (Array.isArray(openOrders) && openOrders.length > 0) {
    return { ok: false, reason: '미체결 주문이 있어 신규 주문을 만들지 않습니다.' };
  }
  if (repo.hasBlockingOpenOrder(userId, strategyId)) {
    return { ok: false, reason: '처리 중인 주문이 남아 있어 신규 주문을 만들지 않습니다.' };
  }
  if (repo.hasDuplicateOrder(idempotencyKey)) {
    return { ok: false, reason: '동일한 판단에 대한 주문 기록이 이미 있어 중복 주문을 막았습니다.' };
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

// 1분 간격 폴링이라 스케줄러의 HOLD/SKIP까지 매번 기록하면 판단 로그가 폭주한다.
// 의미 있는 이벤트(매수·매도·오류)와 사용자가 직접 누른 평가만 로그로 남긴다.
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
  const shouldLog = evaluationSource === 'MANUAL'
    || decision === 'BUY' || decision === 'SELL' || decision === 'ERROR';
  const log = shouldLog
    ? repo.createDecisionLog(userId, { strategyId: strategy.id, ...input })
    : null;
  return { strategy: repo.getStrategy(userId, strategy.id), decision: log, order: null };
}

function saveSkip(userId, strategy, reason, evaluationSource) {
  const liveOrderEnabled = autoTradingRepo.getSettings(userId).liveOrderEnabled;
  return saveDecision(userId, strategy, { decision: 'SKIP', liveOrderEnabled, evaluationSource, reason });
}

async function safeOpenOrders(trading, symbol) {
  try {
    return await trading.getOpenOrders(symbol, { market: 'KR', currency: 'KRW' });
  } catch {
    return [];
  }
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
  const morningBudget = positiveNumber(input.morningBudget, '오전 매수 금액');
  const morningTargetProfitRate = positiveNumber(input.morningTargetProfitRate, '오전 목표 수익률');
  const morningStopLossRate = positiveNumber(input.morningStopLossRate, '오전 손절 기준');

  // 점심 진입을 켜면 하루 두 번 매수하므로 점심 매수 금액·목표 수익률·손절 기준을 따로 입력받는다.
  // 점심 진입이 꺼져 있으면 lunch_* 값은 사용하지 않으므로 오전 값으로 채워 둔다.
  let lunchBudget = 0;
  let lunchTargetProfitRate = morningTargetProfitRate;
  let lunchStopLossRate = morningStopLossRate;
  if (lunchEntryEnabled) {
    lunchBudget = positiveNumber(input.lunchBudget, '점심 매수 금액');
    lunchTargetProfitRate = positiveNumber(input.lunchTargetProfitRate, '점심 목표 수익률');
    lunchStopLossRate = positiveNumber(input.lunchStopLossRate, '점심 손절 기준');
  }
  return {
    morningBudget, morningTargetProfitRate, morningStopLossRate,
    lunchEntryEnabled, lunchBudget, lunchTargetProfitRate, lunchStopLossRate
  };
}

function positiveNumber(value, label) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw badRequest(`${label}은(는) 0보다 커야 합니다.`);
  return n;
}

function requireStrategy(userId, id) {
  const strategy = repo.getStrategy(userId, Number(id));
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
