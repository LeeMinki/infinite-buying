import * as repo from '../repositories/autoTradingRepository.js';
import { evaluateAutoTrading } from './autoTradingStrategyEngine.js';
import { validateOrderSafety } from './autoTradingSafetyGuard.js';
import { KisTradingService, maskPayload } from './kisTradingService.js';
import { getValidAccessToken } from './kisTokenManager.js';

const LOCK_KEY = 'evaluate';

export function getSettings(userId) {
  return {
    ...repo.getSettings(userId),
    histories: repo.listSettingHistories(userId, 10)
  };
}

export function updateLiveOrderSetting(userId, enabled) {
  return {
    ...repo.updateLiveOrderSetting(userId, enabled === true),
    histories: repo.listSettingHistories(userId, 10)
  };
}

export function createStrategy(userId, input) {
  const params = normalizeStrategyInput(input);
  return repo.createStrategy(userId, params);
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
  requireStrategy(userId, id);
  const strategy = repo.startStrategy(userId, id);
  const settings = repo.getSettings(userId);
  repo.createDecisionLog(userId, {
    strategyId: strategy.id,
    symbol: strategy.symbol,
    market: strategy.market,
    currency: strategy.currency,
    currentPrice: 0,
    averagePrice: 0,
    holdingQuantity: 0,
    cashAvailable: null,
    currentRound: strategy.currentRound,
    decision: 'SKIP',
    liveOrderEnabled: settings.liveOrderEnabled,
    reason: `자동매매를 시작했습니다. 서버가 최대 10분 간격으로 현재가, 잔고, 매수가능금액, 미체결 주문을 확인합니다. 실주문 설정: ${settings.liveOrderEnabled ? '켜짐' : '꺼짐'}.`
  });
  return strategy;
}

export function stopStrategy(userId, id) {
  requireStrategy(userId, id);
  return {
    strategy: repo.stopStrategy(userId, id),
    openOrders: repo.listOrders(userId, { strategyId: id }).filter((order) => (
      ['REQUESTED', 'ACCEPTED', 'PARTIALLY_FILLED', 'UNKNOWN'].includes(order.status)
    ))
  };
}

export async function evaluateStrategy(userId, id, { scheduled = false } = {}) {
  const evaluationSource = scheduled ? 'SCHEDULED' : 'MANUAL';
  const strategy = requireStrategy(userId, id);
  const lockedUntil = new Date(Date.now() + 2 * 60 * 1000).toISOString();
  if (!repo.acquireLock(userId, id, LOCK_KEY, lockedUntil)) {
    return saveSkip(userId, strategy, '이미 평가가 진행 중입니다.', evaluationSource);
  }
  try {
    if (scheduled && !isMarketSessionOpen(strategy.market)) {
      return saveSkip(userId, strategy, '장 운영 시간이 아니거나 운영 시간 판단이 불확실해 주문하지 않습니다.', evaluationSource);
    }
    return await evaluateUnlocked(userId, strategy, evaluationSource);
  } finally {
    repo.releaseLock(id, LOCK_KEY);
  }
}

