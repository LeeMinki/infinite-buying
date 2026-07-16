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
    WHERE user_id = ? AND deleted_at IS NULL
    ORDER BY updated_at DESC, id DESC
  `).all(userId).map(toStrategy);
}

export function listRunningStrategies() {
  return getDb().prepare(`
    SELECT * FROM kr_rank_strategies
    WHERE status = 'RUNNING' AND deleted_at IS NULL
    ORDER BY last_evaluated_at IS NOT NULL, last_evaluated_at ASC, id ASC
  `).all().map(toStrategy);
}

export function getStrategy(userId, id, { includeDeleted = false } = {}) {
  const deletedClause = includeDeleted ? '' : ' AND deleted_at IS NULL';
  return toStrategy(getDb().prepare(`
    SELECT * FROM kr_rank_strategies WHERE user_id = ? AND id = ?${deletedClause}
  `).get(userId, id));
}

export function startStrategy(userId, id) {
  getDb().prepare(`
    UPDATE kr_rank_strategies
    SET started_at = CASE
          WHEN status = 'RUNNING' THEN COALESCE(started_at, datetime('now'))
          ELSE datetime('now')
        END,
        status = 'RUNNING',
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
  return getDb().prepare(`
    UPDATE kr_rank_strategies
    SET status = 'STOPPED',
        stopped_at = COALESCE(stopped_at, datetime('now')),
        deleted_at = COALESCE(deleted_at, datetime('now')),
        updated_at = datetime('now')
    WHERE user_id = ? AND id = ? AND deleted_at IS NULL
  `).run(userId, id).changes > 0;
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

