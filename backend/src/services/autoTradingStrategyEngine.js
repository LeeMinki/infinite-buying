import { resolveBigBuyPremiumRate } from './buyAlgorithm.js';

// LAOR_INFINITE_V2_NATIVE 평가 엔진.
//
// KIS Open API의 해외주식 주문 endpoint는 정수 주만 받는다. 따라서 국내/해외 모두 정수 주
// 단위로만 매수 의도를 만들고, 한 절반(`AVG` 또는 `BIG`)의 사용 가능 예산이 1주 가격에
// 못 미치면 그 절반은 intent를 만들지 않고 carryover로 다음 사이클에 누적한다.
//
// 입력 `pendingAvgBudget` / `pendingBigBudget`는 strategies 테이블의 누적 절반 예산.
// 결과의 `nextPendingAvgBudget` / `nextPendingBigBudget`는 호출자가 DB에 저장해야 한다.

export function evaluateAutoTrading(input) {
  const currentPrice = positive(input.currentPrice, 'currentPrice');
  const totalBudget = positive(input.totalBudget, 'totalBudget');
  const splitCount = positiveInteger(input.splitCount || 40, 'splitCount');
  const targetProfitRate = positive(input.targetProfitRate || 0.1, 'targetProfitRate');
  const bigBuyPremiumRate = resolveBigBuyPremiumRate({
    override: input.bigBuyPremiumRate,
    splitCount
  });
  const currentRound = Math.max(0, Math.floor(Number(input.currentRound || 0)));
  const holdingQuantity = nonNegative(input.holdingQuantity || 0);
  const averagePrice = nonNegative(input.averagePrice || 0);
  const previousClose = nonNegative(input.previousClose || 0);
  const cashAvailable = input.cashAvailable == null ? null : nonNegative(input.cashAvailable);
  const pendingAvgBudget = nonNegative(input.pendingAvgBudget || 0);
  const pendingBigBudget = nonNegative(input.pendingBigBudget || 0);
  const buyAmountPerRound = totalBudget / splitCount;

  if (holdingQuantity > 0 && averagePrice > 0 && currentPrice >= averagePrice * (1 + targetProfitRate)) {
    const sellQuantity = Math.floor(holdingQuantity);
    const expectedAmount = sellQuantity * currentPrice;
    return {
      decision: 'SELL',
      intents: [{
        half: 'SELL',
        side: 'SELL',
        orderPrice: currentPrice,
        expectedQuantity: sellQuantity,
        expectedAmount,
        reason: '목표 수익률 도달 → 전량 매도'
      }],
      expectedQuantity: sellQuantity,
      expectedOrderPrice: currentPrice,
      expectedAmount,
      nextPendingAvgBudget: 0,
      nextPendingBigBudget: 0,
      resetCarryover: true,
      reason: `목표 수익률에 도달했습니다. 현재가 ${fmt(currentPrice)}가 목표가 ${fmt(averagePrice * (1 + targetProfitRate))} 이상이므로 보유 수량 전량 매도를 검토합니다.`
    };
  }

  if (currentRound >= splitCount) {
    return {
      decision: 'HOLD',
      intents: [],
      expectedQuantity: 0,
      expectedOrderPrice: currentPrice,
      expectedAmount: 0,
      nextPendingAvgBudget: pendingAvgBudget,
      nextPendingBigBudget: pendingBigBudget,
      reason: `${splitCount}회차를 모두 사용해 추가 매수하지 않습니다.`
    };
  }

  const intents = [];
  let nextPendingAvg = pendingAvgBudget;
  let nextPendingBig = pendingBigBudget;
  const conditionNotes = [];

  if (holdingQuantity <= 0 || averagePrice <= 0) {
    const available = buyAmountPerRound + pendingAvgBudget + pendingBigBudget;
    const quantity = Math.floor(available / currentPrice);
    if (quantity > 0) {
      intents.push({
        half: 'FIRST',
        side: 'BUY',
        orderPrice: currentPrice,
        expectedQuantity: quantity,
        expectedAmount: quantity * currentPrice,
        reason: `첫 매수: 현재가 ${fmt(currentPrice)}에 ${quantity}주`
      });
      // 첫 매수가 발생하면 carryover는 사이클 시작점이라 0으로 리셋.
      nextPendingAvg = 0;
      nextPendingBig = 0;
    } else {
      // 1주도 못 사면 모든 누적과 회차 절반을 carryover로 보존.
      nextPendingAvg = pendingAvgBudget + buyAmountPerRound / 2;
      nextPendingBig = pendingBigBudget + buyAmountPerRound / 2;
    }
  } else {
    const halfBudget = buyAmountPerRound / 2;
    const availableAvg = halfBudget + pendingAvgBudget;
    const availableBig = halfBudget + pendingBigBudget;
    const bigBuyBasePrice = previousClose || currentPrice;
    const bigBuyPrice = bigBuyBasePrice * (1 + bigBuyPremiumRate);

    if (currentPrice <= averagePrice) {
      const quantity = Math.floor(availableAvg / averagePrice);
      if (quantity > 0) {
        const amount = quantity * averagePrice;
        intents.push({
          half: 'AVG',
          side: 'BUY',
          orderPrice: averagePrice,
          expectedQuantity: quantity,
          expectedAmount: amount,
          reason: `평단가 매수: 현재가 ${fmt(currentPrice)}가 평단가 ${fmt(averagePrice)} 이하`
        });
        nextPendingAvg = availableAvg - amount;
      } else {
        nextPendingAvg = availableAvg;
      }
    } else {
      // 조건 미충족 시 절반 예산을 다음 사이클로 이월.
      nextPendingAvg = pendingAvgBudget + halfBudget;
      conditionNotes.push(`현재가 ${fmt(currentPrice)}가 평단가 ${fmt(averagePrice)}를 초과`);
    }

    if (currentPrice <= bigBuyPrice) {
      const quantity = Math.floor(availableBig / bigBuyPrice);
      if (quantity > 0) {
        const amount = quantity * bigBuyPrice;
        intents.push({
          half: 'BIG',
          side: 'BUY',
          orderPrice: bigBuyPrice,
          expectedQuantity: quantity,
          expectedAmount: amount,
          reason: `큰수 매수: 현재가 ${fmt(currentPrice)}가 전일종가 기준 지정가 ${fmt(bigBuyPrice)} 이하`
        });
        nextPendingBig = availableBig - amount;
      } else {
        nextPendingBig = availableBig;
      }
    } else {
      nextPendingBig = pendingBigBudget + halfBudget;
      conditionNotes.push(`현재가 ${fmt(currentPrice)}가 큰수 지정가 ${fmt(bigBuyPrice)}를 초과`);
    }
  }

  if (intents.length === 0) {
    const baseReason = conditionNotes.length > 0
      ? `관망합니다. ${conditionNotes.join(', ')}했습니다.`
      : `이번 평가는 매수 조건을 만족했더라도 1주를 살 만큼 예산이 모이지 않아 다음 사이클로 이월합니다.`;
    return {
      decision: 'HOLD',
      intents: [],
      expectedQuantity: 0,
      expectedOrderPrice: currentPrice,
      expectedAmount: 0,
      nextPendingAvgBudget: nextPendingAvg,
      nextPendingBigBudget: nextPendingBig,
      reason: baseReason
    };
  }

  const expectedAmount = intents.reduce((sum, intent) => sum + intent.expectedAmount, 0);
  if (cashAvailable !== null && cashAvailable < expectedAmount) {
    return {
      decision: 'HOLD',
      intents: [],
      expectedQuantity: 0,
      expectedOrderPrice: currentPrice,
      expectedAmount: 0,
      nextPendingAvgBudget: pendingAvgBudget,
      nextPendingBigBudget: pendingBigBudget,
      reason: `매수가능금액이 부족합니다. 필요 금액은 ${fmt(expectedAmount)}, 확인된 매수가능금액은 ${fmt(cashAvailable)}입니다.`
    };
  }

  const totalQuantity = intents.reduce((sum, intent) => sum + intent.expectedQuantity, 0);
  return {
    decision: 'BUY',
    intents,
    expectedQuantity: totalQuantity,
    expectedOrderPrice: intents[0].orderPrice,
    expectedAmount,
    nextPendingAvgBudget: nextPendingAvg,
    nextPendingBigBudget: nextPendingBig,
    reason: `${currentRound + 1}/${splitCount}회차 매수 조건입니다. ${intents.map((intent) => intent.reason).join(' / ')}. 총 ${totalQuantity}주 매수를 검토합니다.`
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

function fmt(value) {
  return Number(value || 0).toLocaleString('ko-KR', { maximumFractionDigits: 6 });
}
