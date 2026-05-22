import { getDb } from '../db/connection.js';

// ── 전략 ──────────────────────────────────────────────────────────────────

export function createStrategy(userId, input) {
  const result = getDb().prepare(`
    INSERT INTO kr_rank_strategies (
      user_id, morning_budget, lunch_budget,
      morning_target_profit_rate, morning_stop_loss_rate,
      lunch_entry_enabled, lunch_target_profit_rate, lunch_stop_loss_rate,
      morning_liquidate_time, lunch_liquidate_time, auto_budget_enabled
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    userId,
    input.morningBudget,
    input.lunchBudget,
    input.morningTargetProfitRate,
    input.morningStopLossRate,
    input.lunchEntryEnabled ? 1 : 0,
    input.lunchTargetProfitRate,
    input.lunchStopLossRate,
    input.morningLiquidateTime || null,
    input.lunchLiquidateTime || null,
    input.autoBudgetEnabled ? 1 : 0
  );
  return getStrategy(userId, result.lastInsertRowid);
}

export function updateStrategy(userId, id, input) {
  getDb().prepare(`
    UPDATE kr_rank_strategies
    SET morning_budget = ?, lunch_budget = ?,
        morning_target_profit_rate = ?, morning_stop_loss_rate = ?,
        lunch_entry_enabled = ?, lunch_target_profit_rate = ?, lunch_stop_loss_rate = ?,
        morning_liquidate_time = ?, lunch_liquidate_time = ?,
        auto_budget_enabled = ?,
        updated_at = datetime('now')
    WHERE user_id = ? AND id = ?
  `).run(
    input.morningBudget,
    input.lunchBudget,
    input.morningTargetProfitRate,
    input.morningStopLossRate,
    input.lunchEntryEnabled ? 1 : 0,
    input.lunchTargetProfitRate,
    input.lunchStopLossRate,
    input.morningLiquidateTime || null,
    input.lunchLiquidateTime || null,
    input.autoBudgetEnabled ? 1 : 0,
    userId,
    id
  );
  return getStrategy(userId, id);
}

export function listStrategies(userId) {
  return getDb().prepare(`
    SELECT * FROM kr_rank_strategies
    WHERE user_id = ?
    ORDER BY updated_at DESC, id DESC
  `).all(userId).map(toStrategy);
}

export function listRunningStrategies() {
  return getDb().prepare(`
    SELECT * FROM kr_rank_strategies
    WHERE status = 'RUNNING'
    ORDER BY last_evaluated_at IS NOT NULL, last_evaluated_at ASC, id ASC
  `).all().map(toStrategy);
}

export function getStrategy(userId, id) {
  return toStrategy(getDb().prepare(`
    SELECT * FROM kr_rank_strategies WHERE user_id = ? AND id = ?
  `).get(userId, id));
}

export function startStrategy(userId, id) {
  getDb().prepare(`
    UPDATE kr_rank_strategies
    SET status = 'RUNNING', started_at = COALESCE(started_at, datetime('now')),
        stopped_at = NULL, last_error_message = NULL, updated_at = datetime('now')
    WHERE user_id = ? AND id = ?
  `).run(userId, id);
  return getStrategy(userId, id);
}

export function stopStrategy(userId, id) {
  getDb().prepare(`
    UPDATE kr_rank_strategies
    SET status = 'STOPPED', stopped_at = datetime('now'), updated_at = datetime('now')
    WHERE user_id = ? AND id = ?
  `).run(userId, id);
  return getStrategy(userId, id);
}

export function deleteStrategy(userId, id) {
  return getDb().prepare('DELETE FROM kr_rank_strategies WHERE user_id = ? AND id = ?').run(userId, id).changes > 0;
}

export function markEvaluation(userId, id, { decision, errorMessage = null } = {}) {
  getDb().prepare(`
    UPDATE kr_rank_strategies
    SET last_evaluated_at = datetime('now'), last_decision = ?, last_error_message = ?,
        updated_at = datetime('now')
    WHERE user_id = ? AND id = ?
  `).run(decision || null, errorMessage, userId, id);
  return getStrategy(userId, id);
}

// last_decision은 그대로 두고 마지막 평가 시각만 갱신한다.
// 1분 폴링의 idle SKIP tick이 직전 의미 있는 판단(BUY/SELL/HOLD)을 덮어쓰지 않게 한다.
export function touchEvaluation(userId, id) {
  getDb().prepare(`
    UPDATE kr_rank_strategies
    SET last_evaluated_at = datetime('now'), updated_at = datetime('now')
    WHERE user_id = ? AND id = ?
  `).run(userId, id);
  return getStrategy(userId, id);
}

export function setHolding(userId, id, { symbol, symbolName, entryWindow }) {
  getDb().prepare(`
    UPDATE kr_rank_strategies
    SET holding_symbol = ?, holding_symbol_name = ?, holding_entry_window = ?,
        updated_at = datetime('now')
    WHERE user_id = ? AND id = ?
  `).run(symbol, symbolName || null, entryWindow, userId, id);
  return getStrategy(userId, id);
}

export function clearHolding(userId, id) {
  getDb().prepare(`
    UPDATE kr_rank_strategies
    SET holding_symbol = NULL, holding_symbol_name = NULL, holding_entry_window = NULL,
        updated_at = datetime('now')
    WHERE user_id = ? AND id = ?
  `).run(userId, id);
  return getStrategy(userId, id);
}

export function setStrategyError(userId, id, message) {
  getDb().prepare(`
    UPDATE kr_rank_strategies
    SET status = 'ERROR', last_error_message = ?, last_evaluated_at = datetime('now'),
        updated_at = datetime('now')
    WHERE user_id = ? AND id = ?
  `).run(message, userId, id);
  return getStrategy(userId, id);
}

// ── 진입 기록 ─────────────────────────────────────────────────────────────

// UNIQUE(strategy_id, trade_date, entry_window) 위반 시 null 반환 → 이미 진입 완료.
export function createEntry(userId, input) {
  try {
    const result = getDb().prepare(`
      INSERT INTO kr_rank_entries (
        user_id, strategy_id, trade_date, entry_window, status,
        selected_symbol, selected_symbol_name, selected_price,
        selected_fluctuation_rate, ranking_snapshot, bought
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      userId,
      input.strategyId,
      input.tradeDate,
      input.entryWindow,
      input.status,
      input.selectedSymbol || null,
      input.selectedSymbolName || null,
      input.selectedPrice ?? null,
      input.selectedFluctuationRate ?? null,
      input.rankingSnapshot ? JSON.stringify(input.rankingSnapshot) : null,
      input.bought ? 1 : 0
    );
    return getEntryById(result.lastInsertRowid);
  } catch (error) {
    if (String(error.message).includes('UNIQUE')) return null;
    throw error;
  }
}

