export function evaluateAutoTrading(input) {
  const currentPrice = positive(input.currentPrice, 'currentPrice');
  const totalBudget = positive(input.totalBudget, 'totalBudget');
  const splitCount = positiveInteger(input.splitCount || 40, 'splitCount');
  const targetProfitRate = positive(input.targetProfitRate || 0.1, 'targetProfitRate');
  const bigBuyPremiumRate = nonNegative(input.bigBuyPremiumRate ?? 0.1);
  const currentRound = Math.max(0, Math.floor(Number(input.currentRound || 0)));
  const holdingQuantity = nonNegative(input.holdingQuantity || 0);
  const averagePrice = nonNegative(input.averagePrice || 0);
  const previousClose = nonNegative(input.previousClose || 0);
  const cashAvailable = input.cashAvailable == null ? null : nonNegative(input.cashAvailable);
  // 국내 종목은 정수 주 단위만 가능. 해외 종목은 KIS 소수점매수 서비스를 가정해 소수점을 허용한다.
  // 이렇게 하면 회차 예산이 한 주 값보다 작은 경우(예: $30 vs $80)에도 자동매매가 HOLD로 막히지 않고
  // 작은 분수 주식이라도 매수 결정을 만든다. 실제 KIS 표준 주문 endpoint는 정수만 받으므로,
  // 실주문 모드에서는 SafetyGuard가 별도로 1주 미만 케이스를 차단/안내한다.
  const allowFractional = String(input.market || '').toUpperCase() !== 'KR';
  const buyAmountPerRound = allowFractional ? (totalBudget / splitCount) : Math.floor(totalBudget / splitCount);

  if (holdingQuantity > 0 && averagePrice > 0 && currentPrice >= averagePrice * (1 + targetProfitRate)) {
    const expectedAmount = holdingQuantity * currentPrice;
    return {
      decision: 'SELL',
      expectedQuantity: roundQuantity(holdingQuantity, input.market),
      expectedOrderPrice: currentPrice,
      expectedAmount,
      reason: `목표 수익률에 도달했습니다. 현재가 ${fmt(currentPrice)}가 목표가 ${fmt(averagePrice * (1 + targetProfitRate))} 이상이므로 보유 수량 전량 매도를 검토합니다.`
    };
  }

  if (currentRound >= splitCount) {
    return {
      decision: 'HOLD',
      expectedQuantity: 0,
      expectedOrderPrice: currentPrice,
      expectedAmount: 0,
      reason: `${splitCount}회차를 모두 사용해 추가 매수하지 않습니다.`
    };
  }

  let buyBudget = buyAmountPerRound;
  let buyReason = '첫 매수';
  if (holdingQuantity > 0 && averagePrice > 0) {
    const halfBudget = buyAmountPerRound / 2;
    const bigBuyBasePrice = previousClose || currentPrice;
    const bigBuyPrice = bigBuyBasePrice * (1 + bigBuyPremiumRate);
    const matched = [];
    buyBudget = 0;
    if (currentPrice <= averagePrice) {
      buyBudget += halfBudget;
      matched.push(`평단가 매수: 현재가 ${fmt(currentPrice)}가 평단가 ${fmt(averagePrice)} 이하`);
    }
    if (currentPrice <= bigBuyPrice) {
      buyBudget += halfBudget;
      matched.push(`큰수 매수: 현재가 ${fmt(currentPrice)}가 전일 종가 기준 매수 상한 ${fmt(bigBuyPrice)} 이하`);
    }
    if (buyBudget <= 0) {
      return {
        decision: 'HOLD',
        expectedQuantity: 0,
        expectedOrderPrice: currentPrice,
        expectedAmount: 0,
        reason: `관망합니다. 현재가 ${fmt(currentPrice)}가 평단가 ${fmt(averagePrice)}보다 높고, 전일 종가 기준 큰수 매수 상한 ${fmt(bigBuyPrice)}도 넘었습니다.`
      };
    }
    buyReason = matched.join(' / ');
  }

  const rawQuantity = buyBudget / currentPrice;
  const quantity = allowFractional ? Number(rawQuantity.toFixed(6)) : Math.floor(rawQuantity);
  if (quantity <= 0) {
    return {
      decision: 'HOLD',
      expectedQuantity: 0,
      expectedOrderPrice: currentPrice,
      expectedAmount: 0,
      reason: `이번 평가의 매수 예산 ${fmt(buyBudget)}으로 현재가 ${fmt(currentPrice)} 기준 매수 가능한 수량이 0이라 관망합니다.`
    };
  }

  const expectedAmount = quantity * currentPrice;
  if (cashAvailable !== null && cashAvailable < expectedAmount) {
    return {
      decision: 'HOLD',
      expectedQuantity: 0,
      expectedOrderPrice: currentPrice,
      expectedAmount: 0,
      reason: `매수가능금액이 부족합니다. 필요 금액은 ${fmt(expectedAmount)}, 확인된 매수가능금액은 ${fmt(cashAvailable)}입니다.`
    };
  }

  const qtyLabel = allowFractional ? `${fmt(quantity)}주` : `${quantity}주`;
  return {
    decision: 'BUY',
    expectedQuantity: quantity,
    expectedOrderPrice: currentPrice,
    expectedAmount,
    reason: `${currentRound + 1}/${splitCount}회차 매수 조건입니다. ${buyReason}. 현재가 ${fmt(currentPrice)} 기준 ${qtyLabel} 매수를 검토합니다.`
  };
}

function positive(value, label) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${label} must be positive`);
  return n;
}

function positiveInteger(value, label) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${label} must be a positive integer`);
  return n;
}

function nonNegative(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function roundQuantity(value, market) {
  if (market === 'KR') return Math.floor(value);
  return Number(Number(value).toFixed(6));
}

function fmt(value) {
  return Number(value || 0).toLocaleString('ko-KR', { maximumFractionDigits: 6 });
}