// 실제/모의 매수 확인 뒤 진입 BOUGHT와 전략 holding은 하나의 상태 전이다. 둘 사이에서
// 프로세스가 끊기면 실제 포지션이 scheduler에서 사라질 수 있으므로 같은 SQLite transaction으로 확정한다.
export function confirmEntryHolding(userId, strategyId, entryId, { symbol, symbolName, entryWindow }) {
  const db = getDb();
  const confirm = db.transaction(() => {
    const entryResult = db.prepare(`
      UPDATE kr_rank_entries
      SET status = 'BOUGHT', bought = 1, updated_at = datetime('now')
      WHERE id = ? AND strategy_id = ? AND user_id = ?
    `).run(entryId, strategyId, userId);
    if (entryResult.changes !== 1) throw new Error('확정할 한국 랭킹 진입 기록을 찾을 수 없습니다.');
    const strategyResult = db.prepare(`
      UPDATE kr_rank_strategies
      SET holding_symbol = ?, holding_symbol_name = ?, holding_entry_window = ?,
          updated_at = datetime('now')
      WHERE id = ? AND user_id = ?
    `).run(symbol, symbolName || null, entryWindow, strategyId, userId);
    if (strategyResult.changes !== 1) throw new Error('보유 상태를 기록할 한국 랭킹 전략을 찾을 수 없습니다.');
  });
  confirm();
  return {
    entry: getEntryById(entryId),
    strategy: getStrategy(userId, strategyId, { includeDeleted: true })
  };
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

export function clearEntrySelection(id, { rankingSnapshot = null } = {}) {
  getDb().prepare(`
    UPDATE kr_rank_entries
    SET status = 'SELECTED',
        selected_symbol = NULL,
        selected_symbol_name = NULL,
        selected_price = NULL,
        selected_fluctuation_rate = NULL,
        ranking_snapshot = COALESCE(?, ranking_snapshot),
        updated_at = datetime('now')
    WHERE id = ?
  `).run(rankingSnapshot ? JSON.stringify(rankingSnapshot) : null, id);
  return getEntryById(id);
}

// 한 번 정한 진입 판단이 무효화되면 같은 구간에서 새 후보를 계속 탐색하지 않는다.
// 선택값은 지워 UI가 실제 매수 종목처럼 보이지 않게 하고, 스냅샷은 사후 분석용으로 보존한다.
export function finalizeEntryWithoutCandidate(id, { status = 'NO_CANDIDATE', rankingSnapshot = null } = {}) {
  getDb().prepare(`
    UPDATE kr_rank_entries
    SET status = ?, bought = 0,
        selected_symbol = NULL,
        selected_symbol_name = NULL,
        selected_price = NULL,
        selected_fluctuation_rate = NULL,
        ranking_snapshot = COALESCE(?, ranking_snapshot),
        updated_at = datetime('now')
    WHERE id = ?
  `).run(status, rankingSnapshot ? JSON.stringify(rankingSnapshot) : null, id);
  return getEntryById(id);
}

export function getEntry(strategyId, tradeDate, entryWindow) {
  return toEntry(getDb().prepare(`
    SELECT * FROM kr_rank_entries
    WHERE strategy_id = ? AND trade_date = ? AND entry_window = ?
  `).get(strategyId, tradeDate, entryWindow));
}

// 진입창이 끝난 뒤에도 이미 접수됐거나 일부/전부 체결된 BUY를 잔고·청산 상태까지
// 이어서 확인할 수 있도록 미종결 SELECTED 진입을 찾는다. 오늘 아직 주문 전인 후보도 포함한다.
export function getPendingEntry(strategyId, tradeDate) {
  return toEntry(getDb().prepare(`
    SELECT e.*
    FROM kr_rank_entries e
    WHERE e.strategy_id = ?
      AND e.status = 'SELECTED'
      AND e.bought = 0
      AND e.selected_symbol IS NOT NULL
      AND (
        e.trade_date = ?
        OR EXISTS (
          SELECT 1
          FROM kr_rank_orders o
          WHERE o.entry_id = e.id
            AND o.side = 'BUY'
            AND (
              o.status NOT IN ('FAILED', 'REJECTED', 'CANCELED')
              OR COALESCE(o.filled_quantity, 0) > 0
            )
        )
      )
    ORDER BY e.trade_date ASC, e.id ASC
    LIMIT 1
  `).get(strategyId, tradeDate));
}

export function hasStartedBuyForEntry(entryId) {
  return Boolean(getDb().prepare(`
    SELECT 1
    FROM kr_rank_orders
    WHERE entry_id = ?
      AND side = 'BUY'
      AND (status NOT IN ('FAILED', 'REJECTED', 'CANCELED') OR COALESCE(filled_quantity, 0) > 0)
    LIMIT 1
  `).get(entryId));
}

export function getEntryById(id) {
  return toEntry(getDb().prepare('SELECT * FROM kr_rank_entries WHERE id = ?').get(id));
}

export function getLatestBoughtEntry(strategyId, entryWindow, symbol) {
  return toEntry(getDb().prepare(`
    SELECT * FROM kr_rank_entries
    WHERE strategy_id = ?
      AND entry_window = ?
      AND selected_symbol = ?
      AND bought = 1
    ORDER BY trade_date DESC, id DESC
    LIMIT 1
  `).get(strategyId, entryWindow, symbol));
}

export function listEntries(userId, strategyId, { limit = 50, offset = 0 } = {}) {
  return getDb().prepare(`
    SELECT * FROM kr_rank_entries
    WHERE user_id = ? AND strategy_id = ?
    ORDER BY trade_date DESC, id DESC
    LIMIT ? OFFSET ?
  `).all(userId, strategyId, limit, offset).map(toEntry);
}

export function countEntries(userId, strategyId) {
  return getDb().prepare(
    'SELECT COUNT(*) AS n FROM kr_rank_entries WHERE user_id = ? AND strategy_id = ?'
  ).get(userId, strategyId).n;
}

// ── 진입 전 랭킹 관찰 ─────────────────────────────────────────────────────

export function createObservation(userId, input) {
  const result = getDb().prepare(`
    INSERT INTO kr_rank_observations (
      user_id, strategy_id, trade_date, entry_window, ranking_snapshot
    ) VALUES (?, ?, ?, ?, ?)
  `).run(
    userId,
    input.strategyId,
    input.tradeDate,
    input.entryWindow,
    JSON.stringify(input.rankingSnapshot || [])
  );
  return getObservationById(result.lastInsertRowid);
}

export function listObservations(strategyId, tradeDate, entryWindow, { limit = 30 } = {}) {
  return getDb().prepare(`
    SELECT * FROM kr_rank_observations
    WHERE strategy_id = ? AND trade_date = ? AND entry_window = ?
    ORDER BY observed_at DESC, id DESC
    LIMIT ?
  `).all(strategyId, tradeDate, entryWindow, limit).reverse().map(toObservation);
}

export function getObservationById(id) {
  return toObservation(getDb().prepare('SELECT * FROM kr_rank_observations WHERE id = ?').get(id));
}

// 보존 기간이 지난 관찰 스냅샷을 삭제한다. trade_date 가 cutoff(YYYY-MM-DD) 미만이면 제거.
export function deleteObservationsBefore(cutoffTradeDate) {
  return getDb()
    .prepare('DELETE FROM kr_rank_observations WHERE trade_date < ?')
    .run(cutoffTradeDate).changes;
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
        error_message = ?,
        filled_at = CASE
          WHEN ? = 'FILLED' THEN COALESCE(filled_at, datetime('now'))
          ELSE filled_at
        END,
        updated_at = datetime('now')
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
    input.status,
    userId,
    id
  );
  return getOrder(userId, id);
}

