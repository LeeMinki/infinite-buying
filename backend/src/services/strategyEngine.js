import { Decision, TradingMode, isTradingMode } from '../domain/tradingMode.js';

// 알고리즘: LAOR_INFINITE_V2 — 라오어 단기 무한매수법 (정통)
//
// 매일 두 LOC 한도에 분할 주문:
//   - 큰수 LOC 한도 = max(전일종가, 평단가)
//   - 작은수 LOC 한도 = min(전일종가, 평단가) * (1 - smallDiscount)  [기본 5% 할인]
// 종가가 한도 이하일 때만 한도가에 체결. 해외 종목은 소수점 수량을 허용할 수 있다.
//
// 우선순위:
//   1) 보유 > 0 && 장중 고가 ≥ 평단가 × (1+목표) → LOC 매도 한도가에 전량 매도
//   2) 회차 >= 분할 회차 && 보유 > 0 && 현금 < T → 보유 1/4 매도해 시드 재확보 (회차 1 리셋)
//   3) 회차 >= 분할 회차 && 보유 == 0 → COMPLETED
//   4) 첫 매수(보유 0): 시가에 T/시가 수량 매수 (국내는 정수 주 단위)
//   5) 그 외 일반 매수: 큰수/작은수 LOC 분할 (각 T/2씩)
// 회차 카운터는 실제 매수 체결이 있을 때만 +1.
// 목표 매도나 시드 재확보로 새 사이클을 시작하면 당시 총자산을 새 사이클 예산으로 삼아
// 다음 회차 예산을 다시 계산한다.

const DEFAULT_SMALL_DISCOUNT = 0.05;

function assertPositiveNumber(value, label) {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} must be a positive number`);
}

function assertNonNegativeNumber(value, label) {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${label} must be a non-negative number`);
}

function normalizeParams(params) {
  if (!params || typeof params !== 'object') throw new Error('params is required');
  const totalBudget = Number(params.totalBudget);
  assertPositiveNumber(totalBudget, 'totalBudget');
  const targetProfitRate = Number(params.targetProfitRate);
  assertPositiveNumber(targetProfitRate, 'targetProfitRate');
  const splitCount = Number(params.splitCount);
  if (!Number.isInteger(splitCount) || splitCount <= 0) {
    throw new Error('splitCount must be a positive integer');
  }
  const smallDiscount = Number.isFinite(Number(params.smallDiscount)) && Number(params.smallDiscount) > 0 && Number(params.smallDiscount) < 1
    ? Number(params.smallDiscount)
    : DEFAULT_SMALL_DISCOUNT;
  return {
    totalBudget,
    splitCount,
    currency: String(params.currency || 'USD').trim().toUpperCase(),
    targetProfitRate,
    smallDiscount,
    allowFractionalShares: params.allowFractionalShares === true,
    restartAfterSell: params.restartAfterSell !== false
  };
}

function normalizeState(state, params) {
  if (!state || typeof state !== 'object') throw new Error('state is required');
  const cash = Number.isFinite(state.cash) ? state.cash : params.totalBudget;
  const holdingQuantity = Number.isFinite(state.holdingQuantity) ? state.holdingQuantity : 0;
  const averagePrice = Number.isFinite(state.averagePrice) ? state.averagePrice : 0;
  const investedAmount = Number.isFinite(state.investedAmount) ? state.investedAmount : 0;
  const realizedProfit = Number.isFinite(state.realizedProfit) ? state.realizedProfit : 0;
  const currentRound = Number.isFinite(state.currentRound) && state.currentRound >= 0 ? state.currentRound : 0;
  const cycleBudget = Number.isFinite(state.cycleBudget) && state.cycleBudget > 0 ? state.cycleBudget : params.totalBudget;
  const completed = state.completed === true;
  assertNonNegativeNumber(cash, 'cash');
  assertNonNegativeNumber(holdingQuantity, 'holdingQuantity');
  if (!params.allowFractionalShares && !Number.isInteger(holdingQuantity)) {
    throw new Error('holdingQuantity must be an integer when fractional shares are disabled');
  }
  assertNonNegativeNumber(averagePrice, 'averagePrice');
  assertNonNegativeNumber(investedAmount, 'investedAmount');
  return { cash, holdingQuantity, averagePrice, investedAmount, realizedProfit, currentRound, cycleBudget, completed };
}

export function initialState(params) {
  const p = normalizeParams(params);
  return {
    cash: p.totalBudget,
    holdingQuantity: 0,
    averagePrice: 0,
    investedAmount: 0,
    realizedProfit: 0,
    currentRound: 0,
    cycleBudget: p.totalBudget,
    completed: false
  };
}