async function evaluateUnlocked(userId, strategy, evaluationSource = 'SCHEDULED') {
  const settings = repo.getSettings(userId);
  const trading = new KisTradingService(userId);
  const tradeDate = today();
  let contextReady = false;
  try {
    await getValidAccessToken(userId);
    contextReady = true;
    const price = await trading.getCurrentPrice(strategy.symbol, { market: strategy.market });
    const [balance, buyingPower, openOrders] = await Promise.all([
      trading.getBalance(strategy.symbol, { market: strategy.market, currency: strategy.currency }),
      trading.getBuyingPower(strategy.symbol, {
        market: strategy.market,
        currency: strategy.currency,
        price: price.price
      }),
      trading.getOpenOrders(strategy.symbol, { market: strategy.market, currency: strategy.currency })
    ]);
    const holdingQuantity = Number(balance.quantity || 0);
    const averagePrice = Number(balance.averagePrice || 0);
    const cashAvailable = Number(buyingPower.cashAvailable || balance.cashAvailable || 0);
    const decision = evaluateAutoTrading({
      symbol: strategy.symbol,
      market: strategy.market,
      currency: strategy.currency,
      currentPrice: price.price,
      holdingQuantity,
      averagePrice,
      cashAvailable,
      currentRound: strategy.currentRound,
      totalBudget: strategy.totalBudget,
      splitCount: strategy.splitCount,
      targetProfitRate: strategy.targetProfitRate
    });
    // 스냅샷은 평가 결정 직후에 찍어서 "이 시점에 자동매매가 무슨 결정을 내렸는가" 까지 같이 저장한다.
    const snapshot = createSnapshot(userId, strategy, {
      currentPrice: price.price,
      balance,
      cashAvailable,
      decision: decision.decision
    });
    const decisionWithContext = {
      ...decision,
      reason: appendEvaluationContext(decision.reason, {
        strategy,
        price: price.price,
        holdingQuantity,
        averagePrice,
        cashAvailable,
        liveOrderEnabled: settings.liveOrderEnabled,
        openOrderCount: openOrders.length
      })
    };
    const idempotencyKey = makeIdempotencyKey(strategy, decisionWithContext, tradeDate);
    const guard = validateOrderSafety({
      userId,
      strategy,
      decision: decisionWithContext,
      liveOrderEnabled: settings.liveOrderEnabled,
      buyingPower,
      balance,
      openOrders,
      idempotencyKey,
      tradeDate
    });

    if (!guard.ok) {
      const log = createDecisionLog(userId, strategy, {
        ...decisionWithContext,
        decision: guard.decision || 'SKIP',
        reason: appendEvaluationContext(guard.reason, {
          strategy,
          price: price.price,
          holdingQuantity,
          averagePrice,
          cashAvailable,
          liveOrderEnabled: settings.liveOrderEnabled,
          openOrderCount: openOrders.length
        }),
        liveOrderEnabled: settings.liveOrderEnabled,
        currentPrice: price.price,
        averagePrice,
        holdingQuantity,
        cashAvailable,
        openOrderCount: openOrders.length,
        evaluationSource
      });
      repo.markStrategyEvaluation(userId, strategy.id, { decision: log.decision, errorMessage: null });
      return { strategy: repo.getStrategy(userId, strategy.id), decision: log, snapshot, order: null };
    }

    const log = createDecisionLog(userId, strategy, {
      ...decisionWithContext,
      liveOrderEnabled: settings.liveOrderEnabled,
      currentPrice: price.price,
      averagePrice,
      holdingQuantity,
      cashAvailable,
      openOrderCount: openOrders.length,
      evaluationSource
    });
    if (guard.noOrder || !['BUY', 'SELL'].includes(decisionWithContext.decision)) {
      repo.markStrategyEvaluation(userId, strategy.id, { decision: log.decision, errorMessage: null });
      return { strategy: repo.getStrategy(userId, strategy.id), decision: log, snapshot, order: null };
    }

    const baseOrder = {
      strategyId: strategy.id,
      symbol: strategy.symbol,
      market: strategy.market,
      currency: strategy.currency,
      side: decisionWithContext.decision,
      quantity: decisionWithContext.expectedQuantity,
      orderPrice: decisionWithContext.expectedOrderPrice,
      estimatedAmount: decisionWithContext.expectedAmount,
      idempotencyKey,
      decisionReason: decisionWithContext.reason,
      liveOrderEnabled: settings.liveOrderEnabled
    };

    if (!settings.liveOrderEnabled) {
      const order = repo.createOrder(userId, {
        ...baseOrder,
        status: 'DRY_RUN',
        requestPayloadMasked: maskPayload(baseOrder)
      });
      repo.attachOrderIdToDecisionLog(log.id, order.id);
      repo.markStrategyEvaluation(userId, strategy.id, {
        decision: decisionWithContext.decision,
        incrementRound: decisionWithContext.decision === 'BUY',
        ordered: true
      });
      return { strategy: repo.getStrategy(userId, strategy.id), decision: { ...log, orderId: order.id }, snapshot, order };
    }

    let order;
    try {
      const result = decisionWithContext.decision === 'BUY'
        ? await trading.placeBuyOrder(baseOrder)
        : await trading.placeSellOrder(baseOrder);
      order = repo.createOrder(userId, {
        ...baseOrder,
        status: result.status || 'ACCEPTED',
        kisOrderNo: result.orderNo,
        kisOriginalOrderNo: result.originalOrderNo,
        requestPayloadMasked: result.requestPayloadMasked || maskPayload(baseOrder),
        responsePayloadMasked: result.responsePayloadMasked
      });
      repo.attachOrderIdToDecisionLog(log.id, order.id);
      repo.addDailyUsedAmount(userId, strategy.id, {
        tradeDate,
        market: strategy.market,
        currency: strategy.currency,
        amount: decisionWithContext.expectedAmount
      });
      repo.markStrategyEvaluation(userId, strategy.id, {
        decision: decisionWithContext.decision,
        incrementRound: decisionWithContext.decision === 'BUY',
        ordered: true
      });
      return { strategy: repo.getStrategy(userId, strategy.id), decision: { ...log, orderId: order.id }, snapshot, order };
    } catch (error) {
      order = repo.createOrder(userId, {
        ...baseOrder,
        status: 'FAILED',
        requestPayloadMasked: maskPayload(baseOrder),
        responsePayloadMasked: error.safePayload || null,
        errorMessage: error.message || 'KIS 주문 요청에 실패했습니다.'
      });
      repo.attachOrderIdToDecisionLog(log.id, order.id);
      repo.markStrategyEvaluation(userId, strategy.id, {
        decision: decisionWithContext.decision,
        errorMessage: order.errorMessage
      });
      return { strategy: repo.getStrategy(userId, strategy.id), decision: { ...log, orderId: order.id }, snapshot, order };
    }
  } catch (error) {
    const message = contextReady
      ? (error.message || '자동매매 평가에 실패했습니다.')
      : 'KIS access token 발급에 실패했습니다. App Key, App Secret, 계좌 설정을 확인하세요';
    const log = repo.createDecisionLog(userId, {
      strategyId: strategy.id,
      symbol: strategy.symbol,
      market: strategy.market,
      currency: strategy.currency,
      currentPrice: 0,
      averagePrice: 0,
      holdingQuantity: 0,
      cashAvailable: null,
      currentRound: strategy.currentRound,
      decision: 'ERROR',
      liveOrderEnabled: repo.getSettings(userId).liveOrderEnabled,
      reason: message,
      openOrderCount: 0,
      evaluationSource
    });
    repo.markStrategyEvaluation(userId, strategy.id, { decision: 'ERROR', errorMessage: message });
    return { strategy: repo.getStrategy(userId, strategy.id), decision: log, snapshot: null, order: null };
  }
}