export function updateEntryOutcome(id, { status, bought }) {
  getDb().prepare(`
    UPDATE kr_rank_entries
    SET status = ?, bought = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(status, bought ? 1 : 0, id);
  return getEntryById(id);
}

// 레거시 NO_CANDIDATE 진입 기록을 SELECTED로 승격(종목 확정)할 때 쓴다.
export function updateEntrySelection(id, input) {
  getDb().prepare(`
    UPDATE kr_rank_entries
    SET status = 'SELECTED',
        selected_symbol = ?, selected_symbol_name = ?,
        selected_price = ?, selected_fluctuation_rate = ?,
        ranking_snapshot = COALESCE(?, ranking_snapshot),
        updated_at = datetime('now')
    WHERE id = ?
  `).run(
    input.selectedSymbol || null,
    input.selectedSymbolName || null,
    input.selectedPrice ?? null,
    input.selectedFluctuationRate ?? null,
    input.rankingSnapshot ? JSON.stringify(input.rankingSnapshot) : null,
    id
  );
  return getEntryById(id);
}

export function getEntry(strategyId, tradeDate, entryWindow) {
  return toEntry(getDb().prepare(`
    SELECT * FROM kr_rank_entries
    WHERE strategy_id = ? AND trade_date = ? AND entry_window = ?
  `).get(strategyId, tradeDate, entryWindow));
}

export function getEntryById(id) {
  return toEntry(getDb().prepare('SELECT * FROM kr_rank_entries WHERE id = ?').get(id));
}

export function listEntries(userId, strategyId, limit = 60) {
  return getDb().prepare(`
    SELECT * FROM kr_rank_entries
    WHERE user_id = ? AND strategy_id = ?
    ORDER BY trade_date DESC, id DESC
    LIMIT ?
  `).all(userId, strategyId, limit).map(toEntry);
}

// ── 주문 ──────────────────────────────────────────────────────────────────

export function createOrder(userId, input) {
  const result = getDb().prepare(`
    INSERT INTO kr_rank_orders (
      user_id, strategy_id, entry_id, symbol, symbol_name, market, currency,
      side, entry_window, sell_reason, quantity, order_price, estimated_amount,
      kis_order_no, kis_original_order_no, status, filled_quantity, remaining_quantity,
      average_filled_price, idempotency_key, decision_reason, live_order_enabled,
      request_payload_masked, response_payload_masked, error_message
    ) VALUES (?, ?, ?, ?, ?, 'KR', 'KRW', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    userId,
    input.strategyId,
    input.entryId ?? null,
    input.symbol,
    input.symbolName || null,
    input.side,
    input.entryWindow,
    input.sellReason || null,
    input.quantity,
    input.orderPrice,
    input.estimatedAmount,
    input.kisOrderNo || null,
    input.kisOriginalOrderNo || null,
    input.status,
    input.filledQuantity ?? null,
    input.remainingQuantity ?? null,
    input.averageFilledPrice ?? null,
    input.idempotencyKey,
    input.decisionReason,
    input.liveOrderEnabled ? 1 : 0,
    input.requestPayloadMasked || null,
    input.responsePayloadMasked || null,
    input.errorMessage || null
  );
  return getOrder(userId, result.lastInsertRowid);
}

export function updateOrder(userId, id, input) {
  getDb().prepare(`
    UPDATE kr_rank_orders
    SET status = ?, kis_order_no = COALESCE(?, kis_order_no),
        kis_original_order_no = COALESCE(?, kis_original_order_no),
        filled_quantity = ?, remaining_quantity = ?, average_filled_price = ?,
        response_payload_masked = COALESCE(?, response_payload_masked),
        error_message = ?, updated_at = datetime('now')
    WHERE user_id = ? AND id = ?
  `).run(
    input.status,
    input.kisOrderNo || null,
    input.kisOriginalOrderNo || null,
    input.filledQuantity ?? null,
    input.remainingQuantity ?? null,
    input.averageFilledPrice ?? null,
    input.responsePayloadMasked || null,
    input.errorMessage || null,
    userId,
    id
  );
  return getOrder(userId, id);
}

export function getOrder(userId, id) {
  return toOrder(getDb().prepare('SELECT * FROM kr_rank_orders WHERE user_id = ? AND id = ?').get(userId, id));
}

export function listOrders(userId, { strategyId = null, limit = 100 } = {}) {
  const params = [userId];
  let where = 'user_id = ?';
  if (strategyId) {
    where += ' AND strategy_id = ?';
    params.push(strategyId);
  }
  params.push(limit);
  return getDb().prepare(`
    SELECT * FROM kr_rank_orders WHERE ${where}
    ORDER BY created_at DESC, id DESC LIMIT ?
  `).all(...params).map(toOrder);
}

export function hasDuplicateOrder(idempotencyKey) {
  return Boolean(getDb().prepare('SELECT 1 FROM kr_rank_orders WHERE idempotency_key = ?').get(idempotencyKey));
}

// 같은 키로 FAILED가 아닌 주문(접수/체결 등)이 있는지 — 있으면 이미 처리된 것으로 본다.
export function hasNonFailedOrder(idempotencyKey) {
  return Boolean(getDb().prepare(
    "SELECT 1 FROM kr_rank_orders WHERE idempotency_key = ? AND status <> 'FAILED' LIMIT 1"
  ).get(idempotencyKey));
}

// 같은 키로 누적된 실패 주문 수 — 재시도 한도 판정에 쓴다.
export function countFailedOrders(idempotencyKey) {
  return getDb().prepare(
    "SELECT COUNT(*) AS c FROM kr_rank_orders WHERE idempotency_key = ? AND status = 'FAILED'"
  ).get(idempotencyKey).c;
}

export function hasBlockingOpenOrder(userId, strategyId) {
  return Boolean(getDb().prepare(`
    SELECT 1 FROM kr_rank_orders
    WHERE user_id = ? AND strategy_id = ?
      AND status IN ('REQUESTED', 'ACCEPTED', 'PARTIALLY_FILLED', 'UNKNOWN')
    LIMIT 1
  `).get(userId, strategyId));
}

// ── 판단 로그 ─────────────────────────────────────────────────────────────

export function createDecisionLog(userId, input) {
  const result = getDb().prepare(`
    INSERT INTO kr_rank_decision_logs (
      user_id, strategy_id, entry_window, decision, sell_reason,
      selected_symbol, selected_symbol_name, current_price, average_price,
      holding_quantity, cash_available, expected_quantity, expected_price,
      expected_amount, ranking_snapshot, live_order_enabled, evaluation_source,
      order_id, reason
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    userId,
    input.strategyId,
    input.entryWindow || null,
    input.decision,
    input.sellReason || null,
    input.selectedSymbol || null,
    input.selectedSymbolName || null,
    input.currentPrice ?? 0,
    input.averagePrice ?? 0,
    input.holdingQuantity ?? 0,
    input.cashAvailable ?? null,
    input.expectedQuantity ?? null,
    input.expectedPrice ?? null,
    input.expectedAmount ?? null,
    input.rankingSnapshot ? JSON.stringify(input.rankingSnapshot) : null,
    input.liveOrderEnabled ? 1 : 0,
    input.evaluationSource || 'SCHEDULED',
    input.orderId ?? null,
    input.reason
  );
  return toDecisionLog(getDb().prepare('SELECT * FROM kr_rank_decision_logs WHERE id = ?').get(result.lastInsertRowid));
}

export function attachOrderIdToDecisionLog(decisionLogId, orderId) {
  if (!decisionLogId || !orderId) return;
  getDb().prepare('UPDATE kr_rank_decision_logs SET order_id = ? WHERE id = ?').run(orderId, decisionLogId);
}

export function listDecisionLogs(userId, strategyId, limit = 100) {
  return getDb().prepare(`
    SELECT * FROM kr_rank_decision_logs
    WHERE user_id = ? AND strategy_id = ?
    ORDER BY created_at DESC, id DESC LIMIT ?
  `).all(userId, strategyId, limit).map(toDecisionLog);
}

// ── 락 ────────────────────────────────────────────────────────────────────

export function acquireLock(userId, strategyId, lockKey, lockedUntil) {
  const db = getDb();
  db.prepare(`
    DELETE FROM kr_rank_locks WHERE strategy_id = ? AND lock_key = ? AND locked_until <= ?
  `).run(strategyId, lockKey, new Date().toISOString());
  try {
    db.prepare(`
      INSERT INTO kr_rank_locks (user_id, strategy_id, lock_key, locked_until)
      VALUES (?, ?, ?, ?)
    `).run(userId, strategyId, lockKey, lockedUntil);
    return true;
  } catch (error) {
    if (String(error.message).includes('UNIQUE')) return false;
    throw error;
  }
}

export function releaseLock(strategyId, lockKey) {
  getDb().prepare('DELETE FROM kr_rank_locks WHERE strategy_id = ? AND lock_key = ?').run(strategyId, lockKey);
}

// ── 변환 ──────────────────────────────────────────────────────────────────

function toStrategy(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    strategyType: 'KR_RANK_MOMENTUM',
    status: row.status,
    morningBudget: row.morning_budget,
    lunchBudget: row.lunch_budget,
    morningTargetProfitRate: row.morning_target_profit_rate,
    morningStopLossRate: row.morning_stop_loss_rate,
    lunchEntryEnabled: row.lunch_entry_enabled === 1,
    lunchTargetProfitRate: row.lunch_target_profit_rate,
    lunchStopLossRate: row.lunch_stop_loss_rate,
    morningLiquidateTime: row.morning_liquidate_time || null,
    lunchLiquidateTime: row.lunch_liquidate_time || null,
    autoBudgetEnabled: row.auto_budget_enabled === 1,
    holdingSymbol: row.holding_symbol,
    holdingSymbolName: row.holding_symbol_name,
    holdingEntryWindow: row.holding_entry_window,
    startedAt: row.started_at,
    stoppedAt: row.stopped_at,
    lastEvaluatedAt: row.last_evaluated_at,
    lastDecision: row.last_decision,
    lastErrorMessage: row.last_error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toEntry(row) {
  if (!row) return null;
  return {
    id: row.id,
    strategyId: row.strategy_id,
    tradeDate: row.trade_date,
    entryWindow: row.entry_window,
    status: row.status,
    selectedSymbol: row.selected_symbol,
    selectedSymbolName: row.selected_symbol_name,
    selectedPrice: row.selected_price,
    selectedFluctuationRate: row.selected_fluctuation_rate,
    rankingSnapshot: parseJson(row.ranking_snapshot),
    bought: row.bought === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toOrder(row) {
  if (!row) return null;
  return {
    id: row.id,
    strategyId: row.strategy_id,
    entryId: row.entry_id,
    symbol: row.symbol,
    symbolName: row.symbol_name,
    market: row.market,
    currency: row.currency,
    side: row.side,
    entryWindow: row.entry_window,
    sellReason: row.sell_reason,
    quantity: row.quantity,
    orderPrice: row.order_price,
    estimatedAmount: row.estimated_amount,
    kisOrderNo: row.kis_order_no,
    kisOriginalOrderNo: row.kis_original_order_no,
    status: row.status,
    filledQuantity: row.filled_quantity,
    remainingQuantity: row.remaining_quantity,
    averageFilledPrice: row.average_filled_price,
    idempotencyKey: row.idempotency_key,
    decisionReason: row.decision_reason,
    liveOrderEnabled: row.live_order_enabled === 1,
    requestPayloadMasked: row.request_payload_masked,
    responsePayloadMasked: row.response_payload_masked,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toDecisionLog(row) {
  if (!row) return null;
  return {
    id: row.id,
    strategyId: row.strategy_id,
    entryWindow: row.entry_window,
    decision: row.decision,
    sellReason: row.sell_reason,
    selectedSymbol: row.selected_symbol,
    selectedSymbolName: row.selected_symbol_name,
    currentPrice: row.current_price,
    averagePrice: row.average_price,
    holdingQuantity: row.holding_quantity,
    cashAvailable: row.cash_available,
    expectedQuantity: row.expected_quantity,
    expectedPrice: row.expected_price,
    expectedAmount: row.expected_amount,
    rankingSnapshot: parseJson(row.ranking_snapshot),
    liveOrderEnabled: row.live_order_enabled === 1,
    evaluationSource: row.evaluation_source,
    orderId: row.order_id,
    reason: row.reason,
    createdAt: row.created_at
  };
}

function parseJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
