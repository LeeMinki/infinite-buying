import { getDb } from '../db/connection.js';
import { resolveBigBuyPremiumRate } from '../services/buyAlgorithm.js';

export function getSettings(userId) {
  const row = getDb().prepare('SELECT * FROM user_trading_settings WHERE user_id = ?').get(userId);
  if (row) return toSettings(row);
  getDb().prepare('INSERT INTO user_trading_settings (user_id) VALUES (?)').run(userId);
  return toSettings(getDb().prepare('SELECT * FROM user_trading_settings WHERE user_id = ?').get(userId));
}

export function updateLiveOrderSetting(userId, enabled) {
  const previous = getSettings(userId);
  const nextValue = enabled ? 1 : 0;
  const db = getDb();
  db.transaction(() => {
    db.prepare(`
      UPDATE user_trading_settings
      SET live_order_enabled = ?, live_order_enabled_updated_at = datetime('now'), updated_at = datetime('now')
      WHERE user_id = ?
    `).run(nextValue, userId);
    if ((previous.liveOrderEnabled ? 1 : 0) !== nextValue) {
      db.prepare(`
        INSERT INTO user_trading_setting_histories (
          user_id, previous_live_order_enabled, new_live_order_enabled
        ) VALUES (?, ?, ?)
      `).run(userId, previous.liveOrderEnabled ? 1 : 0, nextValue);
    }
  })();
  return getSettings(userId);
}

export function listSettingHistories(userId, limit = 20) {
  return getDb().prepare(`
    SELECT * FROM user_trading_setting_histories
    WHERE user_id = ?
    ORDER BY changed_at DESC, id DESC
    LIMIT ?
  `).all(userId, limit).map(toSettingHistory);
}

export function createStrategy(userId, input) {
  // max_order_amount / max_daily_order_amount 컬럼은 호환을 위해 남기되 0을 넣어 둔다.
  // SafetyGuard 가 더 이상 이 값을 검사하지 않는다.
  const result = getDb().prepare(`
    INSERT INTO auto_trading_strategies (
      user_id, symbol, symbol_name, market, currency, exchange, total_budget, split_count,
      buy_amount_per_round, target_profit_rate, big_buy_premium_rate, cycle_budget,
      current_round, max_order_amount, max_daily_order_amount
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0)
  `).run(
    userId,
    input.symbol,
    input.symbolName || null,
    input.market,
    input.currency,
    input.exchange || null,
    input.totalBudget,
    input.splitCount,
    input.buyAmountPerRound,
    input.targetProfitRate,
    input.bigBuyPremiumRate,
    input.totalBudget
  );
  return getStrategy(userId, result.lastInsertRowid);
}

export function listStrategies(userId) {
  return getDb().prepare(`
    SELECT * FROM auto_trading_strategies
    WHERE user_id = ?
    ORDER BY updated_at DESC, id DESC
  `).all(userId).map(toStrategy);
}

export function listRunningStrategies() {
  return getDb().prepare(`
    SELECT * FROM auto_trading_strategies
    WHERE status = 'RUNNING'
    ORDER BY last_evaluated_at IS NOT NULL, last_evaluated_at ASC, id ASC
  `).all().map(toStrategy);
}

export function getStrategy(userId, id) {
  const row = getDb().prepare(`
    SELECT * FROM auto_trading_strategies
    WHERE user_id = ? AND id = ?
  `).get(userId, id);
  return toStrategy(row);
}

export function updateStrategy(userId, id, input) {
  getDb().prepare(`
    UPDATE auto_trading_strategies
    SET symbol = ?, symbol_name = ?, market = ?, currency = ?, exchange = ?,
        total_budget = ?, split_count = ?, buy_amount_per_round = ?,
        target_profit_rate = ?, big_buy_premium_rate = ?,
        updated_at = datetime('now')
    WHERE user_id = ? AND id = ?
  `).run(
    input.symbol,
    input.symbolName || null,
    input.market,
    input.currency,
    input.exchange || null,
    input.totalBudget,
    input.splitCount,
    input.buyAmountPerRound,
    input.targetProfitRate,
    input.bigBuyPremiumRate,
    userId,
    id
  );
  return getStrategy(userId, id);
}

