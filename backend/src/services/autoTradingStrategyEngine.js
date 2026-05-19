// LAOR_INFINITE_V2 라이브 평가 엔진.
//
// 회차 모델: 1 회차 = 1 거래일.
//   - 1회차(보유 0): 시작가(현재가)에 회차 예산을 한 번에 매수한다 (FIRST 1건).
//   - 2회차부터(보유 > 0): 회차 예산을 절반으로 나눠 평단가 매수(AVG)·큰수 매수(BIG)
//     두 슬롯으로 평가한다. 각 슬롯은 가격 조건을 만족할 때만 발동하므로, 하루에
//     최대 2건까지 매수할 수 있다(둘 다 조건 만족 시).
//
// executedHalves: 오늘 이미 접수/체결된 매수 슬롯 목록(FAILED 제외). 같은 슬롯은 같은 날
// 다시 만들지 않으며, 아직 안 산 슬롯은 그날 안에 조건이 충족되면 그때 매수한다.
// (예: 09시엔 현재가 > 평단가라 평단가 매수 미발동 → 13시에 현재가 ≤ 평단가가 되면 매수.)
//
// 회차 진행·사이클 예산은 호출자(autoTradingService)가 관리한다.

import { resolveBigBuyPremiumRate } from './buyAlgorithm.js';

