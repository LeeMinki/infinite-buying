import { Decision, TradingMode, isTradingMode } from '../domain/tradingMode.js';

function assertPositiveNumber(value, label) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a positive number`);
  }
}

function assertNonNegativeNumber(value, label) {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a non-negative number`);
  }
}

function normalizeParams(params) {
  if (!params || typeof params !== 'object') {
    throw new Error('params is required');
  }
  const { totalBudget, splitCount, targetProfitRate } = params;
  assertPositiveNumber(totalBudget, 'totalBudget');
  assertPositiveNumber(splitCount, 'splitCount');
  if (!Number.isInteger(splitCount)) {
    throw new Error('splitCount must be an integer');
  }
  assertPositiveNumber(targetProfitRate, 'targetProfitRate');
  const buyAmountPerRound = Number.isFinite(params.buyAmountPerRound) && params.buyAmountPerRound > 0
    ? params.buyAmountPerRound
    : Math.floor(totalBudget / splitCount);
  return {
    totalBudget,
    splitCount,
    buyAmountPerRound,
    targetProfitRate,
    restartAfterSell: params.restartAfterSell !== false
  };
}

function normalizeState(state, params) {
  if (!state || typeof state !== 'object') {
    throw new Error('state is required');
  }
  const cash = Number.isFinite(state.cash) ? state.cash : params.totalBudget;
  const holdingQuantity = Number.isFinite(state.holdingQuantity) ? state.holdingQuantity : 0;
  const averagePrice = Number.isFinite(state.averagePrice) ? state.averagePrice : 0;
  const investedAmount = Number.isFinite(state.investedAmount) ? state.investedAmount : 0;
  const realizedProfit = Number.isFinite(state.realizedProfit) ? state.realizedProfit : 0;
  const currentRound = Number.isFinite(state.currentRound) && state.currentRound > 0 ? state.currentRound : 1;
  const completed = state.completed === true;
  assertNonNegativeNumber(cash, 'cash');
  assertNonNegativeNumber(holdingQuantity, 'holdingQuantity');
  assertNonNegativeNumber(averagePrice, 'averagePrice');
  assertNonNegativeNumber(investedAmount, 'investedAmount');
  if (!Number.isInteger(holdingQuantity)) {
    throw new Error('holdingQuantity must be an integer');
  }
  return { cash, holdingQuantity, averagePrice, investedAmount, realizedProfit, currentRound, completed };
}

function deriveMetrics({ price, holdingQuantity, investedAmount, cash, params }) {
  const evaluationAmount = Math.floor(holdingQuantity * price);
  const totalAsset = cash + evaluationAmount;
  const unrealizedProfit = evaluationAmount - investedAmount;
  const returnRate = params.totalBudget > 0
    ? (totalAsset - params.totalBudget) / params.totalBudget
    : 0;
  return { evaluationAmount, totalAsset, unrealizedProfit, returnRate };
}

function buildResult({ decision, price, quantity, amount, roundNo, reason, tradeDate, nextState, params }) {
  const metrics = deriveMetrics({
    price,
    holdingQuantity: nextState.holdingQuantity,
    investedAmount: nextState.investedAmount,
    cash: nextState.cash,
    params
  });
  return {
    decision,
    side: decision,
    price,
    quantity,
    amount,
    roundNo,
    reason,
    tradeDate,
    nextState,
    metrics
  };
}

export function evaluate({ mode = TradingMode.BACKTEST, price, tradeDate, params, state } = {}) {
  if (!isTradingMode(mode)) {
    throw new Error(`Unknown trading mode: ${mode}`);
  }
  assertPositiveNumber(price, 'price');
  const p = normalizeParams(params);
  const s = normalizeState(state, p);

  if (s.completed) {
    return buildResult({
      decision: Decision.COMPLETED,
      price,
      quantity: 0,
      amount: 0,
      roundNo: s.currentRound,
      reason: '백테스트가 종료된 상태입니다.',
      tradeDate,
      nextState: { ...s },
      params: p
    });
  }

  // 1) 목표 수익률 도달 → 전량 매도 후 사이클 재시작
  if (s.holdingQuantity > 0 && price >= s.averagePrice * (1 + p.targetProfitRate)) {
    return sellAll(s, p, price, tradeDate);
  }

  // 2) 40회 매수가 모두 끝남 → 보유 1/4 매도해서 시드 재확보 (또는 보유 0이면 종료)
  if (s.currentRound > p.splitCount) {
    if (s.holdingQuantity > 0) {
      return sellQuarter(s, p, price, tradeDate);
    }
    const next = { ...s, completed: true };
    return buildResult({
      decision: Decision.COMPLETED,
      price,
      quantity: 0,
      amount: 0,
      roundNo: s.currentRound,
      reason: '40회 매수 완료 후 보유 수량이 없어 종료합니다.',
      tradeDate,
      nextState: next,
      params: p
    });
  }

  // 3) 평단가 대비 종가에 따라 수량을 다르게 하여 매수
  return adaptiveBuy(s, p, price, tradeDate);
}