export function updateOrderRealizedProfit(userId, id, input) {
  getDb().prepare(`
    UPDATE kr_rank_orders
    SET realized_profit_amount = ?, realized_profit_rate = ?,
        realized_fee_amount = ?, realized_tax_amount = ?,
        realized_profit_synced_at = datetime('now'), realized_profit_source = ?,
        updated_at = datetime('now')
    WHERE user_id = ? AND id = ?
  `).run(
    input.realizedProfitAmount ?? null,
    input.realizedProfitRate ?? null,
    input.realizedFeeAmount ?? null,
    input.realizedTaxAmount ?? null,
    input.realizedProfitSource || 'KIS_TTTC8715R',
    userId,
    id
  );
  return getOrder(userId, id);
}

export function getOrder(userId, id) {
  return toOrder(getDb().prepare('SELECT * FROM kr_rank_orders WHERE user_id = ? AND id = ?').get(userId, id));
}

export function listFillSyncCandidates(userId, { strategyId = null, limit = 20 } = {}) {
  const params = [userId];
  let where = `
    user_id = ?
    AND live_order_enabled = 1
    AND kis_order_no IS NOT NULL
    AND kis_order_no <> ''
    AND (
      status IN ('ACCEPTED', 'REQUESTED', 'PARTIALLY_FILLED', 'UNKNOWN')
      OR (
        status = 'FILLED'
        AND (
          average_filled_price IS NULL
          OR average_filled_price <= 0
          OR filled_quantity IS NULL
          OR filled_quantity <= 0
        )
      )
    )
  `;
  if (strategyId) {
    where += ' AND strategy_id = ?';
    params.push(strategyId);
  }
  params.push(limit);
  return getDb().prepare(`
    SELECT * FROM kr_rank_orders
    WHERE ${where}
    ORDER BY created_at DESC, id DESC
    LIMIT ?
  `).all(...params).map(toOrder);
}

export function listRealizedProfitSyncCandidates(userId, { strategyId = null, limit = 20 } = {}) {
  const params = [userId];
  let where = `
    user_id = ?
    AND live_order_enabled = 1
    AND side = 'SELL'
    AND status = 'FILLED'
    AND realized_profit_rate IS NULL
  `;
  if (strategyId) {
    where += ' AND strategy_id = ?';
    params.push(strategyId);
  }
  params.push(limit);
  return getDb().prepare(`
    SELECT * FROM kr_rank_orders
    WHERE ${where}
    ORDER BY created_at DESC, id DESC
    LIMIT ?
  `).all(...params).map(toOrder);
}

export function listOrders(userId, { strategyId = null, limit = 50, offset = 0 } = {}) {
  const params = [userId];
  let where = 'user_id = ?';
  if (strategyId) {
    where += ' AND strategy_id = ?';
    params.push(strategyId);
  }
  params.push(limit, offset);
  return getDb().prepare(`
    SELECT * FROM kr_rank_orders WHERE ${where}
    ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?
  `).all(...params).map(toOrder);
}