export function startStrategy(userId, id) {
  getDb().prepare(`
    UPDATE auto_trading_strategies
    SET status = 'RUNNING', started_at = COALESCE(started_at, datetime('now')),
        stopped_at = NULL, last_error_message = NULL, updated_at = datetime('now')
    WHERE user_id = ? AND id = ?
  `).run(userId, id);
  return getStrategy(userId, id);
}

export function stopStrategy(userId, id) {
  getDb().prepare(`
    UPDATE auto_trading_strategies
    SET status = 'STOPPED', stopped_at = datetime('now'), updated_at = datetime('now')
    WHERE user_id = ? AND id = ?
  `).run(userId, id);
  return getStrategy(userId, id);
}

export function markStrategyEvaluation(userId, id, {
  decision,
  errorMessage = null,
  incrementRound = false,
  resetCycle = false,
  splitCount = null,
  ordered = false,
  pendingAvgBudget = null,
  pendingBigBudget = null,
  cycleBudget = null
} = {}) {
  // resetCycle: 매도로 사이클이 재시작되면 회차를 0으로 되돌린다.
  // 그 외에는 회차를 +incrementRound 하되 분할 회차 상한을 넘지 않도록 자른다.
  getDb().prepare(`
    UPDATE auto_trading_strategies
    SET last_evaluated_at = datetime('now'),
        last_decision = ?,
        last_error_message = ?,
        current_round = CASE
          WHEN ? = 1 THEN 0
          ELSE MIN(current_round + ?, COALESCE(?, current_round + ?))
        END,
        pending_avg_budget = COALESCE(?, pending_avg_budget),
        pending_big_budget = COALESCE(?, pending_big_budget),
        cycle_budget = COALESCE(?, cycle_budget),
        last_order_at = CASE WHEN ? = 1 THEN datetime('now') ELSE last_order_at END,
        updated_at = datetime('now')
    WHERE user_id = ? AND id = ?
  `).run(
    decision || null,
    errorMessage,
    resetCycle ? 1 : 0,
    incrementRound ? 1 : 0,
    splitCount,
    incrementRound ? 1 : 0,
    pendingAvgBudget,
    pendingBigBudget,
    cycleBudget,
    ordered ? 1 : 0,
    userId,
    id
  );
  return getStrategy(userId, id);
}

export function setStrategyError(userId, id, message) {
  getDb().prepare(`
    UPDATE auto_trading_strategies
    SET status = 'ERROR', last_error_message = ?, last_evaluated_at = datetime('now'), updated_at = datetime('now')
    WHERE user_id = ? AND id = ?
  `).run(message, userId, id);
  return getStrategy(userId, id);
}

export function deleteStrategy(userId, id) {
  return getDb().prepare('DELETE FROM auto_trading_strategies WHERE user_id = ? AND id = ?').run(userId, id).changes > 0;
}

