import React, { useEffect, useMemo, useState } from 'react';
import {
  createKrRankStrategy,
  deleteKrRankStrategy,
  evaluateKrRankStrategy,
  getAutoTradingBuyingPowerPreview,
  listKrRankDecisions,
  listKrRankEntries,
  listKrRankStrategies,
  listKrRankTradeHistory,
  replayKrRankTrade,
  startKrRankStrategy,
  stopKrRankStrategy,
  syncKrRankFills
} from '../api/client.js';
import { usePagedList } from '../hooks/usePagedList.js';
import { LoadMoreFooter } from '../components/LoadMoreFooter.jsx';
import { StrategyPeriodReturns } from '../components/StrategyPeriodReturns.jsx';

const ENTRY_WINDOW_LABEL = { MORNING: '오전 진입', LUNCH: '점심 진입' };

export function KrRankAutoTradingPanel({ liveOrderEnabled, periodReturns, onPeriodReturnsRefresh }) {
  const [strategies, setStrategies] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const ordersList = usePagedList(listKrRankTradeHistory);
  const decisionsList = usePagedList(listKrRankDecisions, 10);
  const entriesList = usePagedList(listKrRankEntries);
  const [form, setForm] = useState(defaultForm);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [budgetPreview, setBudgetPreview] = useState(null);
  const [budgetPreviewLoading, setBudgetPreviewLoading] = useState(false);
  const [accountSummary, setAccountSummary] = useState(null);
  const [accountSummaryLoading, setAccountSummaryLoading] = useState(false);
  const [replay, setReplay] = useState(null);

  async function loadAccountSummary() {
    setAccountSummaryLoading(true);
    try {
      setAccountSummary(await getAutoTradingBuyingPowerPreview({ market: 'KR' }));
    } catch (err) {
      setAccountSummary({ error: err.message });
    } finally {
      setAccountSummaryLoading(false);
    }
  }

  // 매수 금액 칸을 누르면 KIS 계좌의 원화 매수가능금액을 조회해 보여 준다(라오어 폼과 동일).
  async function loadBudgetPreview() {
    if (budgetPreviewLoading) return;
    if (budgetPreview && !budgetPreview.error) return;
    setBudgetPreviewLoading(true);
    try {
      setBudgetPreview(await getAutoTradingBuyingPowerPreview({ market: 'KR' }));
    } catch (err) {
      setBudgetPreview({ error: err.message });
    } finally {
      setBudgetPreviewLoading(false);
    }
  }

  const selected = useMemo(
    () => strategies.find((s) => s.id === selectedId) || strategies[0] || null,
    [strategies, selectedId]
  );

  async function refresh(nextSelectedId = selectedId) {
    const nextStrategies = await listKrRankStrategies();
    setStrategies(nextStrategies);
    const target = nextSelectedId || nextStrategies[0]?.id || null;
    setSelectedId(target);
    if (target) {
      await Promise.all([
        ordersList.load(target),
        decisionsList.load(target),
        entriesList.load(target)
      ]);
    } else {
      ordersList.reset();
      decisionsList.reset();
      entriesList.reset();
    }
  }

  useEffect(() => {
    refresh().catch((err) => setError(err.message));
    loadAccountSummary().catch(() => {});
  }, []);

  async function submitStrategy(event) {
    event.preventDefault();
    setBusy('create');
    setError('');
    setMessage('');
    try {
      const created = await createKrRankStrategy({
        autoBudgetEnabled: form.autoBudgetEnabled,
        morningBudget: form.autoBudgetEnabled ? 0 : Number(form.morningBudget),
        morningTargetProfitRate: Number(form.morningTargetProfitPercent) / 100,
        morningStopLossRate: Number(form.morningStopLossPercent) / 100,
        morningLiquidateTime: form.morningLiquidateEnabled ? form.morningLiquidateTime : null,
        lunchEntryEnabled: form.lunchEntryEnabled,
        lunchBudget: form.lunchEntryEnabled && !form.autoBudgetEnabled ? Number(form.lunchBudget) : 0,
        lunchTargetProfitRate: form.lunchEntryEnabled ? Number(form.lunchTargetProfitPercent) / 100 : null,
        lunchStopLossRate: form.lunchEntryEnabled ? Number(form.lunchStopLossPercent) / 100 : null,
        lunchLiquidateTime: form.lunchEntryEnabled && form.lunchLiquidateEnabled ? form.lunchLiquidateTime : null
      });
      setMessage('한국 국장 상승률 랭킹 전략을 만들었습니다.');
      await refresh(created.id);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  }

  async function runAction(action, label) {
    if (!selected) return;
    setBusy(label);
    setError('');
    setMessage('');
    try {
      const result = await action(selected.id);
      if (label === 'start') setMessage('전략을 시작했습니다. 서버가 오전·점심 진입 구간에 상승률 랭킹을 평가합니다.');
      if (label === 'stop') setMessage('전략을 종료했습니다. 종료된 전략은 신규 매수 판단을 하지 않습니다.');
      if (label === 'evaluate') setMessage(result?.decision?.reason || '평가를 완료했습니다.');
      await refresh(selected.id);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  }

  async function syncFills() {
    if (!selected) return;
    setBusy('sync-fills');
    setError('');
    setMessage('');
    try {
      const result = await syncKrRankFills(selected.id);
      await refresh(selected.id);
      await onPeriodReturnsRefresh?.();
      setMessage(
        result?.updatedCount > 0
          ? `KIS 체결조회로 ${result.updatedCount}건의 실체결가를 반영했습니다.`
          : '새로 반영할 KIS 실체결가가 없습니다.'
      );
    } catch (err) {
      setError(err.message || 'KIS 체결가 동기화에 실패했습니다.');
    } finally {
      setBusy('');
    }
  }

  async function runReplay(order) {
    if (!selected || !order?.buyOrderId) return;
    setBusy(`replay-${order.buyOrderId}`);
    setError('');
    setReplay(null);
    try {
      const result = await replayKrRankTrade(selected.id, order.buyOrderId);
      setReplay({ ...result, buyOrderId: order.buyOrderId });
      setMessage(`${order.symbolName || order.symbol} 거래 복기 결과를 주문 행 아래에 표시했습니다.`);
    } catch (err) {
      setError(err.message || '거래 복기에 실패했습니다.');
    } finally {
      setBusy('');
    }
  }

  async function removeStrategy(strategy) {
    if (!strategy) return;
    const holdingWarn = strategy.holdingSymbol
      ? `\n\n⚠️ 현재 ${strategy.holdingSymbolName || strategy.holdingSymbol} 보유 중입니다. 삭제하면 이 포지션은 자동으로 매도되지 않으니, 먼저 매도하거나 직접 청산하세요.`
      : '';
    const proceed = window.confirm(
      `이 전략을 목록에서 삭제합니다. 기존 주문 이력과 판단 로그는 보존됩니다. 계속할까요?${holdingWarn}`
    );
    if (!proceed) return;
    setBusy(`delete-${strategy.id}`);
    setError('');
    setMessage('');
    try {
      await deleteKrRankStrategy(strategy.id);
      setMessage('전략을 삭제했습니다.');
      await refresh(selected?.id === strategy.id ? null : selected?.id);
    } catch (err) {
      setError(err.message || '전략 삭제에 실패했습니다.');
    } finally {
      setBusy('');
    }
  }

  const todayEntries = useMemo(() => {
    const entries = entriesList.items;
    if (!entries.length) return {};
    const latestDate = entries[0]?.tradeDate;
    const map = {};
    for (const entry of entries) {
      if (entry.tradeDate === latestDate) map[entry.entryWindow] = entry;
    }
    return { date: latestDate, ...map };
  }, [entriesList.items]);

  return (
    <>
      {!liveOrderEnabled && (
        <p className="helper kr-rank-dry-note">
          실주문 실행 설정이 꺼져 있어 <b>실제 주문 없이 기록만 저장 중</b>입니다. 랭킹 조회·종목 선택·판단·주문 예정 기록은 그대로 남습니다.
        </p>
      )}

      <KrRankAccountSummaryPanel
        summary={accountSummary}
        loading={accountSummaryLoading}
        onRefresh={loadAccountSummary}
      />

      <StrategyPeriodReturns periods={periodReturns} strategyType="kr-rank" />

      <section className="panel section">
        <div className="panel-heading">
          <div>
            <h3>한국 국장 상승률 랭킹 전략이란?</h3>
            <p>오전 9시 10분(선택 시 11시 30분 점심)에 한국주식 등락률 상위 랭킹을 조회해, 오전 20% 미만·점심 16% 미만 후보 중 단기 흐름이 유지된 종목을 현재가 근처 지정가로 매수하고 목표 수익·손절로 청산합니다. 서버가 30초 간격으로 평가합니다.</p>
          </div>
        </div>
        <ul className="kr-rank-rule-list">
          <li>오전·점심 각 진입 구간에서 하루 한 번씩 매수합니다. 점심 진입을 켜면 하루 두 번까지 매수할 수 있습니다. 매도했더라도 같은 구간에서 다시 매수하지 않습니다.</li>
          <li>오전은 등락률 20% 이상, 점심은 16% 이상 종목을 제외합니다. 우선주와 ETF·ETN·스팩·리츠·레버리지·인버스형 상품도 매수 대상에서 뺍니다.</li>
          <li>당일 분봉으로 단기 흐름을 한 번 더 봅니다 — 가장 최근 완성봉에 실제 체결이 있음(거래량 0 제외), 시가 위, VWAP보다 0.1% 이상 위, VWAP 대비 과열 아님(오전 8%, 점심 6% 이내), 점심은 최근 VWAP 기준 과열 아님, 최근 3분 4%·8분 7% 이상 수직 급등 아님, 최근 완성봉 2개 VWAP 상회, 거래량 유지, 거래량 동반 장대 음봉 없음, 최근 고점 대비 1.2% 이상 밀리지 않음, 직전 고점의 99.5% 이상 유지. 상위 5개 안에서 통과 후보를 점수로 고르고, 모두 떨어지면 그 구간 매수는 건너뜁니다.</li>
          <li>매수는 현재가 근처(현재가 +0.4%) 지정가로 보냅니다. 정상 호가에서는 즉시 체결되지만, 순간 급등으로 호가가 갭하면 꼭대기를 잡지 않습니다. 신호를 잡은 가격보다 실제 현재가가 0.7% 넘게 올라 있으면 추격으로 보고 그 평가는 매수를 보류합니다.</li>
          <li>진입 구간별(오전/점심)로 매수 금액·목표 수익률·손절 기준을 따로 정합니다.</li>
          <li>진입 구간별로 청산 시각(KST)을 선택할 수 있습니다. 켜면 그 시각 이후 목표·손절 미도달이어도 전량 매도하고, 끄면 목표·손절만 기다립니다.</li>
          <li>손실이 커지고 분봉 흐름이 무너지면 고정 손절을 기다리지 않고 빠른 손절로 먼저 정리합니다. 다만 한 봉의 일시적 출렁임(아래꼬리)에 팔지 않도록 VWAP 아래 2봉 연속·직전 봉 회복 없음·최근 지지(스윙 저점) 이탈을 함께 확인하고, 종목 변동성(ATR)이 클수록 더 큰 하락에서만 발동합니다. 진행 중인 봉은 빼고 완성봉으로만 판단하며, 매수 후 20분이 지나면 빠른 손절 대신 고정 손절·목표가에 맡깁니다.</li>
          <li>"매수가능금액 전액 사용"을 켜면 매수 금액 입력 없이 진입 시점의 매수가능금액 전액을 한 종목에 투입합니다. 매도 후 잔액 변동이 다음 매수에 자동 반영됩니다.</li>
        </ul>
      </section>

      <section className="panel section">
        <div className="panel-heading">
          <div>
            <h3>전략 만들기</h3>
            <p>오전 진입의 매수 금액·목표 수익률·손절 기준을 정합니다. 점심 진입을 켜면 하루 두 번 매수하며, 점심 진입 값을 따로 입력합니다.</p>
          </div>
        </div>
        <form className="mode-form kr-rank-form" onSubmit={submitStrategy}>
          <label className="checkbox-field">
            <input type="checkbox" checked={form.autoBudgetEnabled}
              onChange={(e) => setForm({ ...form, autoBudgetEnabled: e.target.checked })} />
            <span>매수가능금액 전액 사용</span>
          </label>
          {form.autoBudgetEnabled
            ? (
                <p className="helper kr-rank-auto-budget-note">
                  매수 금액 입력 없이, 진입 시점의 KIS 매수가능금액을 그대로 한 종목에 투입합니다.
                  매도 후 잔액이 늘거나 줄어든 만큼 다음 매수도 그 잔액 그대로 따라갑니다.
                </p>
              )
            : (
                <label>
                  <span>오전 매수 금액 (KRW)</span>
                  <input type="number" min="1" step="1" value={form.morningBudget}
                    onFocus={loadBudgetPreview}
                    onChange={(e) => setForm({ ...form, morningBudget: e.target.value })} required />
                  <p className="helper">오전 진입에서 이 금액 한도 안에서 가용 현금을 최대한 써 매수합니다.</p>
                  <KrwBalanceHint
                    preview={budgetPreview}
                    loading={budgetPreviewLoading}
                    onApply={(amount) => setForm((f) => ({ ...f, morningBudget: String(Math.floor(amount)) }))}
                  />
                </label>
              )}
          <label>
            <span>오전 목표 수익률 (%)</span>
            <input type="number" min="0.1" step="0.1" value={form.morningTargetProfitPercent}
              onChange={(e) => setForm({ ...form, morningTargetProfitPercent: e.target.value })} required />
          </label>
          <label>
            <span>오전 손절 기준 (%)</span>
            <input type="number" min="0.1" step="0.1" value={form.morningStopLossPercent}
              onChange={(e) => setForm({ ...form, morningStopLossPercent: e.target.value })} required />
            <p className="helper">매수가 대비 이만큼 하락하면 전량 매도합니다.</p>
          </label>
          <label className="checkbox-field">
            <input type="checkbox" checked={form.morningLiquidateEnabled}
              onChange={(e) => setForm({ ...form, morningLiquidateEnabled: e.target.checked })} />
            <span>오전 매수분 청산 시각 사용 (KST)</span>
          </label>
          {form.morningLiquidateEnabled && (
            <label>
              <span>오전 매수분 청산 시각</span>
              <input type="time" value={form.morningLiquidateTime} min="09:11"
                onChange={(e) => setForm({ ...form, morningLiquidateTime: e.target.value })} required />
              <p className="helper">이 시각(Asia/Seoul) 이후 평가에서 목표·손절 미도달이어도 전량 매도합니다. 목표 수익·손절이 먼저 발생하면 그쪽이 우선입니다. 오전 진입 시각(09:10) 이전 값은 거절되며, 진입 직후 시각으로 설정하면 매수 직후 청산될 수 있으니 여유롭게 잡으세요.</p>
            </label>
          )}
          <label className="checkbox-field">
            <input type="checkbox" checked={form.lunchEntryEnabled}
              onChange={(e) => setForm({ ...form, lunchEntryEnabled: e.target.checked })} />
            <span>11시 30분 점심 진입 사용 (하루 두 번 매수)</span>
          </label>
          {form.lunchEntryEnabled && (
            <>
              {!form.autoBudgetEnabled && (
                <label>
                  <span>점심 매수 금액 (KRW)</span>
                  <input type="number" min="1" step="1" value={form.lunchBudget}
                    onFocus={loadBudgetPreview}
                    onChange={(e) => setForm({ ...form, lunchBudget: e.target.value })} required />
                  <KrwBalanceHint
                    preview={budgetPreview}
                    loading={budgetPreviewLoading}
                    onApply={(amount) => setForm((f) => ({ ...f, lunchBudget: String(Math.floor(amount)) }))}
                  />
                </label>
              )}
              <label>
                <span>점심 목표 수익률 (%)</span>
                <input type="number" min="0.1" step="0.1" value={form.lunchTargetProfitPercent}
                  onChange={(e) => setForm({ ...form, lunchTargetProfitPercent: e.target.value })} required />
              </label>
              <label>
                <span>점심 손절 기준 (%)</span>
                <input type="number" min="0.1" step="0.1" value={form.lunchStopLossPercent}
                  onChange={(e) => setForm({ ...form, lunchStopLossPercent: e.target.value })} required />
              </label>
              <label className="checkbox-field">
                <input type="checkbox" checked={form.lunchLiquidateEnabled}
                  onChange={(e) => setForm({ ...form, lunchLiquidateEnabled: e.target.checked })} />
                <span>점심 매수분 청산 시각 사용 (KST)</span>
              </label>
              {form.lunchLiquidateEnabled && (
                <label>
                  <span>점심 매수분 청산 시각</span>
                  <input type="time" value={form.lunchLiquidateTime} min="11:31"
                    onChange={(e) => setForm({ ...form, lunchLiquidateTime: e.target.value })} required />
                  <p className="helper">이 시각(Asia/Seoul) 이후 평가에서 목표·손절 미도달이어도 전량 매도합니다. 점심 진입 시각(11:30) 이전 값은 거절됩니다.</p>
                </label>
              )}
            </>
          )}
          <button type="submit" className="primary" disabled={busy === 'create'}>
            {busy === 'create' ? '저장 중...' : '전략 생성'}
          </button>
        </form>
      </section>

      <section className="panel section">
        <div className="panel-heading">
          <div>
            <h3>전략 목록</h3>
            <p>RUNNING 상태인 전략만 서버 스케줄러가 평가합니다.</p>
          </div>
          <span className="heading-meta">{strategies.length}개</span>
        </div>
        <div className="strategy-chip-list">
          {strategies.map((strategy) => (
            <div key={strategy.id} className={`strategy-chip ${selected?.id === strategy.id ? 'active' : ''}`}>
              <button type="button" className="strategy-chip-body" onClick={() => refresh(strategy.id)}>
                <span className="strategy-chip-symbol">
                  <strong>한국 랭킹 #{strategy.id}</strong>
                  <span className="strategy-chip-sub">
                    {strategy.autoBudgetEnabled
                      ? '매수가능금액 전액'
                      : `오전 ${formatKrw(strategy.morningBudget)}${strategy.lunchEntryEnabled ? ` · 점심 ${formatKrw(strategy.lunchBudget)}` : ''}`}
                  </span>
                </span>
                <span className={`badge ${strategy.status === 'RUNNING' ? 'active' : strategy.status === 'ERROR' ? 'danger' : 'warning'}`}>
                  {strategy.status}
                </span>
              </button>
              <button type="button" className="ghost danger-button sm strategy-chip-delete"
                disabled={busy === `delete-${strategy.id}`}
                onClick={() => removeStrategy(strategy)}>
                삭제
              </button>
            </div>
          ))}
          {strategies.length === 0 && <div className="empty">아직 한국 랭킹 전략이 없습니다.</div>}
        </div>
      </section>

      <section className="panel section">
        <div className="panel-heading">
          <div>
            <h3>전략 상세</h3>
            <p>{selected ? '한국 랭킹 전략 상태와 최근 기록입니다.' : '위 목록에서 전략을 선택하세요.'}</p>
          </div>
        </div>
        {selected ? (
          <>
            <div className="metric-grid compact-grid">
              <Metric label="상태" value={selected.status} hint={selected.lastErrorMessage || '정상'} />
              <Metric
                label="오전 진입"
                value={selected.autoBudgetEnabled ? '전액 사용' : formatKrw(selected.morningBudget)}
                hint={`목표 +${pct(selected.morningTargetProfitRate)} / 손절 -${pct(selected.morningStopLossRate)}${selected.morningLiquidateTime ? ` / 청산 ${selected.morningLiquidateTime} KST` : ''}`}
              />
              <Metric
                label="점심 진입"
                value={selected.lunchEntryEnabled ? (selected.autoBudgetEnabled ? '전액 사용' : formatKrw(selected.lunchBudget)) : '미사용'}
                hint={selected.lunchEntryEnabled ? `목표 +${pct(selected.lunchTargetProfitRate)} / 손절 -${pct(selected.lunchStopLossRate)}${selected.lunchLiquidateTime ? ` / 청산 ${selected.lunchLiquidateTime} KST` : ''}` : '오전 진입만'}
              />
              <Metric label="현재 보유" value={selected.holdingSymbol ? `${selected.holdingSymbolName || selected.holdingSymbol}` : '무보유'} hint={selected.holdingSymbol ? `${ENTRY_WINDOW_LABEL[selected.holdingEntryWindow] || ''}로 매수` : '진입 대기'} />
            </div>
            <div className="metric-grid compact-grid">
              <Metric label="오전 진입 (오늘)" value={entryStatusLabel(todayEntries.MORNING)} hint={entrySymbolHint(todayEntries.MORNING)} />
              <Metric label="점심 진입 (오늘)" value={selected.lunchEntryEnabled ? entryStatusLabel(todayEntries.LUNCH) : '미사용'} hint={selected.lunchEntryEnabled ? entrySymbolHint(todayEntries.LUNCH) : '점심 진입 꺼짐'} />
              <Metric label="마지막 판단" value={selected.lastDecision || '-'} hint={selected.lastEvaluatedAt ? formatDate(selected.lastEvaluatedAt) : '아직 없음'} />
              <Metric label="실주문" value={liveOrderEnabled ? '켜짐' : '꺼짐'} hint={liveOrderEnabled ? '검증 후 실제 주문' : '기록만 저장'} />
            </div>
            <div className="auto-action-row">
              <button type="button" className="primary" disabled={busy === 'start' || selected.status === 'RUNNING'}
                onClick={() => runAction(startKrRankStrategy, 'start')}>시작</button>
              <button type="button" className="ghost danger-button" disabled={busy === 'stop' || selected.status !== 'RUNNING'}
                onClick={() => runAction(stopKrRankStrategy, 'stop')}>종료</button>
              <button type="button" className="ghost" disabled={busy === 'evaluate'}
                onClick={() => runAction(evaluateKrRankStrategy, 'evaluate')}>지금 평가</button>
            </div>
            <OrdersTable
              list={ordersList}
              onLoadMore={() => ordersList.loadMore(selected.id)}
              onSync={syncFills}
              syncing={busy === 'sync-fills'}
              onReplay={runReplay}
              replayBusyId={String(busy).startsWith('replay-') ? busy.replace('replay-', '') : null}
              replay={replay}
            />
            <DecisionLogTable list={decisionsList} onLoadMore={() => decisionsList.loadMore(selected.id)} />
          </>
        ) : (
          <div className="empty">전략을 만들면 상세가 표시됩니다.</div>
        )}
      </section>

      {message && <p className="success">{message}</p>}
      {error && <p className="error">{error}</p>}
    </>
  );
}

function Metric({ label, value, hint }) {
  return (
    <div className="metric">
      <span className="metric-label">{label}</span>
      <strong>{value}</strong>
      <span className="metric-hint">{hint}</span>
    </div>
  );
}

// 매수 금액 칸 아래에 KIS 계좌 매수가능금액을 보여 주고, 버튼으로 채워 넣게 한다.
function KrwBalanceHint({ preview, loading, onApply }) {
  if (loading) {
    return <p className="helper">한국투자증권에서 잔액을 확인하는 중입니다…</p>;
  }
  if (!preview) {
    return <p className="helper">입력칸을 선택하면 한국투자증권 매수가능금액을 표시합니다.</p>;
  }
  if (preview.error) {
    return <p className="helper">잔액 확인 실패: {preview.error}</p>;
  }
  const cash = Number(preview.cashAvailable || 0);
  if (cash <= 0) {
    return <p className="helper">한국투자증권 매수가능금액이 0입니다. 계좌에 원화가 있는지 확인하세요.</p>;
  }
  return (
    <div className="budget-hint">
      <p className="helper">한국투자증권 매수가능금액을 기준으로 채우려면 누르세요. 직접 입력해도 됩니다.</p>
      <div className="budget-hint-actions">
        <button type="button" className="ghost sm" onClick={() => onApply(cash)}>
          현재 잔고로 채우기 · {formatKrw(cash)}
        </button>
      </div>
    </div>
  );
}

function KrRankAccountSummaryPanel({ summary, loading, onRefresh }) {
  if (loading && !summary) {
    return (
      <section className="panel section account-summary-panel">
        <div className="panel-heading">
          <div>
            <h3>연결 계좌</h3>
            <p>한국투자증권에서 계좌 정보를 가져오는 중입니다.</p>
          </div>
        </div>
      </section>
    );
  }
  if (summary?.error) {
    return (
      <section className="panel section account-summary-panel warning">
        <div className="panel-heading">
          <div>
            <h3>연결 계좌 조회 실패</h3>
            <p>
              {summary.error}
              <br />
              <span className="helper">
                대부분의 원인: KIS 설정 화면에서 계좌번호 또는 계좌 상품코드가 비어 있거나, App Key·App Secret이 잘못되었거나,
                서버에 IP가 등록되어 있지 않은 경우입니다.
              </span>
            </p>
          </div>
          <button type="button" className="ghost sm" onClick={onRefresh} disabled={loading}>
            다시 조회
          </button>
        </div>
      </section>
    );
  }
  const cash = Number(summary?.cashAvailable || 0);
  return (
    <section className="panel section account-summary-panel">
      <div className="panel-heading">
        <div>
          <h3>연결 계좌</h3>
          <p>한국투자증권에서 조회한 원화 매수가능금액입니다. 계좌번호 원문은 표시하지 않습니다.</p>
        </div>
        <button type="button" className="ghost sm" onClick={onRefresh} disabled={loading}>
          {loading ? '조회 중…' : '다시 조회'}
        </button>
      </div>
      <div className="metric-grid compact-grid">
        <Metric
          label="매수가능금액"
          value={formatKrw(cash)}
          hint={cash > 0 ? '바로 주문 가능' : '계좌에 원화 잔고가 없거나 매도 결제가 남아 있지 않음'}
        />
      </div>
    </section>
  );
}

function DecisionLogTable({ list, onLoadMore }) {
  const decisions = list.items;
  return (
    <section className="subsection">
      <h4>판단 로그</h4>
      <p className="helper">랭킹 조회·종목 선택·매수/매도·보유 평가 기록입니다. 스케줄러는 장 운영 시간(09:00~15:30) 안에서 30초마다 기록합니다.</p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>시간</th>
              <th>판단</th>
              <th>진입 구간</th>
              <th>출처</th>
              <th>선택 종목</th>
              <th>현재가</th>
              <th>보유 수량</th>
              <th>평가금액</th>
              <th>예상 수량</th>
              <th>사유</th>
            </tr>
          </thead>
          <tbody>
            {decisions.map((log) => {
              const holdingValue = Number(log.holdingQuantity || 0) * Number(log.currentPrice || 0);
              return (
                <tr key={log.id}>
                  <td className="muted">{formatDate(log.createdAt)}</td>
                  <td><span className={`decision compact ${String(log.decision).toLowerCase()}`}>{decisionLabel(log)}</span></td>
                  <td>{log.entryWindow ? ENTRY_WINDOW_LABEL[log.entryWindow] : '-'}</td>
                  <td className="muted">{log.evaluationSource === 'MANUAL' ? '수동' : '스케줄러'}</td>
                  <td>{log.selectedSymbol ? `${log.selectedSymbolName || ''} ${log.selectedSymbol}`.trim() : '-'}</td>
                  <td>{log.currentPrice > 0 ? formatKrw(log.currentPrice) : '-'}</td>
                  <td>{log.holdingQuantity > 0 ? `${formatNumber(log.holdingQuantity)}주` : '-'}</td>
                  <td>{holdingValue > 0 ? formatKrw(holdingValue) : '-'}</td>
                  <td>{log.expectedQuantity ? `${formatNumber(log.expectedQuantity)}주` : '-'}</td>
                  <td className="muted">{log.reason}</td>
                </tr>
              );
            })}
            {decisions.length === 0 && <tr><td className="empty-row" colSpan="10">아직 판단 로그가 없습니다.</td></tr>}
          </tbody>
        </table>
      </div>
      <LoadMoreFooter shown={decisions.length} total={list.total} hasMore={list.hasMore} loading={list.loading} onLoadMore={onLoadMore} />
    </section>
  );
}

function OrdersTable({ list, onLoadMore, onSync, syncing, onReplay, replayBusyId, replay }) {
  const orders = list.items;
  return (
    <section className="subsection">
      <div className="subsection-heading-row">
        <div>
          <h4>주문 이력</h4>
          <p className="helper">매수부터 매도까지 한 행으로 묶어 봅니다. 아직 보유 중이면 매도 정보는 진행 중으로 표시됩니다.</p>
        </div>
        <button type="button" className="ghost sm" disabled={syncing} onClick={onSync}>
          {syncing ? '확인 중…' : 'KIS 체결·실현손익 새로 확인'}
        </button>
      </div>
      <div className="table-wrap">
        <table className="decision-log-table">
          <thead>
            <tr>
              <th>매수 시각(KST)</th>
              <th>종목</th>
              <th>매수가</th>
              <th>매도 시각</th>
              <th>매도가</th>
              <th>사유</th>
              <th>평가 손익률</th>
              <th>실현 손익률</th>
              <th>복기</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => {
              const profit = Number(order.profitRate);
              const hasProfit = Number.isFinite(profit);
              const realizedProfit = Number(order.realizedProfitRate);
              const hasRealizedProfit = Number.isFinite(realizedProfit);
              const replayOpen = replay?.buyOrderId === order.buyOrderId;
              return (
                <React.Fragment key={`${order.buyOrderId}-${order.sellOrderId || 'open'}`}>
                  <tr className={replayOpen ? 'selected-row' : ''}>
                    <td className="muted">{formatDate(order.buyTime)}</td>
                    <td>{order.symbolName ? `${order.symbolName} ${order.symbol}` : order.symbol}</td>
                    <td>{formatFillPrice(order.buyPrice)}</td>
                    <td className="muted">{order.sellTime ? formatDate(order.sellTime) : '진행 중'}</td>
                    <td>{order.sellTime ? formatFillPrice(order.sellPrice) : '-'}</td>
                    <td>{rankOrderReasonText(order)}</td>
                    <td className={hasProfit ? (profit >= 0 ? 'positive' : 'negative') : 'neutral'}>
                      {hasProfit ? `${profit >= 0 ? '+' : ''}${(profit * 100).toFixed(2)}%` : (order.sellTime ? '체결 확인 중' : '-')}
                    </td>
                    <td className={hasRealizedProfit ? (realizedProfit >= 0 ? 'positive' : 'negative') : 'neutral'}>
                      {hasRealizedProfit ? `${realizedProfit >= 0 ? '+' : ''}${(realizedProfit * 100).toFixed(2)}%` : (order.sellTime ? 'KIS 확인 중' : '-')}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="ghost sm"
                        disabled={!order.buyPrice || replayBusyId === String(order.buyOrderId)}
                        onClick={() => onReplay?.(order)}
                      >
                        {replayBusyId === String(order.buyOrderId) ? '복기 중…' : (replayOpen ? '다시 복기' : '거래 복기')}
                      </button>
                    </td>
                  </tr>
                  {replayOpen && (
                    <tr className="replay-result-row">
                      <td colSpan="9">
                        <ReplayPanel replay={replay} />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
            {orders.length === 0 && <tr><td className="empty-row" colSpan="9">아직 주문 이력이 없습니다.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="helper">목표 수익 주문이 접수된 상태에서 손절, 빠른 손절, 청산 시각 조건이 나오면 기존 목표가 주문을 먼저 취소한 뒤 새 매도 주문을 시도합니다.</p>
      <LoadMoreFooter shown={orders.length} total={list.total} hasMore={list.hasMore} loading={list.loading} onLoadMore={onLoadMore} />
    </section>
  );
}

function ReplayPanel({ replay }) {
  return (
    <div className="info-panel compact">
      <h4>거래 복기</h4>
      <p className="helper">{replay.symbol} 매수 이후 분봉 기준 흐름입니다. 백테스트가 아니라 실제 거래 한 건을 되짚어 보는 분석입니다.</p>
      <div className="metric-grid compact-grid">
        <Metric label="최대 상승" value={formatPercent(replay.mfeRate)} hint="매수 후 고가 기준" />
        <Metric label="최대 하락" value={formatPercent(replay.maeRate)} hint="매수 후 저가 기준" />
        <Metric label="빠른 손절" value={replay.entryFailure?.hit ? replay.entryFailure.time : '없음'} hint={replay.entryFailure?.reason || '조건 미도달'} />
        <Metric label="분봉 수" value={`${replay.candleCount || 0}개`} hint={replay.ambiguity?.length ? '일부 1분봉은 선후 관계 불확실' : '분봉 기준 근사'} />
      </div>
    </div>
  );
}

function defaultForm() {
  return {
    autoBudgetEnabled: false,
    morningBudget: '1000000',
    morningTargetProfitPercent: '2',
    morningStopLossPercent: '5',
    morningLiquidateEnabled: false,
    morningLiquidateTime: '15:00',
    lunchEntryEnabled: false,
    lunchBudget: '1000000',
    lunchTargetProfitPercent: '2',
    lunchStopLossPercent: '5',
    lunchLiquidateEnabled: false,
    lunchLiquidateTime: '15:15'
  };
}

function decisionLabel(log) {
  if (log.decision === 'BUY') return '매수';
  if (log.decision === 'SELL') return '매도';
  if (log.decision === 'HOLD') return '보유';
  if (log.decision === 'ERROR') return '오류';
  return '관망';
}

function sellReasonLabel(reason) {
  if (reason === 'TARGET') return '목표 수익';
  if (reason === 'STOP_LOSS') return '손절';
  if (reason === 'TIME_LIQUIDATE') return '청산 시각';
  if (reason === 'ENTRY_FAILED') return '빠른 손절';
  return reason;
}

function rankOrderReasonText(order) {
  if (!order.sellReason) return '보유 중';
  if (order.sellReason === 'TARGET' && !order.sellPrice && order.sellStatus && order.sellStatus !== 'FILLED') {
    return `목표 수익 주문 ${orderStatusLabel(order.sellStatus)}`;
  }
  return sellReasonLabel(order.sellReason);
}

function entryStatusText(status) {
  const labels = {
    NO_CANDIDATE: '선택 종목 없음',
    SELECTED: '종목 선택',
    BOUGHT: '매수 완료',
    SKIPPED: '매수 건너뜀'
  };
  return labels[status] || status;
}

function entryStatusLabel(entry) {
  if (!entry) return '미실행';
  return entry.bought ? '매수 완료' : entryStatusText(entry.status);
}

function entrySymbolHint(entry) {
  if (!entry) return '아직 진입하지 않음';
  if (entry.selectedSymbol) return `${entry.selectedSymbolName || ''} ${entry.selectedSymbol}`.trim();
  return '선택 종목 없음';
}

function orderStatusLabel(status) {
  const labels = {
    DRY_RUN: '모의 기록',
    REQUESTED: '요청됨',
    ACCEPTED: '접수됨',
    REJECTED: '거절됨',
    PARTIALLY_FILLED: '일부 체결',
    FILLED: '체결',
    CANCELED: '취소',
    FAILED: '실패',
    UNKNOWN: '확인 필요',
    DECIDED: '판단됨'
  };
  return labels[status] || status;
}

function pct(rate) {
  return `${(Number(rate || 0) * 100).toFixed(1)}%`;
}

function formatPercent(rate) {
  const value = Number(rate);
  if (!Number.isFinite(value)) return '-';
  return `${value >= 0 ? '+' : ''}${(value * 100).toFixed(2)}%`;
}

function formatKrw(value) {
  return `${Number(value || 0).toLocaleString('ko-KR', { maximumFractionDigits: 0 })} KRW`;
}

// 주문 이력 매수가·매도가 칸 전용. KIS가 알려준 실체결가가 들어왔으면 그 값을 보여주고,
// 아직 안 들어온 실주문은 '체결 확인 중'으로 표시한다(주문 시점 추정가를 실체결가로 오인하지 않게).
function formatFillPrice(value) {
  const price = Number(value);
  if (!Number.isFinite(price) || price <= 0) return '체결 확인 중';
  return formatKrw(price);
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString('ko-KR', { maximumFractionDigits: 0 });
}

function formatDate(value) {
  if (!value) return '-';
  // SQLite datetime('now')은 'YYYY-MM-DD HH:MM:SS'(UTC, 시간대 표기 없음) 형식이라
  // JS가 로컬 시각으로 잘못 해석한다. UTC임을 명시해 파싱한 뒤 한국시간으로 표기한다.
  const raw = String(value).trim();
  const normalized = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/.test(raw)
    ? `${raw.replace(' ', 'T')}Z`
    : raw;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
}