export function listRoundTripOrders(userId, { strategyId, limit = 50, offset = 0 } = {}) {
  // 매수가·매도가는 "KIS가 확인해 준 실제 체결가(average_filled_price)"만 신뢰한다.
  // 주문 접수 시점의 order_price는 실제 체결가와 다를 수 있어(시장가 슬리피지, 지정가의 호가 차)
  // 화면에 그대로 보여주면 KIS 앱과 어긋난다 — 사용자가 0.2~0.4% 단위로 손익률이 다르게 보인다.
  // 단, DRY_RUN(실주문 OFF 시뮬레이션)은 실제 체결이 없으니 order_price를 가짜 체결가로 쓴다.
  return getDb().prepare(`
    WITH buy_orders AS (
      SELECT o.*
      FROM kr_rank_orders o
      WHERE o.user_id = ?
        AND o.strategy_id = ?
        AND o.side = 'BUY'
        AND o.status NOT IN ('FAILED', 'REJECTED', 'CANCELED')
    )
    SELECT
      b.id AS buy_order_id,
      b.strategy_id,
      b.entry_id,
      b.symbol,
      b.symbol_name,
      b.market,
      b.currency,
      b.entry_window,
      b.quantity AS buy_quantity,
      CASE
        WHEN b.average_filled_price IS NOT NULL AND b.average_filled_price > 0 THEN b.average_filled_price
        WHEN b.status = 'DRY_RUN' THEN b.order_price
        ELSE NULL
      END AS buy_price,
      CASE
        WHEN b.status = 'FILLED' THEN COALESCE(b.filled_at, b.updated_at, b.created_at)
        ELSE b.created_at
      END AS buy_time,
      b.status AS buy_status,
      s.id AS sell_order_id,
      s.quantity AS sell_quantity,
      CASE
        WHEN s.average_filled_price IS NOT NULL AND s.average_filled_price > 0 THEN s.average_filled_price
        WHEN s.status = 'DRY_RUN' THEN s.order_price
        ELSE NULL
      END AS sell_price,
      CASE
        WHEN s.status = 'FILLED' THEN COALESCE(s.filled_at, s.updated_at, s.created_at)
        ELSE s.created_at
      END AS sell_time,
      s.status AS sell_status,
      s.sell_reason,
      s.realized_profit_amount,
      s.realized_profit_rate,
      s.realized_fee_amount,
      s.realized_tax_amount,
      s.realized_profit_synced_at,
      CASE
        WHEN s.id IS NULL THEN NULL
        WHEN (
          CASE
            WHEN b.average_filled_price IS NOT NULL AND b.average_filled_price > 0 THEN b.average_filled_price
            WHEN b.status = 'DRY_RUN' THEN b.order_price
            ELSE NULL
          END
        ) IS NULL THEN NULL
        WHEN (
          CASE
            WHEN s.average_filled_price IS NOT NULL AND s.average_filled_price > 0 THEN s.average_filled_price
            WHEN s.status = 'DRY_RUN' THEN s.order_price
            ELSE NULL
          END
        ) IS NULL THEN NULL
        ELSE (
          (
            CASE
              WHEN s.average_filled_price IS NOT NULL AND s.average_filled_price > 0 THEN s.average_filled_price
              WHEN s.status = 'DRY_RUN' THEN s.order_price
            END
          ) - (
            CASE
              WHEN b.average_filled_price IS NOT NULL AND b.average_filled_price > 0 THEN b.average_filled_price
              WHEN b.status = 'DRY_RUN' THEN b.order_price
            END
          )
        ) / (
          CASE
            WHEN b.average_filled_price IS NOT NULL AND b.average_filled_price > 0 THEN b.average_filled_price
            WHEN b.status = 'DRY_RUN' THEN b.order_price
          END
        )
      END AS profit_rate
    FROM buy_orders b
    LEFT JOIN kr_rank_orders s
      ON s.user_id = b.user_id
     AND s.strategy_id = b.strategy_id
     AND s.side = 'SELL'
     AND s.symbol = b.symbol
     AND s.entry_window = b.entry_window
     AND s.created_at >= b.created_at
     AND s.status NOT IN ('FAILED', 'REJECTED', 'CANCELED')
     AND s.id = (
       SELECT s2.id
       FROM kr_rank_orders s2
       WHERE s2.user_id = b.user_id
         AND s2.strategy_id = b.strategy_id
         AND s2.side = 'SELL'
         AND s2.symbol = b.symbol
         AND s2.entry_window = b.entry_window
         AND s2.created_at >= b.created_at
         AND s2.status NOT IN ('FAILED', 'REJECTED', 'CANCELED')
       ORDER BY s2.created_at ASC, s2.id ASC
       LIMIT 1
     )
    ORDER BY b.created_at DESC, b.id DESC
    LIMIT ? OFFSET ?
  `).all(userId, strategyId, limit, offset).map(toRoundTripOrder);
}

