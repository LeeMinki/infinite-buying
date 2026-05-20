import { getDb } from '../db/connection.js';

export function createStrategy(userId, input) {
  const result = getDb().prepare(`
    INSERT INTO us_rank_strategies (
      user_id, auto_budget_enabled, fixed_buy_usd_amount, target_profit_rate,
      stop_loss_rate, force_close_kst, exchange, currency, cycle_target_profit_rate
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'USD', ?)
  `).run(
    userId,
    input.autoBudgetEnabled ? 1 : 0,
    input.fixedBuyUsdAmount,
    input.targetProfitRate,
    input.stopLossRate,
    input.forceCloseKst,
    input.exchange,
    input.cycleTargetProfitRate ?? null
  );
  return getStrategy(userId, result.lastInsertRowid);
}

export function updateStrategy(userId, id, input) {
  getDb().prepare(`
    UPDATE us_rank_strategies
    SET auto_budget_enabled = ?, fixed_buy_usd_amount = ?, target_profit_rate = ?,
        stop_loss_rate = ?, force_close_kst = ?, exchange = ?,
        cycle_target_profit_rate = ?, updated_at = datetime('now')
    WHERE user_id = ? AND id = ?
  `).run(
    input.autoBudgetEnabled ? 1 : 0,
    input.fixedBuyUsdAmount,
    input.targetProfitRate,
    input.stopLossRate,
    input.forceCloseKst,
    input.exchange,
    input.cycleTargetProfitRate ?? null,
    userId,
    id
  );
  return getStrategy(userId, id);
}

export function setCycleBaseline(userId, id, baselineUsd) {
  getDb().prepare(`
    UPDATE us_rank_strategies
    SET cycle_baseline_usd = ?, updated_at = datetime('now')
    WHERE user_id = ? AND id = ?
  `).run(baselineUsd, userId, id);
  return getStrategy(userId, id);
}

export function markCycleCompleted(userId, id) {
  getDb().prepare(`
    UPDATE us_rank_strategies
    SET cycle_completed = 1, cycle_completed_at = datetime('now'),
        status = 'STOPPED', stopped_at = datetime('now'),
        updated_at = datetime('now')
    WHERE user_id = ? AND id = ?
  `).run(userId, id);
  return getStrategy(userId, id);
}

export function listStrategies(userId) {
  return getDb().prepare(`
    SELECT * FROM us_rank_strategies
    WHERE user_id = ?
    ORDER BY updated_at DESC, id DESC
  `).all(userId).map(toStrategy);
}

export function listRunningStrategies() {
  return getDb().prepare(`
    SELECT * FROM us_rank_strategies
    WHERE status = 'RUNNING'
    ORDER BY last_evaluated_at IS NOT NULL, last_evaluated_at ASC, id ASC
  `).all().map(toStrategy);
}

export function getStrategy(userId, id) {
  return toStrategy(getDb().prepare('SELECT * FROM us_rank_strategies WHERE user_id = ? AND id = ?').get(userId, id));
}

export function startStrategy(userId, id) {
  getDb().prepare(`
    UPDATE us_rank_strategies
    SET status = 'RUNNING', started_at = COALESCE(started_at, datetime('now')),
        stopped_at = NULL, last_error_message = NULL, updated_at = datetime('now')
    WHERE user_id = ? AND id = ?
  `).run(userId, id);
  return getStrategy(userId, id);
}

export function stopStrategy(userId, id) {
  getDb().prepare(`
    UPDATE us_rank_strategies
    SET status = 'STOPPED', stopped_at = datetime('now'), updated_at = datetime('now')
    WHERE user_id = ? AND id = ?
  `).run(userId, id);
  return getStrategy(userId, id);
}

export function deleteStrategy(userId, id) {
  return getDb().prepare('DELETE FROM us_rank_strategies WHERE user_id = ? AND id = ?').run(userId, id).changes > 0;
}

export function markEvaluation(userId, id, { decision, errorMessage = null } = {}) {
  getDb().prepare(`
    UPDATE us_rank_strategies
    SET last_evaluated_at = datetime('now'), last_decision = ?, last_error_message = ?,
        updated_at = datetime('now')
    WHERE user_id = ? AND id = ?
  `).run(decision || null, errorMessage, userId, id);
  return getStrategy(userId, id);
}

export function touchEvaluation(userId, id) {
  getDb().prepare(`
    UPDATE us_rank_strategies
    SET last_evaluated_at = datetime('now'), updated_at = datetime('now')
    WHERE user_id = ? AND id = ?
  `).run(userId, id);
  return getStrategy(userId, id);
}

