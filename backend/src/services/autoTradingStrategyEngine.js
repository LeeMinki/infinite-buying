import { resolveBigBuyPremiumRate } from './buyAlgorithm.js';

// LAOR_INFINITE_V2_NATIVE 평가 엔진.
//
// KIS Open API의 해외주식 주문 endpoint는 정수 주만 받는다. 따라서 국내/해외 모두 정수 주
// 단위로만 매수 의도를 만들고, 한 절반(`AVG` 또는 `BIG`)의 사용 가능 예산이 1주 가격에
// 못 미치면 그 절반은 intent를 만들지 않고 다음 평가로 이월(carryover)한다.
//
// 입력 `pendingAvgBudget` / `pendingBigBudget`는 strategies 테이블의 누적 절반 예산,
// `cycleBudget`은 현재 사이클의 예산(매도로 사이클이 재시작될 때 그 시점 총자산으로 갱신).
// 결과의 `nextPendingAvgBudget` / `nextPendingBigBudget` / `nextCycleBudget` / `restartCycle`은
// 호출자가 DB에 반영해야 한다.

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
  const cashAvailable = input.cashAvailable == null ? null : nonNegative(input.cashAvailable);
  const pendingAvgBudget = nonNegative(input.pendingAvgBudget || 0);
  const pendingBigBudget = nonNegative(input.pendingBigBudget || 0);
  // 사이클 예산: 매도로 재시작될 때 총자산으로 갱신된다. 미설정(0)이면 총예산을 쓴다.
  const cycleBudget = Number(input.cycleBudget) > 0 ? Number(input.cycleBudget) : totalBudget;
  const buyAmountPerRound = cycleBudget / splitCount;

  // 매도 시점의 총자산(현금 + 보유 평가액). 다음 사이클 예산이 된다.
  const totalAsset = cashAvailable === null
    ? cycleBudget
    : Math.max(cashAvailable + holdingQuantity * currentPrice, 0) || cycleBudget;

  // 1) 목표 수익률 매도: 보유 전량 매도 후 사이클을 재시작한다.
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
      restartCycle: true,
      nextPendingAvgBudget: 0,
      nextPendingBigBudget: 0,
      nextCycleBudget: totalAsset,
      reason: `목표 수익률에 도달했습니다. 현재가 ${fmt(currentPrice)}가 목표가 ${fmt(averagePrice * (1 + targetProfitRate))} 이상이므로 보유 수량 전량 매도 후 새 사이클을 시작합니다.`
    };
  }

  // 2) 분할 회차 소진: 현금이 회차 예산보다 적으면 보유 1/4을 매도해 자금을 재확보한다.
  if (currentRound >= splitCount) {
    if (holdingQuantity > 0 && cashAvailable !== null && cashAvailable < buyAmountPerRound) {
      const sellQuantity = Math.max(1, Math.min(Math.floor(holdingQuantity), Math.ceil(holdingQuantity / 4)));
      const expectedAmount = sellQuantity * currentPrice;
      return {
        decision: 'SELL',
        intents: [{
          half: 'SELL',
          side: 'SELL',
          orderPrice: currentPrice,
          expectedQuantity: sellQuantity,
          expectedAmount,
          reason: '회차 소진 + 현금 부족 → 보유 1/4 매도'
        }],
        expectedQuantity: sellQuantity,
        expectedOrderPrice: currentPrice,
        expectedAmount,
        restartCycle: true,
        nextPendingAvgBudget: 0,
        nextPendingBigBudget: 0,
        nextCycleBudget: totalAsset,
        reason: `${splitCount}회차를 모두 사용했지만 목표가에 닿지 않았습니다. 현금이 회차 예산 ${fmt(buyAmountPerRound)}보다 적어 보유 ${sellQuantity}주를 현재가 ${fmt(currentPrice)}에 매도해 다음 매수 자금을 확보하고 새 사이클을 시작합니다.`
      };
    }
    if (holdingQuantity <= 0) {
      return {
        decision: 'HOLD',
        intents: [],
        expectedQuantity: 0,
        expectedOrderPrice: currentPrice,
        expectedAmount: 0,
        nextPendingAvgBudget: pendingAvgBudget,
        nextPendingBigBudget: pendingBigBudget,
        reason: `${splitCount}회차를 모두 사용했고 보유 수량이 없어 추가 매수를 멈춥니다.`
      };
    }
    // 보유가 있고 현금이 회차 예산 이상이면 마지막 회차에서 추가 매수 기회를 계속 평가한다.
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
      // 첫 매수가 발생하면 이월 예산은 사이클 시작점이라 0으로 리셋.
      nextPendingAvg = 0;
      nextPendingBig = 0;
    } else {
      // 1주도 못 사면 모든 누적과 회차 절반을 다음 평가로 이월.
      nextPendingAvg = pendingAvgBudget + buyAmountPerRound / 2;
      nextPendingBig = pendingBigBudget + buyAmountPerRound / 2;
    }
  } else {
    const halfBudget = buyAmountPerRound / 2;
    const availableAvg = halfBudget + pendingAvgBudget;
    const availableBig = halfBudget + pendingBigBudget;
    // 큰수 매수 지정가는 평단가 기준. 평단가보다 큰수 매수 여유율만큼 높은 가격까지 매수한다.
    const bigBuyPrice = averagePrice * (1 + bigBuyPremiumRate);

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
      // 조건 미충족 시 절반 예산을 다음 평가로 이월.
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
          reason: `큰수 매수: 현재가 ${fmt(currentPrice)}가 평단가 기준 지정가 ${fmt(bigBuyPrice)} 이하`
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
      : `이번 평가는 매수 조건을 만족했더라도 1주를 살 만큼 예산이 모이지 않아 다음 평가로 이월합니다.`;
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
  const roundLabel = Math.min(currentRound + 1, splitCount);
  return {
    decision: 'BUY',
    intents,
    expectedQuantity: totalQuantity,
    expectedOrderPrice: intents[0].orderPrice,
    expectedAmount,
    nextPendingAvgBudget: nextPendingAvg,
    nextPendingBigBudget: nextPendingBig,
    reason: `${roundLabel}/${splitCount}회차 매수 조건입니다. ${intents.map((intent) => intent.reason).join(' / ')}. 총 ${totalQuantity}주 매수를 검토합니다.`
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
