import assert from 'node:assert/strict';
import test from 'node:test';
import { useTempDb, bootstrapDb, createUser } from './_helpers/dbHarness.js';
const tmp = useTempDb();
const db = await bootstrapDb();
const repo = await import('../src/repositories/krRankRepository.js');
const { reconcileKrUnknownOrder } = await import('../src/services/krOrderRecoveryService.js');
test.after(() => tmp.cleanup());

function fixture() {
  const user = createUser(db);
  db.prepare(`INSERT INTO kis_credentials (user_id, app_key_masked, app_key_encrypted, app_secret_encrypted,
    account_number_encrypted, account_product_code_encrypted) VALUES (?, 'masked', 'key', 'secret', 'account', 'product')`).run(user.id);
  const strategy = repo.createStrategy(user.id, { morningBudget: 10000, lunchBudget: 10000,
    morningTargetProfitRate: 0.02, morningStopLossRate: 0.05, lunchEntryEnabled: true,
    lunchTargetProfitRate: 0.02, lunchStopLossRate: 0.05 });
  repo.startStrategy(user.id, strategy.id);
  const entry = repo.createEntry(user.id, { strategyId: strategy.id, tradeDate: '2026-09-01',
    entryWindow: 'MORNING', status: 'SELECTED', selectedSymbol: '005930', bought: false });
  const order = repo.createOrder(user.id, { strategyId: strategy.id, entryId: entry.id, symbol: '005930',
    side: 'BUY', entryWindow: 'MORNING', quantity: 1, orderPrice: 10000, estimatedAmount: 10000,
    status: 'UNKNOWN', idempotencyKey: `recovery-${strategy.id}`, decisionReason: 'original decision',
    liveOrderEnabled: true, responsePayloadMasked: JSON.stringify({ rt_cd: '1', msg_cd: 'EGW00201' }), errorMessage: 'original failure' });
  db.prepare("UPDATE kr_rank_orders SET created_at = '2026-09-01 00:11:58' WHERE id = ?").run(order.id);
  const calls = [];
  const trading = {
    async getOrderHistory(symbol, options) { calls.push(['history', symbol, options]); return []; },
    async getOpenOrders(symbol, options) { calls.push(['open', symbol, options]); return []; },
    async getBalance(symbol) { calls.push(['balance', symbol]); return { quantity: 0 }; },
    async placeBuyOrder() { assert.fail('recovery must never submit orders'); },
    async cancelOpenOrder() { assert.fail('recovery must never cancel orders'); }
  };
  return { user, strategy, entry, order, calls, trading,
    args: { userId: user.id, orderId: order.id },
    deps: { trading, now: () => new Date('2026-09-07T00:30:00Z'), pause: async () => {} } };
}
const applyArgs = (f) => ({ ...f.args, apply: true, acknowledgeNoBrokerOrder: true, acknowledgeSameAccount: true });

test('KR operator recovery: dry-run does not mutate, apply re-queries twice and records atomic scoped audit', async () => {
  const f = fixture();
  const preview = await reconcileKrUnknownOrder(f.args, f.deps);
  assert.equal(preview.mode, 'DRY_RUN');
  assert.equal(repo.getOrder(f.user.id, f.order.id).status, 'UNKNOWN');
  assert.equal(repo.getEntryById(f.entry.id).status, 'SELECTED');
  assert.equal(db.prepare('SELECT count(*) AS n FROM kr_order_reconciliations WHERE order_id = ?').get(f.order.id).n, 0);
  assert.equal(f.calls.length, 6);
  assert.deepEqual(f.calls[0], ['history', '', { market: 'KR', exchange: 'ALL', startDate: '20260901', endDate: '20260907' }]);
  const result = await reconcileKrUnknownOrder(applyArgs(f), f.deps);
  assert.equal(result.status, 'FAILED');
  assert.equal(f.calls.length, 12);
  assert.equal(repo.getEntryById(f.entry.id).status, 'SKIPPED');
  assert.equal(repo.getPendingEntry(f.strategy.id, '2026-09-07'), null);
  const strategy = repo.getStrategy(f.user.id, f.strategy.id);
  assert.equal(strategy.status, 'RUNNING');
  assert.equal(strategy.holdingSymbol, null);
  assert.equal(strategy.orderAttention, null);
  assert.equal(repo.getOrder(f.user.id, f.order.id).errorMessage, 'original failure');
  const audit = db.prepare('SELECT * FROM kr_order_reconciliations WHERE order_id = ?').get(f.order.id);
  assert.equal(audit.user_id, f.user.id);
  assert.equal(audit.original_error_code, 'EGW00201');
  assert.equal(JSON.parse(audit.evidence_json).checks.length, 2);
  await assert.rejects(reconcileKrUnknownOrder(applyArgs(f), f.deps), /미확정 매수/);
});