export function evaluateAutoTrading(input) {
  const currentPrice = positive(input.currentPrice, 'currentPrice');
  const totalBudget = positive(input.totalBudget, 'totalBudget');
  const splitCount = positiveInteger(input.splitCount || 40, 'splitCount');
  const targetProfitRate = positive(input.targetProfitRate || 0.1, 'targetProfitRate');
  const bigBuyPremiumRate = resolveBigBuyPremiumRate({ override: input.bigBuyPremiumRate, splitCount });
  const currentRound = Math.max(0, Math.floor(Number(input.currentRound || 0)));
  const holdingQuantity = nonNegative(input.holdingQuantity || 0);
  const averagePrice = nonNegative(input.averagePrice || 0);
  const cashAvailable = input.cashAvailable == null ? null : nonNegative(input.cashAvailable);
  const cycleBudget = Number(input.cycleBudget) > 0 ? Number(input.cycleBudget) : totalBudget;
  const executed = new Set(input.executedHalves || []);

  const roundBudget = cycleBudget / splitCount;
  const cash = cashAvailable === null ? Infinity : cashAvailable;
  // 매도 시점 총자산(현금 + 보유 평가액) — 다음 사이클 예산.
  const totalAsset = cashAvailable === null
    ? cycleBudget
    : Math.max(cashAvailable + holdingQuantity * currentPrice, 0) || cycleBudget;

  // 1) 목표 수익률 매도: 보유 전량 매도 후 사이클 재시작.
  if (holdingQuantity > 0 && averagePrice > 0 && currentPrice >= averagePrice * (1 + targetProfitRate)) {
    const target = averagePrice * (1 + targetProfitRate);
    return sellAll(holdingQuantity, currentPrice, totalAsset,
      `목표 수익률 도달: 현재가 ${fmt(currentPrice)}가 목표가 ${fmt(target)} 이상이라 보유 전량을 매도하고 새 사이클을 시작합니다.`);
  }

  // 2) 회차 소진 + 현금 부족 → 보유 1/4 매도로 자금 재확보.
  if (currentRound >= splitCount) {
    if (holdingQuantity > 0 && cashAvailable !== null && cashAvailable < roundBudget) {
      const qty = Math.max(1, Math.min(Math.floor(holdingQuantity), Math.ceil(holdingQuantity / 4)));
      return {
        decision: 'SELL',
        intents: [{ half: 'SELL', side: 'SELL', orderPrice: currentPrice, expectedQuantity: qty, expectedAmount: qty * currentPrice, reason: '회차 소진 + 현금 부족 → 보유 1/4 매도' }],
        expectedQuantity: qty,
        expectedOrderPrice: currentPrice,
        expectedAmount: qty * currentPrice,
        restartCycle: true,
        nextCycleBudget: totalAsset,
        reason: `${splitCount}회차를 모두 썼지만 목표가에 닿지 않았습니다. 현금이 회차 예산보다 적어 보유 ${qty}주를 매도해 자금을 확보하고 새 사이클을 시작합니다.`
      };
    }
    if (holdingQuantity <= 0) {
      return hold(currentPrice, `${splitCount}회차를 모두 썼고 보유 수량이 없어 추가 매수를 멈춥니다.`);
    }
    // 보유가 있고 현금이 충분하면 마지막 회차로 추가 매수를 계속 평가한다.
  }

  // 3) 매수.
  // 오늘 1회차 첫 매수를 이미 했으면 그날은 끝(1회차는 하루 1매수).
  if (executed.has('FIRST')) {
    return hold(currentPrice, '오늘 1회차 첫 매수를 마쳤습니다. 다음 매수는 다음 거래일(2회차)에 평가합니다.');
  }

  if (holdingQuantity <= 0 || averagePrice <= 0) {
    // 1회차: 시작가(현재가)에 회차 예산 일괄 매수.
    const budget = Math.min(roundBudget, cash);
    const qty = Math.floor(budget / currentPrice);
    if (qty <= 0) {
      return hold(currentPrice, `회차 예산 ${fmt(roundBudget)}으로 현재가 ${fmt(currentPrice)}에서 1주도 매수할 수 없습니다.`);
    }
    return buyResult([{
      half: 'FIRST', side: 'BUY', orderPrice: currentPrice,
      expectedQuantity: qty, expectedAmount: qty * currentPrice,
      reason: `1회차 첫 매수: 현재가 ${fmt(currentPrice)}에 ${qty}주`
    }], currentRound, splitCount);
  }

  // 2회차+: 회차 예산을 절반씩 — 평단가 매수(AVG) / 큰수 매수(BIG).
  const halfBudget = roundBudget / 2;
  const bigBuyPrice = averagePrice * (1 + bigBuyPremiumRate);
  const intents = [];
  const notes = [];
  let remainingCash = cash;

  if (!executed.has('AVG')) {
    if (currentPrice <= averagePrice) {
      const qty = Math.floor(Math.min(halfBudget, remainingCash) / averagePrice);
      if (qty > 0) {
        const amount = qty * averagePrice;
        intents.push({ half: 'AVG', side: 'BUY', orderPrice: averagePrice, expectedQuantity: qty, expectedAmount: amount,
          reason: `평단가 매수: 현재가 ${fmt(currentPrice)}가 평단가 ${fmt(averagePrice)} 이하` });
        remainingCash -= amount;
      } else {
        notes.push('평단가 매수 예산으로 1주를 살 수 없어 건너뜀');
      }
    } else {
      notes.push(`현재가 ${fmt(currentPrice)}가 평단가 ${fmt(averagePrice)}를 초과`);
    }
  }
  if (!executed.has('BIG')) {
    if (currentPrice <= bigBuyPrice) {
      const qty = Math.floor(Math.min(halfBudget, remainingCash) / bigBuyPrice);
      if (qty > 0) {
        const amount = qty * bigBuyPrice;
        intents.push({ half: 'BIG', side: 'BUY', orderPrice: bigBuyPrice, expectedQuantity: qty, expectedAmount: amount,
          reason: `큰수 매수: 현재가 ${fmt(currentPrice)}가 큰수 지정가 ${fmt(bigBuyPrice)} 이하` });
        remainingCash -= amount;
      } else {
        notes.push('큰수 매수 예산으로 1주를 살 수 없어 건너뜀');
      }
    } else {
      notes.push(`현재가 ${fmt(currentPrice)}가 큰수 지정가 ${fmt(bigBuyPrice)}를 초과`);
    }
  }

  if (intents.length === 0) {
    const done = [];
    if (executed.has('AVG')) done.push('평단가 매수');
    if (executed.has('BIG')) done.push('큰수 매수');
    const doneNote = done.length > 0 ? ` (오늘 ${done.join('·')} 완료)` : '';
    return hold(currentPrice, `관망${doneNote}. ${notes.join(', ')}.`);
  }
  return buyResult(intents, currentRound, splitCount);
}

function sellAll(qty, price, totalAsset, reason) {
  return {
    decision: 'SELL',
    intents: [{ half: 'SELL', side: 'SELL', orderPrice: price, expectedQuantity: qty, expectedAmount: qty * price, reason }],
    expectedQuantity: qty,
    expectedOrderPrice: price,
    expectedAmount: qty * price,
    restartCycle: true,
    nextCycleBudget: totalAsset,
    reason
  };
}

function hold(price, reason) {
  return { decision: 'HOLD', intents: [], expectedQuantity: 0, expectedOrderPrice: price, expectedAmount: 0, reason };
}

function buyResult(intents, currentRound, splitCount) {
  const totalQuantity = intents.reduce((sum, i) => sum + i.expectedQuantity, 0);
  const totalAmount = intents.reduce((sum, i) => sum + i.expectedAmount, 0);
  const roundLabel = Math.min(currentRound + 1, splitCount);
  return {
    decision: 'BUY',
    intents,
    expectedQuantity: totalQuantity,
    expectedOrderPrice: intents[0].orderPrice,
    expectedAmount: totalAmount,
    reason: `${roundLabel}/${splitCount}회차 매수. ${intents.map((i) => i.reason).join(' / ')}.`
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