function sellAll(s, p, price, tradeDate) {
  const qty = s.holdingQuantity;
  const proceeds = Math.floor(price * qty);
  const realizedDelta = Math.floor((price - s.averagePrice) * qty);
  const cashAfter = s.cash + proceeds;
  const restart = p.restartAfterSell;
  const nextState = {
    cash: cashAfter,
    holdingQuantity: 0,
    averagePrice: 0,
    investedAmount: 0,
    realizedProfit: s.realizedProfit + realizedDelta,
    currentRound: restart ? 1 : s.currentRound,
    completed: !restart
  };
  return buildResult({
    decision: Decision.SELL,
    price,
    quantity: qty,
    amount: proceeds,
    roundNo: s.currentRound,
    reason: '목표 수익률 도달 → 전량 매도',
    tradeDate,
    nextState,
    params: p
  });
}

function sellQuarter(s, p, price, tradeDate) {
  const qty = Math.max(1, Math.ceil(s.holdingQuantity / 4));
  const cappedQty = Math.min(qty, s.holdingQuantity);
  const proceeds = Math.floor(price * cappedQty);
  const realizedDelta = Math.floor((price - s.averagePrice) * cappedQty);
  const remainingQty = s.holdingQuantity - cappedQty;
  const remainingInvested = remainingQty > 0 ? Math.floor(s.averagePrice * remainingQty) : 0;
  const remainingAvg = remainingQty > 0 ? s.averagePrice : 0;
  const nextState = {
    cash: s.cash + proceeds,
    holdingQuantity: remainingQty,
    averagePrice: remainingAvg,
    investedAmount: remainingInvested,
    realizedProfit: s.realizedProfit + realizedDelta,
    currentRound: 1,
    completed: false
  };
  return buildResult({
    decision: Decision.SELL,
    price,
    quantity: cappedQty,
    amount: proceeds,
    roundNo: s.currentRound,
    reason: '40회 매수 완료 → 보유 1/4 매도하여 시드 재확보',
    tradeDate,
    nextState,
    params: p
  });
}

function adaptiveBuy(s, p, price, tradeDate) {
  const baseQty = Math.floor(p.buyAmountPerRound / price);
  let plannedQty;
  let reason;
  if (s.holdingQuantity === 0) {
    plannedQty = baseQty;
    reason = '첫 매수: 회차당 기본 수량';
  } else if (price < s.averagePrice) {
    plannedQty = baseQty * 2;
    reason = '평단가보다 저렴 → 2배 수량 매수';
  } else {
    plannedQty = Math.max(1, Math.floor(baseQty / 2));
    reason = '평단가 이상 → 절반 수량 매수';
  }
  const cashCappedQty = Math.floor(s.cash / price);
  const qty = Math.min(plannedQty, cashCappedQty);
  if (qty <= 0) {
    const reasonHold = baseQty === 0
      ? '회차 예산으로 1주를 매수할 수 없습니다.'
      : '잔여 현금이 부족하여 매수를 보류합니다.';
    return buildResult({
      decision: Decision.HOLD,
      price,
      quantity: 0,
      amount: 0,
      roundNo: s.currentRound,
      reason: reasonHold,
      tradeDate,
      nextState: { ...s },
      params: p
    });
  }
  const amount = Math.floor(qty * price);
  const newQuantity = s.holdingQuantity + qty;
  const newInvested = s.investedAmount + amount;
  const newAveragePrice = newInvested / newQuantity;
  const nextState = {
    cash: s.cash - amount,
    holdingQuantity: newQuantity,
    averagePrice: newAveragePrice,
    investedAmount: newInvested,
    realizedProfit: s.realizedProfit,
    currentRound: s.currentRound + 1,
    completed: false
  };
  return buildResult({
    decision: Decision.BUY,
    price,
    quantity: qty,
    amount,
    roundNo: s.currentRound,
    reason,
    tradeDate,
    nextState,
    params: p
  });
}

export function initialState(params) {
  const p = normalizeParams(params);
  return {
    cash: p.totalBudget,
    holdingQuantity: 0,
    averagePrice: 0,
    investedAmount: 0,
    realizedProfit: 0,
    currentRound: 1,
    completed: false
  };
}
