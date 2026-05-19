// 중복 주문 방지·재시도 한도는 서비스(autoTradingService)가 idempotency_key로 직접 검사한다.
// SafetyGuard는 "지금 이 주문을 내도 되는가"(상태·수량·미체결·잔액·정수주)만 본다.

export function validateOrderSafety({
  userId,
  strategy,
  decision,
  liveOrderEnabled,
  buyingPower,
  balance,
  openOrders,
  idempotencyKey,
  tradeDate
}) {
  if (strategy.status !== 'RUNNING') return block('전략이 실행 중이 아닙니다.');
  if (!['BUY', 'SELL'].includes(decision.decision)) return allowNoOrder(decision.reason);
  if (!Number.isFinite(decision.expectedQuantity) || decision.expectedQuantity <= 0) {
    return block('주문 수량이 0이라 주문하지 않습니다.');
  }
  if (Array.isArray(openOrders) && openOrders.length > 0) {
    return block('미체결 주문이 있어 신규 주문을 만들지 않습니다.');
  }
  if (decision.decision === 'BUY') {
    const cash = Number(buyingPower?.cashAvailable ?? 0);
    if (cash < decision.expectedAmount) {
      return block(`매수가능금액이 부족합니다. 필요 금액 ${fmt(decision.expectedAmount)}, 가능 금액 ${fmt(cash)}.`);
    }
  }
  if (decision.decision === 'SELL') {
    const quantity = Number(balance?.quantity ?? 0);
    if (quantity < decision.expectedQuantity) {
      return block(`보유 수량이 부족합니다. 필요 수량 ${decision.expectedQuantity}, 보유 수량 ${quantity}.`);
    }
  }
  // 실주문 모드일 때만 정수 주 제약을 적용한다. DRY_RUN은 전략 시뮬레이션이므로 소수점 그대로 둔다.
  // KIS 표준 주문(/uapi/overseas-stock/v1/trading/order)은 정수 주만 받으므로, 1주 미만은 실주문이 불가하다.
  // 소수점 매수가 필요한 사용자는 KIS 소수점매수 서비스(별도 API)로 옮겨야 한다는 점을 명시한다.
  if (liveOrderEnabled && decision.decision === 'BUY' && strategy.market && strategy.market !== 'KR') {
    if (decision.expectedQuantity < 1) {
      return block(`계산된 매수 수량이 ${fmt(decision.expectedQuantity)}주(1주 미만)입니다. KIS 표준 해외주문은 정수 주만 받으므로 실주문은 보류했습니다. 더 큰 회차 예산을 쓰거나 KIS 소수점매수 서비스 연계가 필요합니다.`);
    }
  }
  if (!liveOrderEnabled) {
    return {
      ok: true,
      orderStatus: 'DRY_RUN',
      liveOrderEnabled: false,
      reason: '실제 주문 없이 기록만 저장 중입니다.'
    };
  }
  return {
    ok: true,
    orderStatus: 'REQUESTED',
    liveOrderEnabled: true,
    reason: '안전 검증을 통과했습니다.'
  };
}

function block(reason) {
  return { ok: false, decision: 'SKIP', reason };
}

function allowNoOrder(reason) {
  return { ok: true, noOrder: true, reason };
}

function fmt(value) {
  return Number(value || 0).toLocaleString('ko-KR', { maximumFractionDigits: 6 });
}