export function listOrders(userId, strategyId = null) {
  if (strategyId) requireStrategy(userId, strategyId);
  return repo.listOrders(userId, { strategyId });
}

export function getOrder(userId, id) {
  const order = repo.getOrder(userId, id);
  if (!order) throw notFound('주문을 찾을 수 없습니다.');
  return order;
}

export async function refreshOrder(userId, id) {
  const order = getOrder(userId, id);
  if (!order.liveOrderEnabled || order.status === 'DRY_RUN') return order;
  const trading = new KisTradingService(userId);
  const result = await trading.refreshOrder(order);
  return repo.updateOrder(userId, id, {
    status: result.status || 'UNKNOWN',
    kisOrderNo: result.orderNo,
    kisOriginalOrderNo: result.originalOrderNo,
    filledQuantity: result.filledQuantity ?? order.filledQuantity,
    remainingQuantity: result.remainingQuantity ?? order.remainingQuantity,
    averageFilledPrice: result.averageFilledPrice ?? order.averageFilledPrice,
    responsePayloadMasked: result.responsePayloadMasked,
    errorMessage: null
  });
}

export function listDecisionLogs(userId, strategyId) {
  requireStrategy(userId, strategyId);
  return repo.listDecisionLogs(userId, strategyId);
}

export function listPositionSnapshots(userId, strategyId) {
  requireStrategy(userId, strategyId);
  return repo.listPositionSnapshots(userId, strategyId);
}