function deriveMetrics({ price, holdingQuantity, investedAmount, cash, params }) {
  const evaluationAmount = holdingQuantity * price;
  const totalAsset = cash + evaluationAmount;
  const unrealizedProfit = evaluationAmount - investedAmount;
  const returnRate = params.totalBudget > 0 ? (totalAsset - params.totalBudget) / params.totalBudget : 0;
  return { evaluationAmount, totalAsset, unrealizedProfit, returnRate };
}

function buyFill({ s, params, qty, fillPrice, roundNo, reason, tradeDate }) {
  const amount = qty * fillPrice;
  const newQuantity = s.holdingQuantity + qty;
  const newInvested = s.investedAmount + amount;
  const newAveragePrice = newQuantity > 0 ? newInvested / newQuantity : 0;
  const nextState = {
    ...s,
    cash: s.cash - amount,
    holdingQuantity: newQuantity,
    averagePrice: newAveragePrice,
    investedAmount: newInvested
  };
  return {
    decision: Decision.BUY,
    side: Decision.BUY,
    price: fillPrice,
    quantity: qty,
    amount,
    roundNo,
    reason,
    tradeDate,
    nextState,
    metrics: deriveMetrics({
      price: fillPrice,
      holdingQuantity: newQuantity,
      investedAmount: newInvested,
      cash: nextState.cash,
      params
    })
  };
}

function sellQty(s, p, sellPrice, qty, roundNo, reason, tradeDate, restartCycle = false, completeRun = false) {
  const proceeds = qty * sellPrice;
  const realizedDelta = (sellPrice - s.averagePrice) * qty;
  const remainingQty = s.holdingQuantity - qty;
  const remainingInvested = remainingQty > 0 ? s.averagePrice * remainingQty : 0;
  const remainingAvg = remainingQty > 0 ? s.averagePrice : 0;
  const nextState = {
    cash: s.cash + proceeds,
    holdingQuantity: remainingQty,
    averagePrice: remainingAvg,
    investedAmount: remainingInvested,
    realizedProfit: s.realizedProfit + realizedDelta,
    currentRound: restartCycle ? 0 : s.currentRound,
    cycleBudget: restartCycle ? (s.cash + proceeds + remainingQty * sellPrice) : s.cycleBudget,
    completed: completeRun
  };
  return {
    decision: Decision.SELL,
    side: Decision.SELL,
    price: sellPrice,
    quantity: qty,
    amount: proceeds,
    roundNo,
    reason,
    tradeDate,
    nextState,
    metrics: deriveMetrics({
      price: sellPrice,
      holdingQuantity: remainingQty,
      investedAmount: remainingInvested,
      cash: nextState.cash,
      params: p
    })
  };
}

function makeHold(s, p, price, roundNo, reason, tradeDate) {
  return {
    decision: Decision.HOLD,
    side: Decision.HOLD,
    price,
    quantity: 0,
    amount: 0,
    roundNo,
    reason,
    tradeDate,
    nextState: { ...s },
    metrics: deriveMetrics({
      price,
      holdingQuantity: s.holdingQuantity,
      investedAmount: s.investedAmount,
      cash: s.cash,
      params: p
    })
  };
}

function makeCompleted(s, p, price, roundNo, reason, tradeDate) {
  return {
    decision: Decision.COMPLETED,
    side: Decision.COMPLETED,
    price,
    quantity: 0,
    amount: 0,
    roundNo,
    reason,
    tradeDate,
    nextState: { ...s, completed: true },
    metrics: deriveMetrics({
      price,
      holdingQuantity: s.holdingQuantity,
      investedAmount: s.investedAmount,
      cash: s.cash,
      params: p
    })
  };
}