test('KR operator recovery: authorization acknowledgment and user isolation', async () => {
  const f = fixture();
  await assert.rejects(reconcileKrUnknownOrder({ ...f.args, apply: true }, f.deps), /명시/);
  await assert.rejects(reconcileKrUnknownOrder({ ...f.args, apply: true, acknowledgeNoBrokerOrder: true }, f.deps), /동일한 계좌/);
  await assert.rejects(reconcileKrUnknownOrder({ ...f.args, userId: createUser(db).id }, f.deps), /주문을 찾을/);
  assert.equal(f.calls.length, 0);
});

test('KR operator recovery: account changes during queries block apply', async () => {
  const f = fixture();
  f.trading.getBalance = async () => {
    db.prepare("UPDATE kis_credentials SET account_number_encrypted = 'different-account' WHERE user_id = ?").run(f.user.id);
    return { quantity: 0 };
  };
  await assert.rejects(reconcileKrUnknownOrder(applyArgs(f), f.deps), /변경/);
  assert.equal(repo.getOrder(f.user.id, f.order.id).status, 'UNKNOWN');
});

test('KR operator recovery: same day, broker identity, filled evidence and non-rate-limit error fail closed', async () => {
  for (const update of [
    "UPDATE kr_rank_entries SET trade_date = '2026-09-07' WHERE id = ?",
    "UPDATE kr_rank_orders SET kis_order_no = 'broker-id' WHERE entry_id = ?",
    'UPDATE kr_rank_orders SET filled_quantity = 1 WHERE entry_id = ?',
    'UPDATE kr_rank_orders SET average_filled_price = 10000 WHERE entry_id = ?',
    "UPDATE kr_rank_orders SET response_payload_masked = '{}' WHERE entry_id = ?"
  ]) {
    const f = fixture(); db.prepare(update).run(f.entry.id);
    await assert.rejects(reconcileKrUnknownOrder(applyArgs(f), f.deps));
    assert.equal(f.calls.length, 0);
  }
});

test('KR operator recovery: any matching history, open order, positive balance or malformed result prevents mutation', async () => {
  for (const [method, value] of [
    ['getOrderHistory', [{ symbol: '005930', orderNo: 'history', status: 'CANCELED' }]],
    ['getOpenOrders', [{ symbol: '005930', orderNo: 'open' }]],
    ['getBalance', { quantity: 1 }], ['getBalance', {}], ['getBalance', { quantity: null }],
    ['getOrderHistory', [{ status: 'FILLED' }]], ['getOrderHistory', [{ symbol: 'other' }]], ['getOrderHistory', null]
  ]) {
    const f = fixture(); f.trading[method] = async () => value;
    await assert.rejects(reconcileKrUnknownOrder(applyArgs(f), f.deps));
    assert.equal(repo.getOrder(f.user.id, f.order.id).status, 'UNKNOWN');
    assert.equal(repo.getEntryById(f.entry.id).status, 'SELECTED');
  }
});

