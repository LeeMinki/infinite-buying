import React, { useEffect, useMemo, useState } from 'react';
import {
  createKrRankStrategy,
  deleteKrRankStrategy,
  evaluateKrRankStrategy,
  getAutoTradingBuyingPowerPreview,
  listKrRankDecisions,
  listKrRankEntries,
  listKrRankOrders,
  listKrRankStrategies,
  startKrRankStrategy,
  stopKrRankStrategy
} from '../api/client.js';

const ENTRY_WINDOW_LABEL = { MORNING: '오전 진입', LUNCH: '점심 진입' };

export function KrRankAutoTradingPanel({ liveOrderEnabled }) {
  const [strategies, setStrategies] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [orders, setOrders] = useState([]);
  const [decisions, setDecisions] = useState([]);
  const [entries, setEntries] = useState([]);
  const [form, setForm] = useState(defaultForm);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [budgetPreview, setBudgetPreview] = useState(null);
  const [budgetPreviewLoading, setBudgetPreviewLoading] = useState(false);

  // 매수 금액 칸을 누르면 KIS 계좌의 원화 주문가능현금을 조회해 보여 준다(라오어 폼과 동일).
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
      const [nextOrders, nextDecisions, nextEntries] = await Promise.all([
        listKrRankOrders(target),
        listKrRankDecisions(target),
        listKrRankEntries(target)
      ]);
      setOrders(nextOrders);
      setDecisions(nextDecisions);
      setEntries(nextEntries);
    } else {
      setOrders([]);
      setDecisions([]);
      setEntries([]);
    }
  }

  useEffect(() => {
    refresh().catch((err) => setError(err.message));
  }, []);

  async function submitStrategy(event) {
    event.preventDefault();
    setBusy('create');
    setError('');
    setMessage('');
    try {
      const created = await createKrRankStrategy({
        morningBudget: Number(form.morningBudget),
        morningTargetProfitRate: Number(form.morningTargetProfitPercent) / 100,
        morningStopLossRate: Number(form.morningStopLossPercent) / 100,
        lunchEntryEnabled: form.lunchEntryEnabled,
        lunchBudget: form.lunchEntryEnabled ? Number(form.lunchBudget) : 0,
        lunchTargetProfitRate: form.lunchEntryEnabled ? Number(form.lunchTargetProfitPercent) / 100 : null,
        lunchStopLossRate: form.lunchEntryEnabled ? Number(form.lunchStopLossPercent) / 100 : null
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

  async function removeStrategy(strategy) {
    if (!strategy) return;
    const proceed = window.confirm(
      `이 전략과 관련된 모든 진입·판단·주문 기록을 삭제합니다. 되돌릴 수 없습니다. 계속할까요?`
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
    if (!entries.length) return {};
    const latestDate = entries[0]?.tradeDate;
    const map = {};
    for (const entry of entries) {
      if (entry.tradeDate === latestDate) map[entry.entryWindow] = entry;
    }
    return { date: latestDate, ...map };
  }, [entries]);

  return (
    <>
      {!liveOrderEnabled && (
        <p className="helper kr-rank-dry-note">
          실주문 실행 설정이 꺼져 있어 <b>실제 주문 없이 기록만 저장 중</b>입니다. 랭킹 조회·종목 선택·판단·주문 예정 기록은 그대로 남습니다.
        </p>
      )}

      <section className="panel section">
        <div className="panel-heading">
          <div>
            <h3>한국 국장 상승률 랭킹 전략이란?</h3>
            <p>오전 9시 10분(선택 시 11시 30분 점심)에 한국주식 등락률 상위 랭킹을 조회해, 등락률 20% 미만 종목 중 1위를 진입 금액 한도 안에서 시장가로 매수하고 목표 수익·손절로 청산합니다. 서버가 1분 간격으로 평가합니다.</p>
          </div>
        </div>
        <ul className="kr-rank-rule-list">
          <li>오전·점심 각 진입 구간에서 하루 한 번씩 매수합니다. 점심 진입을 켜면 하루 두 번까지 매수할 수 있습니다. 매도했더라도 같은 구간에서 다시 매수하지 않습니다.</li>
          <li>등락률 20% 이상 종목은 매수 대상에서 제외합니다 (상한가까지 여유 확보).</li>
          <li>진입 구간별(오전/점심)로 매수 금액·목표 수익률·손절 기준을 따로 정합니다.</li>
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
            <input type="checkbox" checked={form.lunchEntryEnabled}
              onChange={(e) => setForm({ ...form, lunchEntryEnabled: e.target.checked })} />
            <span>11시 30분 점심 진입 사용 (하루 두 번 매수)</span>
          </label>
          {form.lunchEntryEnabled && (
            <>
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
                  <span className="strategy-chip-sub">오전 {formatKrw(strategy.morningBudget)}{strategy.lunchEntryEnabled ? ` · 점심 ${formatKrw(strategy.lunchBudget)}` : ''}</span>
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
              <Metric label="오전 진입" value={formatKrw(selected.morningBudget)} hint={`목표 +${pct(selected.morningTargetProfitRate)} / 손절 -${pct(selected.morningStopLossRate)}`} />
              <Metric label="점심 진입" value={selected.lunchEntryEnabled ? formatKrw(selected.lunchBudget) : '미사용'} hint={selected.lunchEntryEnabled ? `목표 +${pct(selected.lunchTargetProfitRate)} / 손절 -${pct(selected.lunchStopLossRate)}` : '오전 진입만'} />
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
            <DecisionLogTable decisions={decisions} />
            <OrdersTable orders={orders} />
            <EntryTable entries={entries} />
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

// 매수 금액 칸 아래에 KIS 계좌 원화 주문가능현금을 보여 주고, 버튼으로 채워 넣게 한다.
function KrwBalanceHint({ preview, loading, onApply }) {
  if (loading) {
    return <p className="helper">한국투자증권에서 잔액을 확인하는 중입니다…</p>;
  }
  if (!preview) {
    return <p className="helper">칸을 누르면 한국투자증권 주문가능현금을 보여 드립니다.</p>;
  }
  if (preview.error) {
    return <p className="helper">잔액 확인 실패: {preview.error}</p>;
  }
  const cash = Number(preview.cashAvailable || 0);
  if (cash <= 0) {
    return <p className="helper">한국투자증권 주문가능현금이 0입니다. 계좌에 원화가 있는지 확인하세요.</p>;
  }
  return (
    <div className="budget-hint">
      <p className="helper">한국투자증권 주문가능현금을 기준으로 채우려면 누르세요. 직접 입력해도 됩니다.</p>
      <div className="budget-hint-actions">
        <button type="button" className="ghost sm" onClick={() => onApply(cash)}>
          현재 잔고로 채우기 · {formatKrw(cash)}
        </button>
      </div>
    </div>
  );
}

function DecisionLogTable({ decisions }) {
  return (
    <section className="subsection">
      <h4>판단 로그</h4>
      <p className="helper">랭킹 조회·종목 선택·매수/매도 판단 기록입니다. 진입 구간과 매도 사유를 구분해 보여줍니다.</p>
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
              <th>수량</th>
              <th>사유</th>
            </tr>
          </thead>
          <tbody>
            {decisions.map((log) => (
              <tr key={log.id}>
                <td className="muted">{formatDate(log.createdAt)}</td>
                <td><span className={`decision compact ${String(log.decision).toLowerCase()}`}>{decisionLabel(log)}</span></td>
                <td>{log.entryWindow ? ENTRY_WINDOW_LABEL[log.entryWindow] : '-'}</td>
                <td className="muted">{log.evaluationSource === 'MANUAL' ? '수동' : '스케줄러'}</td>
                <td>{log.selectedSymbol ? `${log.selectedSymbolName || ''} ${log.selectedSymbol}`.trim() : '-'}</td>
                <td>{log.currentPrice > 0 ? formatKrw(log.currentPrice) : '-'}</td>
                <td>{log.expectedQuantity ? `${formatNumber(log.expectedQuantity)}주` : '-'}</td>
                <td className="muted">{log.reason}</td>
              </tr>
            ))}
            {decisions.length === 0 && <tr><td className="empty-row" colSpan="8">아직 판단 로그가 없습니다.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function OrdersTable({ orders }) {
  return (
    <section className="subsection">
      <h4>주문 이력</h4>
      <div className="table-wrap">
        <table className="decision-log-table">
          <thead>
            <tr>
              <th>시간</th>
              <th>구분</th>
              <th>진입 구간</th>
              <th>매도 사유</th>
              <th>상태</th>
              <th>실주문</th>
              <th>수량</th>
              <th>가격</th>
              <th>사유</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => (
              <tr key={order.id}>
                <td className="muted">{formatDate(order.createdAt)}</td>
                <td>{order.side === 'BUY' ? '매수' : '매도'}</td>
                <td>{ENTRY_WINDOW_LABEL[order.entryWindow] || '-'}</td>
                <td>{order.sellReason ? sellReasonLabel(order.sellReason) : '-'}</td>
                <td><span className={`badge ${order.status === 'DRY_RUN' ? 'warning' : order.status === 'FAILED' || order.status === 'REJECTED' ? 'danger' : 'active'}`}>{orderStatusLabel(order.status)}</span></td>
                <td className="muted">{order.liveOrderEnabled ? '실주문' : '기록만'}</td>
                <td>{formatNumber(order.quantity)}주</td>
                <td>{formatKrw(order.orderPrice)}</td>
                <td className="muted">
                  {order.decisionReason}
                  {(order.status === 'FAILED' || order.status === 'REJECTED') && order.errorMessage && (
                    <div className="order-error">⚠ 실패 사유: {order.errorMessage}</div>
                  )}
                </td>
              </tr>
            ))}
            {orders.length === 0 && <tr><td className="empty-row" colSpan="9">아직 주문 이력이 없습니다.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function EntryTable({ entries }) {
  return (
    <section className="subsection">
      <h4>진입 기록</h4>
      <p className="helper">날짜·진입 구간별로 한 번씩만 기록됩니다. 선택 종목과 매수 여부를 확인할 수 있습니다.</p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>날짜</th>
              <th>진입 구간</th>
              <th>상태</th>
              <th>선택 종목</th>
              <th>등락률</th>
              <th>매수</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id}>
                <td className="muted">{entry.tradeDate}</td>
                <td>{ENTRY_WINDOW_LABEL[entry.entryWindow] || entry.entryWindow}</td>
                <td>{entryStatusText(entry.status)}</td>
                <td>{entry.selectedSymbol ? `${entry.selectedSymbolName || ''} ${entry.selectedSymbol}`.trim() : '-'}</td>
                <td>{entry.selectedFluctuationRate != null ? `${(entry.selectedFluctuationRate * 100).toFixed(2)}%` : '-'}</td>
                <td>{entry.bought ? '✅' : '-'}</td>
              </tr>
            ))}
            {entries.length === 0 && <tr><td className="empty-row" colSpan="6">아직 진입 기록이 없습니다.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function defaultForm() {
  return {
    morningBudget: '1000000',
    morningTargetProfitPercent: '2',
    morningStopLossPercent: '5',
    lunchEntryEnabled: false,
    lunchBudget: '1000000',
    lunchTargetProfitPercent: '2',
    lunchStopLossPercent: '5'
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
  return reason === 'TARGET' ? '목표 수익' : reason === 'STOP_LOSS' ? '손절' : reason;
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

function formatKrw(value) {
  return `${Number(value || 0).toLocaleString('ko-KR', { maximumFractionDigits: 0 })} KRW`;
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