export function evaluateDay({ mode = TradingMode.BACKTEST, ohlc, prevClose, params, state, tradeDate } = {}) {
  if (!isTradingMode(mode)) throw new Error(`Unknown trading mode: ${mode}`);
  if (!ohlc || typeof ohlc !== 'object') throw new Error('ohlc is required');
  const { open, high, low, close } = ohlc;
  assertPositiveNumber(open, 'open');
  assertPositiveNumber(high, 'high');
  assertPositiveNumber(low, 'low');
  assertPositiveNumber(close, 'close');
  const p = normalizeParams(params);
  let s = normalizeState(state, p);
  if (s.completed) {
    return { decisions: [makeCompleted(s, p, close, s.currentRound, '백테스트가 이미 종료된 상태.', tradeDate)], nextState: s };
  }
  const T = perRoundBudget(s, p);
  const nextRoundNo = Math.min(s.currentRound + 1, p.splitCount);

  // 1) LOC 매도: 평단가 × (1+목표) 한도에 매도 주문 → 장중 고가가 한도 도달 시 체결.
  if (s.holdingQuantity > 0) {
    const target = s.averagePrice * (1 + p.targetProfitRate);
    if (high >= target) {
      const qty = s.holdingQuantity;
      const proceeds = target * qty;
      const realized = (target - s.averagePrice) * qty;
      const tail = p.restartAfterSell ? '사이클을 새로 시작합니다.' : '백테스트를 종료합니다.';
      const reason =
        `목표가 매도: 장중 고가 ${fmtMoney(high, p)}가 목표가 ${fmtMoney(target, p)}에 도달했습니다. ` +
        `${fmtQty(qty)}주를 모두 매도했고 실현손익은 ${realized >= 0 ? '+' : ''}${fmtMoney(realized, p)}입니다. ${tail}`;
      const dec = sellQty(s, p, target, qty, nextRoundNo, reason, tradeDate, p.restartAfterSell, !p.restartAfterSell);
      return { decisions: [dec], nextState: dec.nextState };
    }
  }

  // 2) 분할 회차 모두 소진 → 보유 1/4 매도해 시드 재확보 (현금이 T보다 적을 때만)
  if (s.currentRound >= p.splitCount) {
    if (s.holdingQuantity > 0 && s.cash < T) {
      const qty = p.allowFractionalShares
        ? (roundQuantity(s.holdingQuantity / 4, p) || s.holdingQuantity)
        : Math.max(1, Math.min(s.holdingQuantity, Math.ceil(s.holdingQuantity / 4)));
      const proceeds = qty * close;
      const realized = (close - s.averagePrice) * qty;
      const reason =
        `현금 확보 매도: ${p.splitCount}회차를 모두 사용했지만 목표가에 닿지 않았습니다. ` +
        `${fmtQty(qty)}주를 종가 ${fmtMoney(close, p)}에 매도해 다음 매수 자금을 확보했습니다. ` +
        `실현손익은 ${realized >= 0 ? '+' : ''}${fmtMoney(realized, p)}입니다.`;
      const dec = sellQty(s, p, close, qty, p.splitCount, reason, tradeDate, true, false);
      return { decisions: [dec], nextState: dec.nextState };
    }
    if (s.holdingQuantity === 0) {
      return {
        decisions: [makeCompleted(s, p, close, p.splitCount, `${p.splitCount}회차를 모두 사용했고 보유 수량이 없어 백테스트를 종료합니다.`, tradeDate)],
        nextState: { ...s, completed: true }
      };
    }
    // 보유 있고 현금 충분: 마지막 회차 번호로 추가 매수 기회를 계속 평가한다.
  }

  const roundNo = Math.min(s.currentRound + 1, p.splitCount);
  const prevCloseSafe = Number.isFinite(prevClose) && prevClose > 0 ? prevClose : open;

  // 3) 첫 매수 (보유 0): 시가에 회차 예산만큼 매수. 국내는 정수 주 단위.
  if (s.holdingQuantity === 0 || s.averagePrice <= 0) {
    const planned = Math.min(T, s.cash);
    const qty = quantityForBudget(planned, open, p);
    if (qty <= 0) {
      const reason = `관망: 회차 예산 ${fmtMoney(T, p)}으로 시가 ${fmtMoney(open, p)}에서 매수할 수 없습니다. 예산을 늘리거나 분할 회차를 줄여보세요.`;
      return { decisions: [makeHold(s, p, close, roundNo, reason, tradeDate)], nextState: { ...s } };
    }
    const reason =
      `첫 매수: 시가 ${fmtMoney(open, p)}에 ${fmtQty(qty)}주를 매수했습니다. 사용 금액은 ${fmtMoney(qty * open, p)}입니다.`;
    const dec = buyFill({ s, params: p, qty, fillPrice: open, roundNo, reason, tradeDate });
    return { decisions: [dec], nextState: { ...dec.nextState, currentRound: roundNo, prevClose: close } };
  }

  // 4) 일반 매수: 큰수/작은수 LOC 분할.
  const half = T / 2;
  const bigPrice = Math.max(prevCloseSafe, s.averagePrice);
  const smallPrice = Math.min(prevCloseSafe, s.averagePrice) * (1 - p.smallDiscount);
  const decisions = [];
  let workingState = s;

  // 큰수 LOC: 종가 ≤ bigPrice 면 체결.
  if (close <= bigPrice) {
    const available = Math.min(half, workingState.cash);
    const qty = quantityForBudget(available, close, p);
    if (qty > 0) {
      const reason =
        `매수: 종가 ${fmtMoney(close, p)}가 기준가 ${fmtMoney(bigPrice, p)} 이하라 ${fmtQty(qty)}주를 매수했습니다. 사용 금액은 ${fmtMoney(qty * close, p)}입니다.`;
      const dec = buyFill({ s: workingState, params: p, qty, fillPrice: close, roundNo, reason, tradeDate });
      decisions.push(dec);
      workingState = dec.nextState;
    }
  }

  // 작은수 LOC: 종가 ≤ smallPrice 면 체결.
  if (close <= smallPrice) {
    const available = Math.min(half, workingState.cash);
    const qty = quantityForBudget(available, close, p);
    if (qty > 0) {
      const reason =
        `추가 매수: 종가 ${fmtMoney(close, p)}가 추가 매수 기준 ${fmtMoney(smallPrice, p)} 이하라 ${fmtQty(qty)}주를 더 매수했습니다. 사용 금액은 ${fmtMoney(qty * close, p)}입니다.`;
      const dec = buyFill({ s: workingState, params: p, qty, fillPrice: close, roundNo, reason, tradeDate });
      decisions.push(dec);
      workingState = dec.nextState;
    }
  }

  if (decisions.length === 0) {
    const target = s.averagePrice * (1 + p.targetProfitRate);
    const reason =
      `관망: 종가 ${fmtMoney(close, p)}가 매수 기준 ${fmtMoney(bigPrice, p)}보다 높고, 장중 고가도 목표가 ${fmtMoney(target, p)}에 닿지 않았습니다.`;
    decisions.push(makeHold(s, p, close, roundNo, reason, tradeDate));
  }

  const hasBuy = decisions.some((decision) => decision.decision === Decision.BUY);
  return { decisions, nextState: { ...workingState, currentRound: hasBuy ? roundNo : s.currentRound, prevClose: close } };
}