export function setHolding(userId, id, { symbol, symbolName, exchange, quantity, averagePrice }) {
  getDb().prepare(`
    UPDATE us_rank_strategies
    SET holding_symbol = ?, holding_symbol_name = ?, holding_exchange = ?,
        holding_quantity = ?, holding_average_price = ?, updated_at = datetime('now')
    WHERE user_id = ? AND id = ?
  `).run(symbol, symbolName || null, exchange || null, quantity || 0, averagePrice || 0, userId, id);
  return getStrategy(userId, id);
}

export function clearHolding(userId, id) {
  getDb().prepare(`
    UPDATE us_rank_strategies
    SET holding_symbol = NULL, holding_symbol_name = NULL, holding_exchange = NULL,
        holding_quantity = 0, holding_average_price = 0, updated_at = datetime('now')
    WHERE user_id = ? AND id = ?
  `).run(userId, id);
  return getStrategy(userId, id);
}

export function setDayLockedOut(userId, id, { tradeDate, reason }) {
  getDb().prepare(`
    UPDATE us_rank_strategies
    SET day_locked_out = 1, day_locked_out_at = ?, day_lock_reason = ?,
        updated_at = datetime('now')
    WHERE user_id = ? AND id = ?
  `).run(tradeDate, reason, userId, id);
  return getStrategy(userId, id);
}

export function clearDayLockedOutIfStale(userId, id, tradeDate) {
  getDb().prepare(`
    UPDATE us_rank_strategies
    SET day_locked_out = 0, day_locked_out_at = NULL, day_lock_reason = NULL,
        updated_at = datetime('now')
    WHERE user_id = ? AND id = ?
      AND day_locked_out = 1
      AND (day_locked_out_at IS NULL OR day_locked_out_at <> ?)
  `).run(userId, id, tradeDate);
  return getStrategy(userId, id);
}

export function setStrategyError(userId, id, message) {
  getDb().prepare(`
    UPDATE us_rank_strategies
    SET status = 'ERROR', last_error_message = ?, last_evaluated_at = datetime('now'),
        updated_at = datetime('now')
    WHERE user_id = ? AND id = ?
  `).run(message, userId, id);
  return getStrategy(userId, id);
}

export function nextTradeSeq(strategyId, tradeDate) {
  const row = getDb().prepare(`
    SELECT COALESCE(MAX(trade_seq), 0) + 1 AS next_seq
    FROM us_rank_trades
    WHERE strategy_id = ? AND trade_date = ?
  `).get(strategyId, tradeDate);
  return Number(row?.next_seq || 1);
}

