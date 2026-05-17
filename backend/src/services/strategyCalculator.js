export function evaluateStrategy({ strategy, holding, currentPrice }) {
  const price = Number(currentPrice);
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error('Current price must be greater than zero');
  }

  if (strategy.status === 'PAUSED') {
    return { decision: 'PAUSE', quantity: 0, amount: 0, roundNo: strategy.currentRound, reason: 'Strategy is paused' };
  }

  if (holding.quantity > 0 && price >= holding.averagePrice * (1 + strategy.targetProfitRate)) {
    return {
      decision: 'SELL',
      quantity: holding.quantity,
      amount: Math.floor(price * holding.quantity),
      roundNo: strategy.currentRound,
      reason: '목표 수익률 도달 → 전량 매도'
    };
  }

  if (strategy.currentRound > strategy.splitCount) {
    if (holding.quantity > 0) {
      const qty = Math.max(1, Math.min(holding.quantity, Math.ceil(holding.quantity / 4)));
      return {
        decision: 'SELL',
        quantity: qty,
        amount: Math.floor(price * qty),
        roundNo: strategy.currentRound,
        reason: '40회 매수 완료 → 보유 1/4 매도하여 시드 재확보'
      };
    }
    return { decision: 'HOLD', quantity: 0, amount: 0, roundNo: strategy.currentRound, reason: 'No remaining buy capacity' };
  }

  if (holding.remainingBudget <= 0) {
    return { decision: 'HOLD', quantity: 0, amount: 0, roundNo: strategy.currentRound, reason: 'No remaining buy capacity' };
  }

  const bigBuyPremiumRate = Number(strategy.bigBuyPremiumRate ?? 0.1);
  const baseBudget = Number(strategy.buyAmountPerRound || 0);
  let plannedBudget;
  let reason;
  if (holding.quantity === 0) {
    plannedBudget = baseBudget;
    reason = '첫 매수: 회차당 기본 수량';
  } else {
    const halfBudget = baseBudget / 2;
    // 큰수 매수 지정가는 평단가 기준. 평단가보다 큰수 매수 여유율만큼 높은 가격까지 매수한다.
    const bigBuyLimit = holding.averagePrice * (1 + (Number.isFinite(bigBuyPremiumRate) ? bigBuyPremiumRate : 0.1));
    const matched = [];
    plannedBudget = 0;
    if (price <= holding.averagePrice) {
      plannedBudget += halfBudget;
      matched.push('평단가 매수');
    }
    if (price <= bigBuyLimit) {
      plannedBudget += halfBudget;
      matched.push('큰수 매수');
    }
    if (plannedBudget <= 0) {
      return {
        decision: 'HOLD',
        quantity: 0,
        amount: 0,
        roundNo: strategy.currentRound,
        reason: '현재가가 평단가와 큰수 매수 상한을 모두 넘어 관망'
      };
    }
    reason = matched.join(' + ');
  }
  const plannedQty = Math.floor(plannedBudget / price);
  const cashCappedQty = Math.floor(holding.remainingBudget / price);
  const quantity = Math.min(plannedQty, cashCappedQty);
  if (quantity <= 0) {
    return {
      decision: 'HOLD',
      quantity: 0,
      amount: 0,
      roundNo: strategy.currentRound,
      reason: '회차 예산으로 매수할 수 없습니다.'
    };
  }

  return {
    decision: 'BUY',
    quantity,
    amount: Math.floor(quantity * price),
    roundNo: strategy.currentRound,
    reason
  };
}