// 단일가 평가 (live evaluation 호환용).
export function evaluate({ mode = TradingMode.BACKTEST, price, tradeDate, params, state } = {}) {
  if (!isTradingMode(mode)) throw new Error(`Unknown trading mode: ${mode}`);
  assertPositiveNumber(price, 'price');
  const p = normalizeParams(params);
  const s = normalizeState(state, p);
  const roundNo = Math.min(s.currentRound + 1, p.splitCount);
  if (s.completed) return makeCompleted(s, p, price, s.currentRound, '종료 상태', tradeDate);
  if (s.holdingQuantity > 0 && price >= s.averagePrice * (1 + p.targetProfitRate)) {
    return sellQty(s, p, price, s.holdingQuantity, roundNo, '목표 수익률 도달', tradeDate, p.restartAfterSell, !p.restartAfterSell);
  }
  if (s.currentRound >= p.splitCount && s.holdingQuantity === 0) {
    return makeCompleted(s, p, price, p.splitCount, `${p.splitCount}회차 소진 후 보유 없음`, tradeDate);
  }
  const qty = quantityForBudget(perRoundBudget(s, p), price, p);
  if (qty <= 0 || qty * price > s.cash) {
    return makeHold(s, p, price, roundNo, '회차 예산으로 매수할 수 없거나 현금 부족', tradeDate);
  }
  const dec = buyFill({ s, params: p, qty, fillPrice: price, roundNo, reason: '단일가 평가 매수', tradeDate });
  dec.nextState.currentRound = roundNo;
  return dec;
}

function fmt(n) {
  if (!Number.isFinite(n)) return '—';
  return Math.abs(n) >= 100
    ? n.toLocaleString('en-US', { maximumFractionDigits: 2 })
    : n.toLocaleString('en-US', { maximumFractionDigits: 4 });
}

function fmtMoney(n, params) {
  return `${fmt(n)} ${params.currency}`;
}

function perRoundBudget(state, params) {
  const cycleBudget = Number.isFinite(state.cycleBudget) && state.cycleBudget > 0
    ? state.cycleBudget
    : params.totalBudget;
  return cycleBudget / params.splitCount;
}

function quantityForBudget(budget, price, params) {
  if (!Number.isFinite(budget) || !Number.isFinite(price) || budget <= 0 || price <= 0) return 0;
  return roundQuantity(budget / price, params);
}

function roundQuantity(quantity, params) {
  if (!Number.isFinite(quantity) || quantity <= 0) return 0;
  if (!params.allowFractionalShares) return Math.floor(quantity);
  return Math.floor(quantity * 1_000_000) / 1_000_000;
}

function fmtQty(n) {
  if (!Number.isFinite(n)) return '0';
  return n.toLocaleString('en-US', { maximumFractionDigits: 6 });
}
