export const LAOR_NATIVE_ALGORITHM = 'LAOR_INFINITE_V2_NATIVE';

export function resolveBigBuyPremiumRate({ override, splitCount }) {
  const count = Number(splitCount);
  if (!Number.isInteger(count) || count <= 0) {
    throw new Error('splitCount must be a positive integer');
  }
  if (override === null || override === undefined || override === '') {
    return 0.1 / count;
  }
  const value = Number(override);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error('bigBuyPremiumRate must be a non-negative number');
  }
  return value;
}

export function computeMaxSplitCount({ totalBudget, referencePrice }) {
  const budget = Number(totalBudget);
  const price = Number(referencePrice);
  if (!Number.isFinite(budget) || budget <= 0) return 0;
  if (!Number.isFinite(price) || price <= 0) return 0;
  return Math.max(1, Math.floor(budget / (price * 2)));
}

export function makeIdempotencyKey({ tradeDate, strategyId, round, half }) {
  const dateString = String(tradeDate || '').replace(/-/g, '').slice(0, 8);
  return `${dateString}-${strategyId}-${round}-${half}`;
}

export function orderHalfLabel(half) {
  const labels = {
    FIRST: '첫 매수',
    AVG: '평단가 매수',
    BIG: '큰수 매수',
    SELL: '매도'
  };
  return labels[half] || half || '-';
}