export function getDashboard(userId) {
  const settings = repo.getSettings(userId);
  return {
    settings,
    stats: repo.dashboardStats(userId),
    strategies: repo.listStrategies(userId).slice(0, 20),
    recentDecisions: repo.recentDecisionLogs(userId, 20),
    recentOrders: repo.listOrders(userId, { limit: 20 }),
    recentPositions: repo.latestPositionSnapshots(userId, 10)
  };
}

export async function getAccountSummary(userId, strategyId) {
  // 실주문 모드 여부와 무관하게 사용자가 자동매매 화면에서 KIS 계좌 연결 상태와
  // 잔고/매수가능금액/미체결 주문을 확인할 수 있어야 한다. 실주문 모드가 꺼져 있어도
  // 조회만은 가능하며, 실제 주문은 SafetyGuard에서 별도로 차단된다.
  const settings = repo.getSettings(userId);
  const strategy = requireStrategy(userId, strategyId);
  const trading = new KisTradingService(userId);
  await getValidAccessToken(userId);
  // KIS 초당 거래건수 제한(EGW00201)을 피하기 위해 순차 호출. KisTradingService 내부에서도
  // 호출 간 최소 간격과 backoff 재시도를 적용하지만, 같은 사용자 호출은 직렬화하는 편이 안전하다.
  const price = await trading.getCurrentPrice(strategy.symbol, { market: strategy.market });
  const balance = await trading.getBalance(strategy.symbol, { market: strategy.market, currency: strategy.currency });
  const buyingPower = await trading.getBuyingPower(strategy.symbol, {
    market: strategy.market,
    currency: strategy.currency,
    price: price.price
  });
  const openOrders = await trading.getOpenOrders(strategy.symbol, { market: strategy.market, currency: strategy.currency });
  return {
    liveOrderEnabled: settings.liveOrderEnabled,
    symbol: strategy.symbol,
    symbolName: strategy.symbolName,
    market: strategy.market,
    currency: strategy.currency,
    currentPrice: price.price,
    cashAvailable: Number(buyingPower.cashAvailable || balance.cashAvailable || 0),
    cashAvailableAfterFx: Number(buyingPower.cashAvailableAfterFx || 0),
    buyableQuantity: Number(buyingPower.buyableQuantity || 0),
    buyableQuantityAfterFx: Number(buyingPower.buyableQuantityAfterFx || 0),
    exchangeRate: Number(buyingPower.exchangeRate || 0),
    holdingQuantity: Number(balance.quantity || 0),
    averagePrice: Number(balance.averagePrice || 0),
    evaluationAmount: Number(balance.evaluationAmount || 0),
    unrealizedProfit: Number(balance.unrealizedProfit || 0),
    openOrderCount: openOrders.length,
    checkedAt: new Date().toISOString()
  };
}

