import { getDb } from '../db/connection.js';
import * as repo from '../repositories/krRankRepository.js';
import { KisTradingService } from './kisTradingService.js';
import { env } from '../config/env.js';
import { createHash } from 'node:crypto';

const REASON = 'VERIFIED_ABSENT_AFTER_RATE_LIMIT';
const MESSAGE = '운영자 대사: 과거 호출 제한 주문의 증권사 주문 내역·미체결·잔고 부재를 재확인하여 미확정 상태를 종결했습니다.';

// 스케줄러/HTTP 경로에서는 호출하지 않는다. UNKNOWN을 시간만으로 자동 해제하지 않는다.
// apply도 dry-run 결과를 재사용하지 않고, 같은 평가 잠금 아래 증권사 GET을 다시 수행한다.
export async function reconcileKrUnknownOrder({ userId, orderId, apply = false, acknowledgeNoBrokerOrder = false,
  acknowledgeSameAccount = false }, {
  trading = new KisTradingService(userId),
  now = () => new Date(),
  pause = () => new Promise((resolve) => setTimeout(resolve, 1200))
} = {}) {
  if (apply && !acknowledgeNoBrokerOrder) throw new Error('적용하려면 증권사 주문 부재 확인을 명시해야 합니다.');
  if (apply && !acknowledgeSameAccount) throw new Error('적용하려면 주문 당시와 동일한 계좌임을 확인해야 합니다.');
  const db = getDb();
  const initial = loadEligible(db, userId, orderId, now());
  const lease = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  if (!repo.acquireLock(userId, initial.order.strategy_id, 'evaluate', lease)) {
    throw new Error('전략 평가가 진행 중입니다. 완료 후 다시 대사하세요.');
  }
  try {
    const snapshot = loadEligible(db, userId, orderId, now());
    const startDate = snapshot.entry.trade_date.replaceAll('-', '');
    const endDate = kstDate(now()).replaceAll('-', '');
    const checks = [];
    // 한 번의 잔고 0을 체결 부재로 간주하지 않는다. 과거 날짜만 두 차례 전체 조회한다.
    for (let index = 0; index < 2; index += 1) {
      if (index) await pause();
      const startedAt = now().toISOString();
      let history, openOrders, balance;
      try {
        history = await trading.getOrderHistory('', { market: 'KR', exchange: 'ALL', startDate, endDate });
        openOrders = await trading.getOpenOrders('', { market: 'KR' });
        balance = await trading.getBalance(snapshot.order.symbol, { market: 'KR', currency: 'KRW' });
      } catch {
        // 증권사 오류 원문에는 계좌 정보가 섞일 수 있어 CLI로 전달하지 않는다.
        throw new Error('증권사 전체 조회에 실패하여 대사를 중단합니다. 주문 상태는 변경하지 않았습니다.');
      }
      // KIS adapter는 모든 페이지 성공 때만 반환하며 불완전 조회는 throw한다.
      if (!Array.isArray(history) || !Array.isArray(openOrders)
        || history.some((row) => !row?.symbol || !row?.orderNo)
        || openOrders.some((row) => !row?.symbol || !row?.orderNo)
        || balance?.quantity === null || balance?.quantity === undefined
        || !Number.isFinite(Number(balance.quantity))) {
        throw new Error('증권사 조회 결과를 완전하게 검증할 수 없어 대사를 중단합니다.');
      }
      const symbol = snapshot.order.symbol;
      if (history.some((row) => row.symbol === symbol) || openOrders.some((row) => row.symbol === symbol)
        || Number(balance.quantity) !== 0) {
        throw new Error('해당 종목의 주문 내역·미체결 또는 잔고가 있어 자동 종결할 수 없습니다.');
      }
      checks.push({ startedAt, completedAt: now().toISOString(), complete: true,
        historyCount: history.length, openOrderCount: openOrders.length, targetHistoryCount: 0,
        targetOpenOrderCount: 0, targetBalanceQuantity: 0 });
    }
    const evidence = { exchange: 'ALL', startDate, endDate, checks,
      credentialFingerprint: snapshot.credentialFingerprint, sameAccountAcknowledged: acknowledgeSameAccount };
    const result = { mode: apply ? 'APPLY' : 'DRY_RUN', eligible: true, reasonCode: REASON,
      orderId, symbol: snapshot.order.symbol, originalStatus: snapshot.order.status, evidence };
    if (!apply) return result;
    db.transaction(() => {
      const lock = db.prepare(`SELECT locked_until FROM kr_rank_locks
        WHERE user_id = ? AND strategy_id = ? AND lock_key = 'evaluate'`).get(userId, snapshot.order.strategy_id);
      if (lock?.locked_until !== lease || Date.now() >= Date.parse(lease)) throw new Error('대사 잠금이 만료되었습니다. 다시 조회하세요.');
      const current = loadEligible(db, userId, orderId, now());
      if (JSON.stringify(current) !== JSON.stringify(snapshot)) throw new Error('조회 중 주문/진입/전략이 변경되었습니다. 다시 대사하세요.');
      db.prepare(`INSERT INTO kr_order_reconciliations
        (user_id, strategy_id, order_id, entry_id, actor, reason_code, original_status, original_error_code, evidence_json)
        VALUES (?, ?, ?, ?, 'OPERATOR', ?, 'UNKNOWN', 'EGW00201', ?)`)
        .run(userId, current.order.strategy_id, orderId, current.entry.id, REASON, JSON.stringify(evidence));
      // 원래 error_message/response_payload_masked를 보존한다. KIS REJECTED로 단정하지 않는다.
      db.prepare(`UPDATE kr_rank_orders SET status = 'FAILED', remaining_quantity = 0,
        decision_reason = decision_reason || char(10) || ?, updated_at = datetime('now')
        WHERE user_id = ? AND id = ?`).run(MESSAGE, userId, orderId);
      db.prepare(`UPDATE kr_rank_entries SET status = 'SKIPPED', updated_at = datetime('now')
        WHERE user_id = ? AND id = ?`).run(userId, current.entry.id);
      repo.markEvaluation(userId, current.order.strategy_id, { decision: 'SKIP' });
      repo.createDecisionLog(userId, { strategyId: current.order.strategy_id, orderId,
        entryWindow: current.entry.entry_window, decision: 'SKIP', liveOrderEnabled: true,
        evaluationSource: 'MANUAL', selectedSymbol: current.order.symbol, reason: MESSAGE });
    })();
    return { ...result, status: 'FAILED', entryStatus: 'SKIPPED' };
  } finally {
    // 만료 뒤 다른 프로세스가 얻은 새 잠금은 삭제하지 않는다.
    db.prepare(`DELETE FROM kr_rank_locks WHERE user_id = ? AND strategy_id = ?
      AND lock_key = 'evaluate' AND locked_until = ?`).run(userId, initial.order.strategy_id, lease);
  }
}