export function createTrade(userId, input) {
  const result = getDb().prepare(`
    INSERT INTO us_rank_trades (
      user_id, strategy_id, trade_date, trade_seq, symbol, symbol_name, exchange,
      selected_price, selected_fluctuation_rate, ranking_snapshot, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    userId,
    input.strategyId,
    input.tradeDate,
    input.tradeSeq,
    input.symbol || null,
    input.symbolName || null,
    input.exchange || null,
    input.selectedPrice ?? null,
    input.selectedFluctuationRate ?? null,
    input.rankingSnapshot ? JSON.stringify(input.rankingSnapshot) : null,
    input.status || 'SELECTED'
  );
  return getTradeById(result.lastInsertRowid);
}

export function updateTradeOutcome(id, input) {
  const current = getTradeById(id);
  if (!current) return null;
  getDb().prepare(`
    UPDATE us_rank_trades
    SET status = COALESCE(?, status),
        entry_price = COALESCE(?, entry_price),
        entry_quantity = COALESCE(?, entry_quantity),
        exit_price = COALESCE(?, exit_price),
        exit_reason = COALESCE(?, exit_reason),
        profit_rate = COALESCE(?, profit_rate),
        error_message = COALESCE(?, error_message),
        closed_at = CASE WHEN ? = 1 THEN datetime('now') ELSE closed_at END,
        updated_at = datetime('now')
    WHERE id = ?
  `).run(
    input.status || null,
    input.entryPrice ?? null,
    input.entryQuantity ?? null,
    input.exitPrice ?? null,
    input.exitReason || null,
    input.profitRate ?? null,
    input.errorMessage || null,
    input.close ? 1 : 0,
    id
  );
  return getTradeById(id);
}

export function getOpenTrade(strategyId) {
  return toTrade(getDb().prepare(`
    SELECT * FROM us_rank_trades
    WHERE strategy_id = ? AND status IN ('SELECTED', 'BOUGHT')
    ORDER BY trade_date DESC, trade_seq DESC, id DESC
    LIMIT 1
  `).get(strategyId));
}

export function getTradeById(id) {
  return toTrade(getDb().prepare('SELECT * FROM us_rank_trades WHERE id = ?').get(id));
}

export function listTrades(userId, { strategyId, limit = 100 } = {}) {
  const params = [userId];
  let where = 'user_id = ?';
  if (strategyId) {
    where += ' AND strategy_id = ?';
    params.push(strategyId);
  }
  params.push(limit);
  return getDb().prepare(`
    SELECT * FROM us_rank_trades
    WHERE ${where}
    ORDER BY trade_date DESC, trade_seq DESC, id DESC
    LIMIT ?
  `).all(...params).map(toTrade);
}

export function createOrder(userId, input) {
  const result = getDb().prepare(`
    INSERT INTO us_rank_orders (
      user_id, strategy_id, trade_id, symbol, symbol_name, market, currency, exchange,
      side, sell_reason, quantity, order_price, estimated_amount, kis_order_no,
      kis_original_order_no, status, filled_quantity, remaining_quantity,
      average_filled_price, idempotency_key, decision_reason, live_order_enabled,
      request_payload_masked, response_payload_masked, error_message
    ) VALUES (?, ?, ?, ?, ?, 'US', 'USD', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    userId,
    input.strategyId,
    input.tradeId ?? null,
    input.symbol,
    input.symbolName || null,
    input.exchange || null,
    input.side,
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
    UPDATE us_rank_orders
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
  return toOrder(getDb().prepare('SELECT * FROM us_rank_orders WHERE user_id = ? AND id = ?').get(userId, id));
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
    SELECT * FROM us_rank_orders
    WHERE ${where}
    ORDER BY created_at DESC, id DESC
    LIMIT ?
  `).all(...params).map(toOrder);
}

export function hasDuplicateOrder(idempotencyKey) {
  return Boolean(getDb().prepare('SELECT 1 FROM us_rank_orders WHERE idempotency_key = ? LIMIT 1').get(idempotencyKey));
}

export function hasNonFailedOrder(idempotencyKey) {
  return Boolean(getDb().prepare(
    "SELECT 1 FROM us_rank_orders WHERE idempotency_key = ? AND status <> 'FAILED' LIMIT 1"
  ).get(idempotencyKey));
}

export function countFailedOrders(idempotencyKey) {
  return getDb().prepare(
    "SELECT COUNT(*) AS c FROM us_rank_orders WHERE idempotency_key = ? AND status = 'FAILED'"
  ).get(idempotencyKey).c;
}

export function hasBlockingOpenOrder(userId, strategyId) {
  return Boolean(getDb().prepare(`
    SELECT 1 FROM us_rank_orders
    WHERE user_id = ? AND strategy_id = ?
      AND status IN ('REQUESTED', 'ACCEPTED', 'PARTIALLY_FILLED', 'UNKNOWN')
    LIMIT 1
  `).get(userId, strategyId));
}

export function createDecisionLog(userId, input) {
  const result = getDb().prepare(`
    INSERT INTO us_rank_decision_logs (
      user_id, strategy_id, trade_id, trade_date, trade_seq, decision, sell_reason,
      selected_symbol, selected_symbol_name, selected_exchange, current_price,
      average_price, holding_quantity, cash_available, expected_quantity,
      expected_price, expected_amount, profit_rate, ranking_snapshot,
      live_order_enabled, evaluation_source, order_id, reason
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    userId,
    input.strategyId,
    input.tradeId ?? null,
    input.tradeDate || null,
    input.tradeSeq ?? null,
    input.decision,
    input.sellReason || null,
    input.selectedSymbol || null,
    input.selectedSymbolName || null,
    input.selectedExchange || null,
    input.currentPrice ?? 0,
    input.averagePrice ?? 0,
    input.holdingQuantity ?? 0,
    input.cashAvailable ?? null,
    input.expectedQuantity ?? null,
    input.expectedPrice ?? null,
    input.expectedAmount ?? null,
    input.profitRate ?? null,
    input.rankingSnapshot ? JSON.stringify(input.rankingSnapshot) : null,
    input.liveOrderEnabled ? 1 : 0,
    input.evaluationSource || 'SCHEDULED',
    input.orderId ?? null,
    input.reason
  );
  return toDecisionLog(getDb().prepare('SELECT * FROM us_rank_decision_logs WHERE id = ?').get(result.lastInsertRowid));
}

export function attachOrderIdToDecisionLog(decisionLogId, orderId) {
  if (!decisionLogId || !orderId) return;
  getDb().prepare('UPDATE us_rank_decision_logs SET order_id = ? WHERE id = ?').run(orderId, decisionLogId);
}

export function listDecisionLogs(userId, strategyId, limit = 100) {
  return getDb().prepare(`
    SELECT * FROM us_rank_decision_logs
    WHERE user_id = ? AND strategy_id = ?
    ORDER BY created_at DESC, id DESC
    LIMIT ?
  `).all(userId, strategyId, limit).map(toDecisionLog);
}

export function acquireLock(userId, strategyId, lockKey, lockedUntil) {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare('DELETE FROM us_rank_locks WHERE strategy_id = ? AND lock_key = ? AND locked_until <= ?')
    .run(strategyId, lockKey, now);
  try {
    db.prepare('INSERT INTO us_rank_locks (user_id, strategy_id, lock_key, locked_until) VALUES (?, ?, ?, ?)')
      .run(userId, strategyId, lockKey, lockedUntil);
    return true;
  } catch (error) {
    if (String(error.message).includes('UNIQUE')) return false;
    throw error;
  }
}

export function releaseLock(strategyId, lockKey) {
  getDb().prepare('DELETE FROM us_rank_locks WHERE strategy_id = ? AND lock_key = ?').run(strategyId, lockKey);
}

function toStrategy(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    status: row.status,
    autoBudgetEnabled: row.auto_budget_enabled === 1,
    fixedBuyUsdAmount: row.fixed_buy_usd_amount,
    targetProfitRate: row.target_profit_rate,
    stopLossRate: row.stop_loss_rate,
    forceCloseKst: row.force_close_kst,
    cycleTargetProfitRate: row.cycle_target_profit_rate,
    cycleBaselineUsd: row.cycle_baseline_usd,
    cycleCompleted: row.cycle_completed === 1,
    cycleCompletedAt: row.cycle_completed_at,
    exchange: row.exchange,
    currency: row.currency,
    holdingSymbol: row.holding_symbol,
    holdingSymbolName: row.holding_symbol_name,
    holdingExchange: row.holding_exchange,
    holdingQuantity: row.holding_quantity,
    holdingAveragePrice: row.holding_average_price,
    dayLockedOut: row.day_locked_out === 1,
    dayLockedOutAt: row.day_locked_out_at,
    dayLockReason: row.day_lock_reason,
    startedAt: row.started_at,
    stoppedAt: row.stopped_at,
    lastEvaluatedAt: row.last_evaluated_at,
    lastDecision: row.last_decision,
    lastErrorMessage: row.last_error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toTrade(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    strategyId: row.strategy_id,
    tradeDate: row.trade_date,
    tradeSeq: row.trade_seq,
    symbol: row.symbol,
    symbolName: row.symbol_name,
    exchange: row.exchange,
    selectedPrice: row.selected_price,
    selectedFluctuationRate: row.selected_fluctuation_rate,
    rankingSnapshot: parseJson(row.ranking_snapshot),
    entryPrice: row.entry_price,
    entryQuantity: row.entry_quantity,
    exitPrice: row.exit_price,
    exitReason: row.exit_reason,
    profitRate: row.profit_rate,
    status: row.status,
    errorMessage: row.error_message,
    openedAt: row.opened_at,
    closedAt: row.closed_at,
    updatedAt: row.updated_at
  };
}

function toOrder(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    strategyId: row.strategy_id,
    tradeId: row.trade_id,
    symbol: row.symbol,
    symbolName: row.symbol_name,
    market: row.market,
    currency: row.currency,
    exchange: row.exchange,
    side: row.side,
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
    userId: row.user_id,
    strategyId: row.strategy_id,
    tradeId: row.trade_id,
    tradeDate: row.trade_date,
    tradeSeq: row.trade_seq,
    decision: row.decision,
    sellReason: row.sell_reason,
    selectedSymbol: row.selected_symbol,
    selectedSymbolName: row.selected_symbol_name,
    selectedExchange: row.selected_exchange,
    currentPrice: row.current_price,
    averagePrice: row.average_price,
    holdingQuantity: row.holding_quantity,
    cashAvailable: row.cash_available,
    expectedQuantity: row.expected_quantity,
    expectedPrice: row.expected_price,
    expectedAmount: row.expected_amount,
    profitRate: row.profit_rate,
    rankingSnapshot: parseJson(row.ranking_snapshot),
    liveOrderEnabled: row.live_order_enabled === 1,
    evaluationSource: row.evaluation_source,
    orderId: row.order_id,
    reason: row.reason,
    createdAt: row.created_at
  };
}

function parseJson(value) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