// 실제 체결을 시도한 매수만 센다. FAILED/REJECTED/CANCELED는 "매수/매도 기록"이 아니라 제외한다.
export function countRoundTripOrders(userId, { strategyId }) {
  return getDb().prepare(`
    SELECT COUNT(*) AS n
    FROM kr_rank_orders
    WHERE user_id = ? AND strategy_id = ? AND side = 'BUY'
      AND status NOT IN ('FAILED', 'REJECTED', 'CANCELED')
  `).get(userId, strategyId).n;
}

export function countOrders(userId, { strategyId = null } = {}) {
  const params = [userId];
  let where = 'user_id = ?';
  if (strategyId) {
    where += ' AND strategy_id = ?';
    params.push(strategyId);
  }
  return getDb().prepare(`SELECT COUNT(*) AS n FROM kr_rank_orders WHERE ${where}`).get(...params).n;
}

export function hasDuplicateOrder(idempotencyKey) {
  return Boolean(getDb().prepare('SELECT 1 FROM kr_rank_orders WHERE idempotency_key = ?').get(idempotencyKey));
}

// 같은 키로 살아 있는 주문이 있는지. BUY 일부체결 후 잔량 취소/거부는 잔고 확인 없이
// 새 매수를 만들면 안 되므로 blocking한다. SELL 잔량 취소는 남은 실제 잔고를 다시 팔 수 있어야 한다.
export function hasNonFailedOrder(idempotencyKey) {
  return Boolean(getDb().prepare(
    `SELECT 1 FROM kr_rank_orders
     WHERE idempotency_key = ?
       AND (
         status NOT IN ('FAILED', 'REJECTED', 'CANCELED')
         OR (side = 'BUY' AND COALESCE(filled_quantity, 0) > 0)
       )
     LIMIT 1`
  ).get(idempotencyKey));
}

export function getActiveOrderByIdempotencyKey(idempotencyKey) {
  return toOrder(getDb().prepare(`
    SELECT * FROM kr_rank_orders
    WHERE idempotency_key = ?
      AND (
        status NOT IN ('FAILED', 'REJECTED', 'CANCELED')
        OR (side = 'BUY' AND COALESCE(filled_quantity, 0) > 0)
      )
    ORDER BY id DESC
    LIMIT 1
  `).get(idempotencyKey));
}