function loadEligible(db, userId, orderId, now) {
  const order = db.prepare('SELECT * FROM kr_rank_orders WHERE user_id = ? AND id = ?').get(userId, orderId);
  if (!order) throw new Error('해당 사용자의 주문을 찾을 수 없습니다.');
  let payload;
  try { payload = JSON.parse(order.response_payload_masked); } catch { /* 아래에서 거절 */ }
  if (order.market !== 'KR' || order.side !== 'BUY' || order.live_order_enabled !== 1
    || order.status !== 'UNKNOWN' || order.kis_order_no || order.kis_original_order_no
    || Number(order.filled_quantity || 0) !== 0 || Number(order.average_filled_price || 0) !== 0
    || order.filled_at || payload?.msg_cd !== 'EGW00201' || String(payload?.rt_cd) !== '1') {
    throw new Error('이 명령은 체결 증거와 주문번호가 없는 과거 EGW00201 미확정 매수만 처리합니다.');
  }
  const entry = db.prepare('SELECT * FROM kr_rank_entries WHERE user_id = ? AND strategy_id = ? AND id = ?')
    .get(userId, order.strategy_id, order.entry_id);
  const strategy = db.prepare(`SELECT id, user_id, status, holding_symbol, deleted_at FROM kr_rank_strategies
    WHERE user_id = ? AND id = ?`).get(userId, order.strategy_id);
  const orderDate = kstDate(new Date(`${order.created_at.replace(' ', 'T')}${order.created_at.includes('Z') ? '' : 'Z'}`));
  if (!entry || entry.status !== 'SELECTED' || entry.bought !== 0 || entry.selected_symbol !== order.symbol
    || entry.entry_window !== order.entry_window || !/^\d{4}-\d{2}-\d{2}$/.test(entry.trade_date)
    || entry.trade_date >= kstDate(now) || orderDate !== entry.trade_date
    || !strategy || strategy.holding_symbol || strategy.deleted_at) {
    throw new Error('진입 날짜·미보유·미매수 상태가 대사 조건과 맞지 않습니다.');
  }
  const other = db.prepare(`SELECT id FROM kr_rank_orders WHERE user_id = ? AND strategy_id = ? AND id <> ?
    AND (status IN ('DECIDED', 'REQUESTED', 'ACCEPTED', 'UNKNOWN', 'PARTIALLY_FILLED')
      OR (entry_id = ? AND (status NOT IN ('FAILED', 'REJECTED') OR COALESCE(filled_quantity, 0) <> 0))) LIMIT 1`)
    .get(userId, order.strategy_id, orderId, entry.id);
  if (other) throw new Error('함께 확인해야 할 다른 주문이 있어 개별 자동 종결을 중단합니다.');
  const credentials = db.prepare(`SELECT app_key_encrypted, app_secret_encrypted,
    account_number_encrypted, account_product_code_encrypted FROM kis_credentials WHERE user_id = ?`).get(userId);
  if (!credentials || Object.values(credentials).some((value) => !value)) throw new Error('계좌 설정이 완전하지 않아 대사를 중단합니다.');
  // 토큰 갱신은 허용하되, 조회 도중 인증정보/계좌/서버가 바뀌면 CAS에서 거절한다.
  // 과거 주문에는 계좌 fingerprint가 없으므로 운영자가 별도로 당시 계좌 일치를 확인한다.
  const credentialFingerprint = createHash('sha256').update(JSON.stringify([credentials, env.kisApiBaseUrl])).digest('hex');
  return { order, entry, strategy, credentialFingerprint };
}

function kstDate(date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}