// 전략을 만들기 전 단계에서 사용자 잔고 기반으로 총 예산을 제안하기 위한 가벼운 조회.
// 전략 ID가 없으므로 시장/심볼만 받아 KIS 잔고·매수가능금액을 표준 형태로 돌려준다.
export async function getBuyingPowerPreview(userId, { market, symbol, exchange }) {
  const normalizedMarket = String(market || 'KR').toUpperCase();
  const safeSymbol = String(symbol || '').trim().toUpperCase() || (normalizedMarket === 'KR' ? '005930' : 'TQQQ');
  await getValidAccessToken(userId);
  const trading = new KisTradingService(userId);
  let price = 0;
  try {
    const current = await trading.getCurrentPrice(safeSymbol, { market: normalizedMarket, exchange });
    price = Number(current.price || 0);
  } catch (_) {
    // 현재가 조회가 실패해도 잔고/매수가능금액은 시도한다. KIS API가 price=0이면 잔고만 돌려준다.
  }
  const buyingPower = await trading.getBuyingPower(safeSymbol, { market: normalizedMarket, exchange, price });
  return {
    market: normalizedMarket,
    symbol: safeSymbol,
    currency: buyingPower.currency,
    cashAvailable: Number(buyingPower.cashAvailable || 0),
    cashAvailableAfterFx: Number(buyingPower.cashAvailableAfterFx || 0),
    buyableQuantity: Number(buyingPower.buyableQuantity || 0),
    buyableQuantityAfterFx: Number(buyingPower.buyableQuantityAfterFx || 0),
    exchangeRate: Number(buyingPower.exchangeRate || 0),
    currentPrice: price,
    checkedAt: new Date().toISOString()
  };
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

function createSnapshot(userId, strategy, { currentPrice, balance, cashAvailable, decision }) {
  const quantity = Number(balance.quantity || 0);
  const averagePrice = Number(balance.averagePrice || 0);
  const evaluationAmount = quantity * currentPrice;
  const unrealizedProfit = averagePrice > 0 ? (currentPrice - averagePrice) * quantity : 0;
  const base = averagePrice * quantity;
  return repo.createPositionSnapshot(userId, {
    strategyId: strategy.id,
    symbol: strategy.symbol,
    market: strategy.market,
    currency: strategy.currency,
    quantity,
    averagePrice,
    currentPrice,
    evaluationAmount,
    unrealizedProfit,
    unrealizedProfitRate: base > 0 ? unrealizedProfit / base : 0,
    cashAvailable,
    source: 'KIS',
    decision
  });
}

function createDecisionLog(userId, strategy, input) {
  const avg = Number(input.averagePrice || 0);
  const price = Number(input.currentPrice || 0);
  const targetSellPrice = avg > 0 ? avg * (1 + strategy.targetProfitRate) : null;
  // 음수면 이미 목표가 도달, 양수면 목표가까지 남은 비율 (예: 0.05 = 5% 더 올라야 자동 매도).
  const distanceToTargetRate = targetSellPrice && price > 0
    ? (targetSellPrice - price) / targetSellPrice
    : null;
  return repo.createDecisionLog(userId, {
    strategyId: strategy.id,
    symbol: strategy.symbol,
    market: strategy.market,
    currency: strategy.currency,
    currentPrice: input.currentPrice,
    averagePrice: input.averagePrice,
    holdingQuantity: input.holdingQuantity,
    cashAvailable: input.cashAvailable,
    currentRound: strategy.currentRound,
    decision: input.decision,
    expectedQuantity: input.expectedQuantity,
    expectedOrderPrice: input.expectedOrderPrice,
    expectedAmount: input.expectedAmount,
    liveOrderEnabled: input.liveOrderEnabled,
    reason: input.reason,
    targetSellPrice,
    distanceToTargetRate,
    openOrderCount: input.openOrderCount ?? 0,
    evaluationSource: input.evaluationSource || 'SCHEDULED',
    orderId: input.orderId ?? null
  });
}

function saveSkip(userId, strategy, reason, evaluationSource = 'SCHEDULED') {
  const settings = repo.getSettings(userId);
  const detailedReason = `${reason} 확인값: 현재가 미조회, 보유 수량 미조회, 매수가능금액 미조회, 회차 ${strategy.currentRound}/${strategy.splitCount}, 실주문 ${settings.liveOrderEnabled ? '켜짐' : '꺼짐'}.`;
  const log = repo.createDecisionLog(userId, {
    strategyId: strategy.id,
    symbol: strategy.symbol,
    market: strategy.market,
    currency: strategy.currency,
    currentPrice: 0,
    averagePrice: 0,
    holdingQuantity: 0,
    cashAvailable: null,
    currentRound: strategy.currentRound,
    decision: 'SKIP',
    liveOrderEnabled: settings.liveOrderEnabled,
    reason: detailedReason,
    openOrderCount: 0,
    evaluationSource
  });
  repo.markStrategyEvaluation(userId, strategy.id, { decision: 'SKIP', errorMessage: null });
  return { strategy: repo.getStrategy(userId, strategy.id), decision: log, snapshot: null, order: null };
}

function appendEvaluationContext(reason, {
  strategy,
  price,
  holdingQuantity,
  averagePrice,
  cashAvailable,
  liveOrderEnabled,
  openOrderCount
}) {
  const detail = [
    `현재가 ${fmt(price)} ${strategy.currency}`,
    `보유 ${fmtQty(holdingQuantity)}주`,
    `평단 ${fmt(averagePrice)} ${strategy.currency}`,
    `매수가능금액 ${fmt(cashAvailable)} ${strategy.currency}`,
    `회차 ${strategy.currentRound}/${strategy.splitCount}`,
    `미체결 ${openOrderCount || 0}건`,
    `실주문 ${liveOrderEnabled ? '켜짐' : '꺼짐'}`
  ].join(', ');
  return `${reason} 확인값: ${detail}.`;
}

function normalizeStrategyInput(input = {}) {
  const symbol = String(input.symbol || input.stockCode || '').trim().toUpperCase();
  if (!symbol) throw badRequest('종목을 선택하세요.');
  const market = normalizeMarket(input.market, symbol);
  const currency = String(input.currency || (market === 'KR' ? 'KRW' : 'USD')).trim().toUpperCase();
  const totalBudget = Number(input.totalBudget);
  if (!Number.isFinite(totalBudget) || totalBudget <= 0) throw badRequest('총 예산은 0보다 커야 합니다.');
  const splitCountRaw = Number(input.splitCount || 40);
  if (!Number.isInteger(splitCountRaw) || splitCountRaw <= 0) throw badRequest('분할 회차는 1 이상의 정수여야 합니다.');
  const targetProfitRate = Number(input.targetProfitRate ?? 0.1);
  if (!Number.isFinite(targetProfitRate) || targetProfitRate <= 0) throw badRequest('목표 수익률은 0보다 커야 합니다.');
  const buyAmountPerRound = Math.floor(totalBudget / splitCountRaw);
  return {
    symbol,
    symbolName: String(input.symbolName || input.stockName || '').trim(),
    market,
    currency,
    totalBudget,
    splitCount: splitCountRaw,
    buyAmountPerRound,
    targetProfitRate
  };
}

function requireStrategy(userId, id) {
  const strategy = repo.getStrategy(userId, Number(id));
  if (!strategy) throw notFound('자동매매 전략을 찾을 수 없습니다.');
  return strategy;
}

function makeIdempotencyKey(strategy, decision, tradeDate) {
  return [
    strategy.userId,
    strategy.id,
    tradeDate,
    decision.decision,
    strategy.currentRound,
    Number(decision.expectedOrderPrice || 0).toFixed(6)
  ].join(':');
}

function isMarketSessionOpen(market) {
  const now = new Date();
  const kst = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  const day = kst.getDay();
  if (day === 0 || day === 6) return false;
  const minutes = kst.getHours() * 60 + kst.getMinutes();
  if (market === 'KR') return minutes >= 9 * 60 && minutes <= 15 * 60 + 30;
  if (market === 'US') return minutes >= 22 * 60 + 30 || minutes <= 6 * 60;
  return false;
}

function normalizeMarket(value, symbol) {
  const market = String(value || '').trim().toUpperCase();
  if (market === 'KR' || market === 'KOSPI' || market === 'KOSDAQ') return 'KR';
  if (market === 'US') return 'US';
  return /^\d{6}$/.test(symbol) ? 'KR' : 'US';
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function fmt(value) {
  return Number(value || 0).toLocaleString('ko-KR', { maximumFractionDigits: 6 });
}

function fmtQty(value) {
  return Number(value || 0).toLocaleString('ko-KR', { maximumFractionDigits: 6 });
}

function nonNegative(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
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