export function createPositionSnapshot(userId, input) {
  const result = getDb().prepare(`
    INSERT INTO auto_trading_position_snapshots (
      user_id, strategy_id, symbol, market, currency, quantity, average_price,
      current_price, evaluation_amount, unrealized_profit, unrealized_profit_rate,
      cash_available, source, decision
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    userId,
    input.strategyId,
    input.symbol,
    input.market,
    input.currency,
    input.quantity,
    input.averagePrice,
    input.currentPrice,
    input.evaluationAmount,
    input.unrealizedProfit,
    input.unrealizedProfitRate,
    input.cashAvailable ?? null,
    input.source || 'KIS',
    input.decision ?? null
  );
  return toPositionSnapshot(getDb().prepare('SELECT * FROM auto_trading_position_snapshots WHERE id = ?').get(result.lastInsertRowid));
}

export function listPositionSnapshots(userId, strategyId, limit = 50) {
  return getDb().prepare(`
    SELECT * FROM auto_trading_position_snapshots
    WHERE user_id = ? AND strategy_id = ?
    ORDER BY captured_at DESC, id DESC
    LIMIT ?
  `).all(userId, strategyId, limit).map(toPositionSnapshot);
}

export function latestPositionSnapshots(userId, limit = 10) {
  return getDb().prepare(`
    SELECT * FROM auto_trading_position_snapshots
    WHERE user_id = ?
    ORDER BY captured_at DESC, id DESC
    LIMIT ?
  `).all(userId, limit).map(toPositionSnapshot);
}

export function createDecisionLog(userId, input) {
  const result = getDb().prepare(`
    INSERT INTO auto_trading_decision_logs (
      user_id, strategy_id, symbol, market, currency, current_price, average_price,
      holding_quantity, cash_available, current_round, decision, expected_quantity,
      expected_order_price, expected_amount, live_order_enabled, reason,
      target_sell_price, distance_to_target_rate, open_order_count, evaluation_source, order_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    userId,
    input.strategyId,
    input.symbol,
    input.market,
    input.currency,
    input.currentPrice,
    input.averagePrice,
    input.holdingQuantity,
    input.cashAvailable ?? null,
    input.currentRound,
    input.decision,
    input.expectedQuantity ?? null,
    input.expectedOrderPrice ?? null,
    input.expectedAmount ?? null,
    input.liveOrderEnabled ? 1 : 0,
    input.reason,
    input.targetSellPrice ?? null,
    input.distanceToTargetRate ?? null,
    input.openOrderCount ?? 0,
    input.evaluationSource || 'SCHEDULED',
    input.orderId ?? null
  );
  return toDecisionLog(getDb().prepare('SELECT * FROM auto_trading_decision_logs WHERE id = ?').get(result.lastInsertRowid));
}

export function attachOrderIdToDecisionLog(decisionLogId, orderId) {
  if (!decisionLogId || !orderId) return;
  getDb()
    .prepare('UPDATE auto_trading_decision_logs SET order_id = ? WHERE id = ?')
    .run(orderId, decisionLogId);
}

export function listDecisionLogs(userId, strategyId, limit = 100) {
  return getDb().prepare(`
    SELECT * FROM auto_trading_decision_logs
    WHERE user_id = ? AND strategy_id = ?
    ORDER BY created_at DESC, id DESC
    LIMIT ?
  `).all(userId, strategyId, limit).map(toDecisionLog);
}

export function recentDecisionLogs(userId, limit = 20) {
  return getDb().prepare(`
    SELECT * FROM auto_trading_decision_logs
    WHERE user_id = ?
    ORDER BY created_at DESC, id DESC
    LIMIT ?
  `).all(userId, limit).map(toDecisionLog);
}

export function createOrder(userId, input) {
  const result = getDb().prepare(`
    INSERT INTO auto_trading_orders (
      user_id, strategy_id, symbol, market, currency, exchange, side, quantity, order_price,
      estimated_amount, kis_order_no, kis_original_order_no, status, filled_quantity,
      remaining_quantity, average_filled_price, idempotency_key, decision_reason,
      live_order_enabled, request_payload_masked, response_payload_masked, error_message,
      half, decision_log_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    userId,
    input.strategyId,
    input.symbol,
    input.market,
    input.currency,
    input.exchange || null,
    input.side,
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
    input.errorMessage || null,
    input.half || null,
    input.decisionLogId || null
  );
  return getOrder(userId, result.lastInsertRowid);
}

export function updateOrder(userId, id, input) {
  getDb().prepare(`
    UPDATE auto_trading_orders
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
  const row = getDb().prepare(`
    SELECT * FROM auto_trading_orders
    WHERE user_id = ? AND id = ?
  `).get(userId, id);
  return toOrder(row);
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
    SELECT * FROM auto_trading_orders
    WHERE ${where}
    ORDER BY created_at DESC, id DESC
    LIMIT ?
  `).all(...params).map(toOrder);
}

// 우리 시스템이 KIS에 보낸 주문 중 아직 미체결로 남아 있는 것들 (취소 대상)
export function listOpenOwnedOrders(userId, strategyId) {
  return getDb().prepare(`
    SELECT * FROM auto_trading_orders
    WHERE user_id = ? AND strategy_id = ?
      AND status IN ('REQUESTED', 'ACCEPTED', 'PARTIALLY_FILLED', 'UNKNOWN')
      AND kis_order_no IS NOT NULL AND kis_order_no <> ''
    ORDER BY id DESC
  `).all(userId, strategyId).map(toOrder);
}

export function markOrderCanceled(userId, orderId, { reason = '', responsePayloadMasked = null } = {}) {
  getDb().prepare(`
    UPDATE auto_trading_orders
    SET status = 'CANCELED',
        error_message = COALESCE(?, error_message),
        response_payload_masked = COALESCE(?, response_payload_masked),
        updated_at = datetime('now')
    WHERE user_id = ? AND id = ?
  `).run(reason || null, responsePayloadMasked, userId, orderId);
  return getOrder(userId, orderId);
}

export function hasBlockingOpenOrder(userId, strategyId) {
  const row = getDb().prepare(`
    SELECT 1 FROM auto_trading_orders
    WHERE user_id = ? AND strategy_id = ?
      AND status IN ('REQUESTED', 'ACCEPTED', 'PARTIALLY_FILLED', 'UNKNOWN')
    LIMIT 1
  `).get(userId, strategyId);
  return Boolean(row);
}

export function hasDuplicateOrder(idempotencyKey) {
  return Boolean(getDb().prepare('SELECT 1 FROM auto_trading_orders WHERE idempotency_key = ?').get(idempotencyKey));
}

// 같은 거래일(tradeDate, UTC 기준 — 한 매매 세션은 같은 UTC 날짜에 들어온다)에
// 이미 매수(BUY) 주문 기록이 있는지. 상태와 무관하게(FAILED 포함) 한 건이라도 있으면 true.
// 하루 1회 매수 원칙: 오늘 매수했으면 같은 날 추가 매수 주문을 만들지 않는다.
export function hasBuyOrderToday(userId, strategyId, tradeDate) {
  const row = getDb().prepare(`
    SELECT 1 FROM auto_trading_orders
    WHERE user_id = ? AND strategy_id = ? AND side = 'BUY'
      AND date(created_at) = date(?)
    LIMIT 1
  `).get(userId, strategyId, tradeDate);
  return Boolean(row);
}

export function getDailyUsedAmount(userId, strategyId, tradeDate) {
  const row = getDb().prepare(`
    SELECT used_amount FROM daily_order_limit_usages
    WHERE user_id = ? AND strategy_id = ? AND trade_date = ?
  `).get(userId, strategyId, tradeDate);
  return Number(row?.used_amount || 0);
}

export function addDailyUsedAmount(userId, strategyId, { tradeDate, market, currency, amount }) {
  getDb().prepare(`
    INSERT INTO daily_order_limit_usages (
      user_id, strategy_id, trade_date, market, currency, used_amount
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, strategy_id, trade_date) DO UPDATE SET
      used_amount = used_amount + excluded.used_amount,
      updated_at = datetime('now')
  `).run(userId, strategyId, tradeDate, market, currency, amount);
}

export function acquireLock(userId, strategyId, lockKey, lockedUntil) {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`
    DELETE FROM auto_trading_locks
    WHERE strategy_id = ? AND lock_key = ? AND locked_until <= ?
  `).run(strategyId, lockKey, now);
  try {
    db.prepare(`
      INSERT INTO auto_trading_locks (user_id, strategy_id, lock_key, locked_until)
      VALUES (?, ?, ?, ?)
    `).run(userId, strategyId, lockKey, lockedUntil);
    return true;
  } catch (error) {
    if (String(error.message).includes('UNIQUE')) return false;
    throw error;
  }
}

export function releaseLock(strategyId, lockKey) {
  getDb().prepare('DELETE FROM auto_trading_locks WHERE strategy_id = ? AND lock_key = ?').run(strategyId, lockKey);
}

export function dashboardStats(userId) {
  const running = getDb().prepare(`
    SELECT COUNT(*) AS count FROM auto_trading_strategies
    WHERE user_id = ? AND status = 'RUNNING'
  `).get(userId).count;
  const errors = getDb().prepare(`
    SELECT COUNT(*) AS count FROM auto_trading_strategies
    WHERE user_id = ? AND status = 'ERROR'
  `).get(userId).count;
  const today = new Date().toISOString().slice(0, 10);
  const used = getDb().prepare(`
    SELECT COALESCE(SUM(used_amount), 0) AS total FROM daily_order_limit_usages
    WHERE user_id = ? AND trade_date = ?
  `).get(userId, today).total;
  return { runningStrategyCount: running, errorStrategyCount: errors, todayOrderAmount: used };
}

function toSettings(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    liveOrderEnabled: row.live_order_enabled === 1,
    liveOrderEnabledUpdatedAt: row.live_order_enabled_updated_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toSettingHistory(row) {
  return {
    id: row.id,
    userId: row.user_id,
    previousLiveOrderEnabled: row.previous_live_order_enabled === 1,
    newLiveOrderEnabled: row.new_live_order_enabled === 1,
    changedAt: row.changed_at
  };
}

function toStrategy(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    symbol: row.symbol,
    symbolName: row.symbol_name || '',
    market: row.market,
    currency: row.currency,
    exchange: row.exchange || null,
    status: row.status,
    totalBudget: row.total_budget,
    splitCount: row.split_count,
    buyAmountPerRound: row.buy_amount_per_round,
    targetProfitRate: row.target_profit_rate,
    bigBuyPremiumRate: row.big_buy_premium_rate,
    effectiveBigBuyPremiumRate: resolveBigBuyPremiumRate({ override: row.big_buy_premium_rate, splitCount: row.split_count }),
    pendingAvgBudget: row.pending_avg_budget ?? 0,
    pendingBigBudget: row.pending_big_budget ?? 0,
    cycleBudget: row.cycle_budget > 0 ? row.cycle_budget : row.total_budget,
    currentRound: row.current_round,
    startedAt: row.started_at,
    stoppedAt: row.stopped_at,
    lastEvaluatedAt: row.last_evaluated_at,
    lastOrderAt: row.last_order_at,
    lastDecision: row.last_decision,
    lastErrorMessage: row.last_error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toPositionSnapshot(row) {
  if (!row) return null;
  return {
    id: row.id,
    strategyId: row.strategy_id,
    symbol: row.symbol,
    market: row.market,
    currency: row.currency,
    quantity: row.quantity,
    averagePrice: row.average_price,
    currentPrice: row.current_price,
    evaluationAmount: row.evaluation_amount,
    unrealizedProfit: row.unrealized_profit,
    unrealizedProfitRate: row.unrealized_profit_rate,
    cashAvailable: row.cash_available,
    source: row.source,
    decision: row.decision,
    capturedAt: row.captured_at
  };
}

function toDecisionLog(row) {
  if (!row) return null;
  return {
    id: row.id,
    strategyId: row.strategy_id,
    symbol: row.symbol,
    market: row.market,
    currency: row.currency,
    currentPrice: row.current_price,
    averagePrice: row.average_price,
    holdingQuantity: row.holding_quantity,
    cashAvailable: row.cash_available,
    currentRound: row.current_round,
    decision: row.decision,
    expectedQuantity: row.expected_quantity,
    expectedOrderPrice: row.expected_order_price,
    expectedAmount: row.expected_amount,
    liveOrderEnabled: row.live_order_enabled === 1,
    reason: row.reason,
    targetSellPrice: row.target_sell_price,
    distanceToTargetRate: row.distance_to_target_rate,
    openOrderCount: row.open_order_count,
    evaluationSource: row.evaluation_source,
    orderId: row.order_id,
    createdAt: row.created_at
  };
}

function toOrder(row) {
  if (!row) return null;
  return {
    id: row.id,
    strategyId: row.strategy_id,
    symbol: row.symbol,
    market: row.market,
    currency: row.currency,
    exchange: row.exchange || null,
    side: row.side,
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
    half: row.half,
    decisionLogId: row.decision_log_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