test('KR operator recovery: incomplete page/network errors and second-check changes fail closed', async () => {
  const f = fixture(); let calls = 0;
  f.trading.getOrderHistory = async () => { if (++calls === 2) throw new Error('incomplete pagination'); return []; };
  await assert.rejects(reconcileKrUnknownOrder(applyArgs(f), f.deps), /증권사 전체 조회에 실패/);
  assert.equal(repo.getOrder(f.user.id, f.order.id).status, 'UNKNOWN');
  assert.equal(db.prepare('SELECT count(*) AS n FROM kr_rank_locks WHERE strategy_id = ?').get(f.strategy.id).n, 0);
});

test('KR operator recovery: active evaluation lock, concurrent state change and audit write failure prevent partial transitions', async () => {
  const locked = fixture();
  repo.acquireLock(locked.user.id, locked.strategy.id, 'evaluate', new Date(Date.now() + 60000).toISOString());
  await assert.rejects(reconcileKrUnknownOrder(applyArgs(locked), locked.deps), /평가가 진행/);
  assert.equal(locked.calls.length, 0);
  const changed = fixture();
  changed.trading.getBalance = async () => {
    db.prepare("UPDATE kr_rank_orders SET decision_reason = 'changed' WHERE id = ?").run(changed.order.id);
    return { quantity: 0 };
  };
  await assert.rejects(reconcileKrUnknownOrder(applyArgs(changed), changed.deps), /변경/);
  assert.equal(repo.getOrder(changed.user.id, changed.order.id).status, 'UNKNOWN');
  const failed = fixture();
  db.exec("CREATE TRIGGER fail_recovery BEFORE UPDATE ON kr_rank_entries BEGIN SELECT RAISE(ABORT, 'test transition failure'); END");
  try { await assert.rejects(reconcileKrUnknownOrder(applyArgs(failed), failed.deps), /test transition failure/); }
  finally { db.exec('DROP TRIGGER fail_recovery'); }
  assert.equal(repo.getOrder(failed.user.id, failed.order.id).status, 'UNKNOWN');
  assert.equal(repo.getEntryById(failed.entry.id).status, 'SELECTED');
  assert.equal(db.prepare('SELECT count(*) AS n FROM kr_order_reconciliations WHERE order_id = ?').get(failed.order.id).n, 0);
});

test('KR operator recovery: replaced lease prevents apply and preserves the new owner lock', async () => {
  const f = fixture();
  const replacement = new Date(Date.now() + 20 * 60 * 1000).toISOString();
  f.trading.getBalance = async () => {
    db.prepare("UPDATE kr_rank_locks SET locked_until = ? WHERE strategy_id = ? AND lock_key = 'evaluate'")
      .run(replacement, f.strategy.id);
    return { quantity: 0 };
  };
  await assert.rejects(reconcileKrUnknownOrder(applyArgs(f), f.deps), /잠금이 만료/);
  assert.equal(repo.getOrder(f.user.id, f.order.id).status, 'UNKNOWN');
  assert.equal(db.prepare('SELECT locked_until FROM kr_rank_locks WHERE strategy_id = ?').get(f.strategy.id).locked_until, replacement);
});

test('KR attention: oldest unresolved order, stale requested, user scope and safe error code', () => {
  const f = fixture();
  assert.deepEqual(repo.getOrderAttention(f.user.id, f.strategy.id), {
    status: 'UNKNOWN', side: 'BUY', symbol: '005930', symbolName: null,
    createdAt: '2026-09-01 00:11:58', errorCode: 'EGW00201', count: 1
  });
  assert.equal(repo.getOrderAttention(createUser(db).id, f.strategy.id), null);
  db.prepare("UPDATE kr_rank_orders SET status = 'REQUESTED', created_at = datetime('now') WHERE id = ?").run(f.order.id);
  assert.equal(repo.getOrderAttention(f.user.id, f.strategy.id), null);
  db.prepare("UPDATE kr_rank_orders SET created_at = datetime('now', '-3 minutes'), response_payload_masked = ? WHERE id = ?")
    .run(JSON.stringify({ msg_cd: 'secret-value-account' }), f.order.id);
  assert.equal(repo.getOrderAttention(f.user.id, f.strategy.id).status, 'REQUESTED');
  assert.equal(repo.getOrderAttention(f.user.id, f.strategy.id).errorCode, null);
});