// 같은 키로 누적된 실패/거부 주문 수 — 재시도 한도 판정에 쓴다.
export function countFailedOrders(idempotencyKey) {
  return getDb().prepare(
    "SELECT COUNT(*) AS c FROM kr_rank_orders WHERE idempotency_key = ? AND status IN ('FAILED', 'REJECTED')"
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

// 실주문으로 청산이 확정된 최근 포지션을 entry 단위로 묶어 손실 회로 차단기 상태를 계산한다.
// 부분체결→잔량취소와 잔량 재매도를 주문 행별 손실 여러 회로 오인하지 않는다. 실현손익
// 동기화가 늦은 청산은 BUY/SELL의 실체결가로만 보완하고, 그래도 판정할 수 없으면
// 주문 결정가로 추정하지 않고 UNKNOWN으로 남긴다. 청산 거래일은 동기화 발견 시각이 아니라
// 진입 거래일(레거시는 멱등키 날짜)을 쓨서 전일 체결이 다음 날 손실로 오귀속되지 않게 한다.
export function getLiveLossRiskState(strategyId, { tradeDate, since = null, limit = 20 } = {}) {
  const rows = getDb().prepare(`
    SELECT s.id, s.entry_id, s.sell_reason, s.status, s.quantity, s.filled_quantity,
           s.average_filled_price, s.order_price,
           s.realized_profit_amount, s.realized_profit_rate,
           COALESCE(s.filled_at, s.updated_at, s.created_at) AS exit_at,
           COALESCE(
             e.trade_date,
             CASE
               WHEN length(s.idempotency_key) >= 8
                 AND substr(s.idempotency_key, 1, 8) NOT GLOB '*[^0-9]*'
               THEN substr(s.idempotency_key, 1, 4) || '-' ||
                    substr(s.idempotency_key, 5, 2) || '-' ||
                    substr(s.idempotency_key, 7, 2)
             END,
             date(datetime(s.created_at, '+9 hours'))
           ) AS trade_date,
           (
             SELECT b.average_filled_price
             FROM kr_rank_orders b
             WHERE s.entry_id IS NOT NULL
               AND b.entry_id = s.entry_id
               AND b.side = 'BUY'
               AND b.live_order_enabled = 1
               AND (b.status = 'FILLED' OR COALESCE(b.filled_quantity, 0) > 0)
             ORDER BY b.id DESC
             LIMIT 1
           ) AS buy_price
    FROM kr_rank_orders s
    LEFT JOIN kr_rank_entries e ON e.id = s.entry_id
    WHERE s.strategy_id = ?
      AND s.side = 'SELL'
      AND s.live_order_enabled = 1
      AND (s.status = 'FILLED' OR COALESCE(s.filled_quantity, 0) > 0)
      AND (? IS NULL OR COALESCE(s.filled_at, s.updated_at, s.created_at) >= ?)
    ORDER BY COALESCE(s.filled_at, s.updated_at, s.created_at) DESC, s.id DESC
    LIMIT ?
  `).all(strategyId, since, since, Math.max(limit * 5, limit));

  const groups = new Map();
  for (const row of rows) {
    const key = row.entry_id == null ? `order:${row.id}` : `entry:${row.entry_id}`;
    let group = groups.get(key);
    if (!group) {
      group = { rows: [], exitAt: row.exit_at, tradeDate: row.trade_date };
      groups.set(key, group);
    }
    group.rows.push(row);
  }

  const recent = [...groups.values()]
    // 부분체결만 진행 중인 포지션은 아직 청산 결과가 아니므로 회로 차단기에 넣지 않는다.
    .filter((group) => group.rows.some((row) => row.status === 'FILLED'))
    .sort((a, b) => String(b.exitAt).localeCompare(String(a.exitAt)))
    .slice(0, limit)
    .map((group) => {
      const executed = group.rows.filter((row) => Number(row.filled_quantity || (row.status === 'FILLED' ? row.quantity : 0)) > 0);
      const realizedAmounts = executed
        .filter((row) => row.realized_profit_amount != null)
        .map((row) => Number(row.realized_profit_amount));
      if (realizedAmounts.length === executed.length && realizedAmounts.length > 0) {
        const amount = realizedAmounts.reduce((sum, value) => sum + value, 0);
        return { ...group, outcome: amount < 0 ? 'LOSS' : (amount > 0 ? 'WIN' : 'UNKNOWN') };
      }

      const buyPrice = Number(executed.find((row) => Number(row.buy_price) > 0)?.buy_price || 0);
      const priced = executed.map((row) => ({
        quantity: Math.min(
          Math.max(Number(row.filled_quantity || (row.status === 'FILLED' ? row.quantity : 0)), 0),
          Math.max(Number(row.quantity || 0), 0)
        ),
        // live 주문의 결정가/시장가 시세는 실제 체결가가 아니다. 체결가가 비면 UNKNOWN으로 둔다.
        price: Number(row.average_filled_price || 0)
      }));
      if (buyPrice > 0 && priced.length > 0 && priced.every((row) => row.quantity > 0 && row.price > 0)) {
        const quantity = priced.reduce((sum, row) => sum + row.quantity, 0);
        const sellPrice = priced.reduce((sum, row) => sum + row.quantity * row.price, 0) / quantity;
        if (sellPrice !== buyPrice) {
          return { ...group, outcome: sellPrice < buyPrice ? 'LOSS' : 'WIN' };
        }
      }

      const realizedRates = executed
        .filter((row) => row.realized_profit_rate != null)
        .map((row) => Number(row.realized_profit_rate));
      if (realizedRates.length > 0 && realizedRates.every(Number.isFinite)) {
        const worstRate = Math.min(...realizedRates);
        if (worstRate !== 0) return { ...group, outcome: worstRate < 0 ? 'LOSS' : 'WIN' };
      }

      const lossReason = executed.some((row) => ['STOP_LOSS', 'ENTRY_FAILED'].includes(row.sell_reason));
      return { ...group, outcome: lossReason ? 'LOSS' : 'UNKNOWN' };
    });

  let consecutiveLossExits = 0;
  let consecutiveRiskExits = 0;
  for (const row of recent) {
    if (row.outcome === 'WIN') break;
    consecutiveRiskExits += 1;
    if (row.outcome === 'LOSS') consecutiveLossExits += 1;
  }

  const lossExitToday = tradeDate
    ? recent.some((row) => row.outcome === 'LOSS' && row.tradeDate === tradeDate)
    : false;
  const unresolvedExitToday = tradeDate
    ? recent.some((row) => row.outcome === 'UNKNOWN' && row.tradeDate === tradeDate)
    : false;
  const lossExitsToday = tradeDate
    ? recent.filter((row) => row.outcome === 'LOSS' && row.tradeDate === tradeDate).length
    : 0;
  const unresolvedExitsToday = tradeDate
    ? recent.filter((row) => row.outcome === 'UNKNOWN' && row.tradeDate === tradeDate).length
    : 0;
  const consecutiveUnresolvedExits = recent
    .slice(0, consecutiveRiskExits)
    .filter((row) => row.outcome === 'UNKNOWN').length;
  return {
    lossExitToday,
    unresolvedExitToday,
    lossExitsToday,
    unresolvedExitsToday,
    riskExitsToday: lossExitsToday + unresolvedExitsToday,
    consecutiveLossExits,
    consecutiveUnresolvedExits,
    consecutiveRiskExits
  };
}

export function getActiveSellOrder({ strategyId, entryWindow, symbol = null, sellReason = null } = {}) {
  const params = [strategyId, entryWindow];
  let where = `
    strategy_id = ?
    AND entry_window = ?
    AND side = 'SELL'
    AND status NOT IN ('FAILED', 'REJECTED', 'CANCELED', 'FILLED')
  `;
  if (symbol) {
    where += ' AND symbol = ?';
    params.push(symbol);
  }
  if (sellReason) {
    where += ' AND sell_reason = ?';
    params.push(sellReason);
  }
  return toOrder(getDb().prepare(`
    SELECT * FROM kr_rank_orders
    WHERE ${where}
    ORDER BY id DESC
    LIMIT 1
  `).get(...params));
}

export function getLatestBuyOrder({ strategyId, entryWindow, symbol = null, entryId = null } = {}) {
  const params = [strategyId, entryWindow];
  let where = `
    strategy_id = ?
    AND entry_window = ?
    AND side = 'BUY'
    AND (status NOT IN ('FAILED', 'REJECTED', 'CANCELED') OR COALESCE(filled_quantity, 0) > 0)
  `;
  if (entryId != null) {
    where += ' AND entry_id = ?';
    params.push(entryId);
  }
  if (symbol) {
    where += ' AND symbol = ?';
    params.push(symbol);
  }
  return toOrder(getDb().prepare(`
    SELECT * FROM kr_rank_orders
    WHERE ${where}
    ORDER BY id DESC
    LIMIT 1
  `).get(...params));
}

export function getLiveFilledSellQuantityForEntry(entryId) {
  if (entryId == null) return 0;
  const row = getDb().prepare(`
    SELECT COALESCE(SUM(
      CASE
        WHEN COALESCE(filled_quantity, 0) > 0
          THEN MIN(COALESCE(filled_quantity, 0), COALESCE(quantity, filled_quantity, 0))
        WHEN status = 'FILLED' THEN COALESCE(quantity, 0)
        ELSE 0
      END
    ), 0) AS quantity
    FROM kr_rank_orders
    WHERE entry_id = ?
      AND side = 'SELL'
      AND live_order_enabled = 1
  `).get(entryId);
  return Math.max(0, Math.floor(Number(row?.quantity || 0)));
}

export function getFilledSellOrderForEntry(entryId) {
  return toOrder(getDb().prepare(`
    SELECT * FROM kr_rank_orders
    WHERE entry_id = ? AND side = 'SELL' AND status = 'FILLED'
    ORDER BY COALESCE(filled_at, updated_at, created_at) DESC, id DESC
    LIMIT 1
  `).get(entryId));
}

export function getLatestFilledSellOrder({ strategyId, entryWindow, symbol = null, entryId = null } = {}) {
  const params = [strategyId, entryWindow];
  let where = `
    strategy_id = ?
    AND entry_window = ?
    AND side = 'SELL'
    AND status = 'FILLED'
  `;
  if (entryId != null) {
    where += ' AND entry_id = ?';
    params.push(entryId);
  }
  if (symbol) {
    where += ' AND symbol = ?';
    params.push(symbol);
  }
  return toOrder(getDb().prepare(`
    SELECT * FROM kr_rank_orders
    WHERE ${where}
    ORDER BY COALESCE(filled_at, updated_at, created_at) DESC, id DESC
    LIMIT 1
  `).get(...params));
}

export function countSellOrders({ strategyId, entryWindow, symbol = null } = {}) {
  const params = [strategyId, entryWindow];
  let where = "strategy_id = ? AND entry_window = ? AND side = 'SELL'";
  if (symbol) {
    where += ' AND symbol = ?';
    params.push(symbol);
  }
  return getDb().prepare(`SELECT COUNT(*) AS c FROM kr_rank_orders WHERE ${where}`).get(...params).c;
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

export function listDecisionLogs(userId, strategyId, { limit = 50, offset = 0 } = {}) {
  return getDb().prepare(`
    SELECT * FROM kr_rank_decision_logs
    WHERE user_id = ? AND strategy_id = ?
    ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?
  `).all(userId, strategyId, limit, offset).map(toDecisionLog);
}

export function countDecisionLogs(userId, strategyId) {
  return getDb().prepare(
    'SELECT COUNT(*) AS n FROM kr_rank_decision_logs WHERE user_id = ? AND strategy_id = ?'
  ).get(userId, strategyId).n;
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
    deletedAt: row.deleted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toRoundTripOrder(row) {
  if (!row) return null;
  return {
    buyOrderId: row.buy_order_id,
    sellOrderId: row.sell_order_id,
    strategyId: row.strategy_id,
    entryId: row.entry_id,
    symbol: row.symbol,
    symbolName: row.symbol_name,
    market: row.market,
    currency: row.currency,
    entryWindow: row.entry_window,
    buyTime: row.buy_time,
    buyPrice: row.buy_price,
    buyQuantity: row.buy_quantity,
    buyStatus: row.buy_status,
    sellTime: row.sell_time,
    sellPrice: row.sell_price,
    sellQuantity: row.sell_quantity,
    sellStatus: row.sell_status,
    sellReason: row.sell_reason,
    realizedProfitAmount: row.realized_profit_amount,
    realizedProfitRate: row.realized_profit_rate,
    realizedFeeAmount: row.realized_fee_amount,
    realizedTaxAmount: row.realized_tax_amount,
    realizedProfitSyncedAt: row.realized_profit_synced_at,
    profitRate: row.profit_rate
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

function toObservation(row) {
  if (!row) return null;
  return {
    id: row.id,
    strategyId: row.strategy_id,
    tradeDate: row.trade_date,
    entryWindow: row.entry_window,
    rankingSnapshot: parseJson(row.ranking_snapshot) || [],
    observedAt: row.observed_at,
    createdAt: row.created_at
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
    realizedProfitAmount: row.realized_profit_amount,
    realizedProfitRate: row.realized_profit_rate,
    realizedFeeAmount: row.realized_fee_amount,
    realizedTaxAmount: row.realized_tax_amount,
    realizedProfitSyncedAt: row.realized_profit_synced_at,
    realizedProfitSource: row.realized_profit_source,
    filledAt: row.filled_at,
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
