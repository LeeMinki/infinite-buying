import React, { useEffect, useMemo, useState } from 'react';
import {
  createUsRankStrategy,
  deleteUsRankStrategy,
  evaluateUsRankStrategy,
  getAutoTradingBuyingPowerPreview,
  listUsRankDecisions,
  listUsRankOrders,
  listUsRankStrategies,
  listUsRankTrades,
  startUsRankStrategy,
  stopUsRankStrategy
} from '../api/client.js';

const EXCHANGE_LABELS = {
  ALL: '전체',
  NAS: 'NASDAQ',
  NYS: 'NYSE',
  AMS: 'AMEX'
};

export function UsRankAutoTradingPanel({ liveOrderEnabled }) {
  const [strategies, setStrategies] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [trades, setTrades] = useState([]);
  const [orders, setOrders] = useState([]);
  const [decisions, setDecisions] = useState([]);
  const [form, setForm] = useState(defaultForm);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [budgetPreview, setBudgetPreview] = useState(null);
  const [budgetPreviewLoading, setBudgetPreviewLoading] = useState(false);

  const selected = useMemo(
    () => strategies.find((s) => s.id === selectedId) || strategies[0] || null,
    [strategies, selectedId]
  );
  const todayTradeCount = useMemo(() => {
    if (!trades.length) return 0;
    const latestDate = trades[0]?.tradeDate;
    return trades.filter((trade) => trade.tradeDate === latestDate).length;
  }, [trades]);

  async function refresh(nextSelectedId = selectedId) {
    const nextStrategies = await listUsRankStrategies();
    setStrategies(nextStrategies);
    const target = nextSelectedId || nextStrategies[0]?.id || null;
    setSelectedId(target);
    if (target) {
      const [nextTrades, nextOrders, nextDecisions] = await Promise.all([
        listUsRankTrades(target),
        listUsRankOrders(target),
        listUsRankDecisions(target)
      ]);
      setTrades(nextTrades);
      setOrders(nextOrders);
      setDecisions(nextDecisions);
    } else {
      setTrades([]);
      setOrders([]);
      setDecisions([]);
    }
  }

  useEffect(() => {
    refresh().catch((err) => setError(err.message));
  }, []);

  async function loadBudgetPreview() {
    if (budgetPreviewLoading) return;
    if (budgetPreview && !budgetPreview.error) return;
    setBudgetPreviewLoading(true);
    try {
      setBudgetPreview(await getAutoTradingBuyingPowerPreview({ market: 'US', symbol: 'TQQQ', exchange: 'NAS' }));
    } catch (err) {
      setBudgetPreview({ error: err.message });
    } finally {
      setBudgetPreviewLoading(false);
    }
  }

  async function submitStrategy(event) {
    event.preventDefault();
    setBusy('create');
    setError('');
    setMessage('');
    try {
      const created = await createUsRankStrategy({
        autoBudgetEnabled: form.autoBudgetEnabled,
        fixedBuyUsdAmount: form.autoBudgetEnabled ? 0 : Number(form.fixedBuyUsdAmount),
        targetProfitRate: Number(form.targetProfitPercent) / 100,
        stopLossRate: Number(form.stopLossPercent) / 100,
        forceCloseKst: form.forceCloseKst,
        exchange: form.exchange,
        cycleTargetProfitRate: form.cycleTargetEnabled && form.cycleTargetPercent !== ''
          ? Number(form.cycleTargetPercent) / 100
          : null
      });
      setMessage('전략을 만들었습니다.');
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
      if (label === 'start') setMessage('전략을 시작했습니다.');
      if (label === 'stop') setMessage('전략을 종료했습니다.');
      if (label === 'evaluate') setMessage(result?.decision?.reason || '평가 완료.');
      await refresh(selected.id);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  }

  async function removeStrategy(strategy) {
    if (!strategy) return;
    const proceed = window.confirm('이 전략과 매매 사이클·판단·주문 기록을 삭제합니다. 계속할까요?');
    if (!proceed) return;
    setBusy(`delete-${strategy.id}`);
    setError('');
    setMessage('');
    try {
      await deleteUsRankStrategy(strategy.id);
      setMessage('전략을 삭제했습니다.');
      await refresh(selected?.id === strategy.id ? null : selected?.id);
    } catch (err) {
      setError(err.message || '전략 삭제에 실패했습니다.');
    } finally {
      setBusy('');
    }
  }

  return (
    <>
      {!liveOrderEnabled && (
        <p className="helper kr-rank-dry-note">
          실주문이 꺼져 있습니다. 랭킹 조회와 판단 기록만 남기고 실제 주문은 보내지 않습니다.
        </p>
      )}

      <section className="panel section account-summary-panel">
        <div className="panel-heading">
          <div>
            <h3>연결 계좌</h3>
            <p>미국 종목을 살 때 사용할 수 있는 USD 금액을 조회합니다.</p>
          </div>
          <button type="button" className="ghost sm" disabled={budgetPreviewLoading} onClick={loadBudgetPreview}>
            {budgetPreviewLoading ? '조회 중…' : '잔액 조회'}
          </button>
        </div>
        <div className="metric-grid compact-grid">
          <Metric
            label="USD 매수가능금액"
            value={budgetPreview?.error ? '조회 실패' : formatUsd(budgetPreview?.cashAvailable || 0)}
            hint={budgetPreview?.error || '바로 주문 가능'}
          />
          <Metric
            label="환전 후 가능"
            value={budgetPreview?.cashAvailableAfterFx ? formatUsd(budgetPreview.cashAvailableAfterFx) : '-'}
            hint="통합증거금/환전 반영"
          />
        </div>
      </section>

      <section className="panel section">
        <div className="panel-heading">
          <div>
            <h3>전략 요약</h3>
            <p>미국장이 열려 있는 동안 상승률 1위 종목을 따라가되, 손절이나 장 마감 기준에 닿으면 매수를 멈추는 전략입니다.</p>
          </div>
        </div>
        <ul className="kr-rank-rule-list">
          <li>미국 정규장 동안 1분마다 상승률 랭킹을 확인합니다.</li>
          <li>보유 종목이 없으면 그 시점의 1위 종목을 삽니다.</li>
          <li>익절 기준에 닿아도 보유 종목이 계속 1위라면 팔지 않습니다. 같은 종목을 팔고 바로 다시 사는 일을 줄이기 위해서입니다.</li>
          <li>보유 종목이 1위에서 밀렸고 익절 기준에 닿으면 전량 매도한 뒤 다음 1위 종목을 기다립니다.</li>
          <li>손절이 한 번 발생하면 그 미국 거래일에는 더 사지 않습니다.</li>
          <li>KST 04:30 이후에는 보유 종목을 정리하고 신규 매수를 멈춥니다.</li>
          <li>누적 목표 수익률을 켜면 시작 자본 대비 목표에 닿는 순간 전략을 종료합니다.</li>
          <li>주문은 1주 단위입니다. 수수료, 세금, 환율 차이는 계산에 넣지 않습니다.</li>
        </ul>
      </section>

      <section className="panel section">
        <div className="panel-heading">
          <div>
            <h3>전략 만들기</h3>
          </div>
        </div>
        <form className="mode-form kr-rank-form" onSubmit={submitStrategy}>
          <label className="checkbox-field">
            <input
              type="checkbox"
              checked={form.autoBudgetEnabled}
              onChange={(event) => setForm({ ...form, autoBudgetEnabled: event.target.checked })}
            />
            <span>매수가능금액 전액으로 매수</span>
          </label>
          {!form.autoBudgetEnabled && (
            <label>
              <span>매수 금액 (USD)</span>
              <input
                type="number"
                min="1"
                step="0.01"
                value={form.fixedBuyUsdAmount}
                onFocus={loadBudgetPreview}
                onChange={(event) => setForm({ ...form, fixedBuyUsdAmount: event.target.value })}
                required
              />
              <UsdBalanceHint preview={budgetPreview} loading={budgetPreviewLoading}
                onApply={(amount) => setForm((current) => ({ ...current, fixedBuyUsdAmount: String(Math.floor(amount * 100) / 100) }))} />
            </label>
          )}
          <label>
            <span>익절 (%)</span>
            <input type="number" min="0.1" step="0.1" value={form.targetProfitPercent}
              onChange={(event) => setForm({ ...form, targetProfitPercent: nonNegative(event.target.value) })} required />
          </label>
          <label>
            <span>손절 (%)</span>
            <input type="number" min="0.1" step="0.1" value={form.stopLossPercent}
              onChange={(event) => setForm({ ...form, stopLossPercent: nonNegative(event.target.value) })} required />
            <p className="helper">한 번 닿으면 해당 미국 거래일에는 더 사지 않습니다.</p>
          </label>
          <label>
            <span>강제 청산 시각 (KST)</span>
            <input type="time" value={form.forceCloseKst} max="11:59"
              onChange={(event) => setForm({ ...form, forceCloseKst: event.target.value })} required />
            <p className="helper">이 시각이 지나면 보유 종목을 정리하고 신규 매수를 멈춥니다.</p>
          </label>
          <label>
            <span>거래소</span>
            <select value={form.exchange} onChange={(event) => setForm({ ...form, exchange: event.target.value })}>
              <option value="ALL">전체</option>
              <option value="NAS">NASDAQ</option>
              <option value="NYS">NYSE</option>
              <option value="AMS">AMEX</option>
            </select>
          </label>
          <label className="checkbox-field">
            <input
              type="checkbox"
              checked={form.cycleTargetEnabled}
              onChange={(event) => setForm({ ...form, cycleTargetEnabled: event.target.checked })}
            />
            <span>누적 목표 수익률 도달 시 전략 종료</span>
          </label>
          {form.cycleTargetEnabled && (
            <label>
              <span>누적 목표 (%)</span>
              <input type="number" min="0.1" step="0.1" value={form.cycleTargetPercent}
                onChange={(event) => setForm({ ...form, cycleTargetPercent: nonNegative(event.target.value) })} required />
              <p className="helper">시작 시점 USD 매수가능금액보다 이만큼 늘면 보유분을 정리하고 전략을 종료합니다.</p>
            </label>
          )}
          <button type="submit" className="primary" disabled={busy === 'create'}>
            {busy === 'create' ? '저장 중…' : '전략 생성'}
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
                  <strong>미국장 랭킹 #{strategy.id}</strong>
                  <span className="strategy-chip-sub">
                  {strategy.autoBudgetEnabled ? '매수가능금액 자동 사용' : `${formatUsd(strategy.fixedBuyUsdAmount)} 고정`} · {EXCHANGE_LABELS[strategy.exchange] || strategy.exchange}
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
          {strategies.length === 0 && <div className="empty">아직 미국장 랭킹 전략이 없습니다.</div>}
        </div>
      </section>

      <section className="panel section">
        <div className="panel-heading">
          <div>
            <h3>전략 상세</h3>
            <p>{selected ? '미국장 랭킹 전략 상태와 최근 기록입니다.' : '위 목록에서 전략을 선택하세요.'}</p>
          </div>
        </div>
        {selected ? (
          <>
            <div className="metric-grid compact-grid">
              <Metric label="상태" value={selected.status} hint={selected.lastErrorMessage || '정상'} />
              <Metric label="예산 방식" value={selected.autoBudgetEnabled ? '매수가능금액 자동' : formatUsd(selected.fixedBuyUsdAmount)} hint={EXCHANGE_LABELS[selected.exchange] || selected.exchange} />
              <Metric
                label="익절/손절"
                value={`+${pct(selected.targetProfitRate)} / -${pct(selected.stopLossRate)}`}
                hint={selected.cycleTargetProfitRate ? `누적 목표 +${pct(selected.cycleTargetProfitRate)}` : '누적 목표 없음'}
              />
              <Metric label="현재 보유" value={selected.holdingSymbol || '무보유'} hint={selected.holdingSymbol ? `${formatNumber(selected.holdingQuantity)}주 · 평단 ${formatUsd(selected.holdingAveragePrice)}` : '랭킹 진입 대기'} />
            </div>
            <div className="metric-grid compact-grid">
              <Metric label="오늘 매매" value={`${todayTradeCount}회`} hint={trades[0]?.tradeDate || '없음'} />
              <Metric
                label="오늘 잠금"
                value={selected.dayLockedOut ? '켜짐' : '꺼짐'}
                hint={selected.dayLockedOut ? lockReasonLabel(selected.dayLockReason) : '매수 가능'}
              />
              <Metric label="강제 청산" value={`${selected.forceCloseKst} KST`} hint="이후 신규 매수 중단" />
              <Metric label="정규장" value={isUsRegularSessionNow() ? '열림' : '닫힘'} hint="ET 09:30~16:00" />
            </div>
            <div className="metric-grid compact-grid">
              <Metric
                label="사이클 상태"
                value={selected.cycleCompleted ? '종료됨' : selected.cycleTargetProfitRate ? '진행 중' : '미사용'}
                hint={selected.cycleCompleted ? (selected.cycleCompletedAt || '') : (selected.cycleTargetProfitRate ? `목표 +${pct(selected.cycleTargetProfitRate)}` : '누적 목표 미설정')}
              />
              <Metric
                label="기준 자본"
                value={selected.cycleBaselineUsd ? formatUsd(selected.cycleBaselineUsd) : '-'}
                hint="시작 시점 USD 매수가능금액"
              />
            </div>
            <div className="auto-action-row">
              <button type="button" className="primary" disabled={busy === 'start' || selected.status === 'RUNNING'}
                onClick={() => runAction(startUsRankStrategy, 'start')}>시작</button>
              <button type="button" className="ghost danger-button" disabled={busy === 'stop' || selected.status !== 'RUNNING'}
                onClick={() => runAction(stopUsRankStrategy, 'stop')}>종료</button>
              <button type="button" className="ghost" disabled={busy === 'evaluate'}
                onClick={() => runAction(evaluateUsRankStrategy, 'evaluate')}>지금 평가</button>
            </div>
            <p className="auto-log-note">
              시작 후 서버는 미국 정규장에 1분마다 랭킹, 보유 수량, 매수가능금액, 미체결 주문을 확인합니다. 손절 또는 강제 청산이 발생하면 같은 미국 거래일에는 신규 매수를 하지 않습니다.
            </p>
            <DecisionLogTable decisions={decisions} />
            <OrdersTable orders={orders} />
            <TradeTable trades={trades} />
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

function UsdBalanceHint({ preview, loading, onApply }) {
  if (loading) return <p className="helper">한국투자증권에서 잔액을 확인하는 중입니다...</p>;
  if (!preview) return <p className="helper">칸을 누르면 미국 종목 매수가능금액을 보여 드립니다.</p>;
  if (preview.error) return <p className="helper">잔액 확인 실패: {preview.error}</p>;
  const cash = Number(preview.cashAvailable || 0);
  const afterFx = Number(preview.cashAvailableAfterFx || 0);
  const amount = cash > 0 ? cash : afterFx;
  if (amount <= 0) return <p className="helper">미국 종목 매수가능금액이 0입니다. 환전 또는 통합증거금 설정을 확인하세요.</p>;
  return (
    <div className="budget-hint">
      <p className="helper">한국투자증권 매수가능금액을 기준으로 채우려면 누르세요. 직접 입력해도 됩니다.</p>
      <div className="budget-hint-actions">
        <button type="button" className="ghost sm" onClick={() => onApply(amount)}>
          현재 잔고로 채우기 · {formatUsd(amount)}
        </button>
      </div>
    </div>
  );
}

function DecisionLogTable({ decisions }) {
  return (
    <section className="subsection">
      <h4>판단 로그</h4>
      <p className="helper">랭킹 조회, 종목 선택, 보유 평가, 주문 예정 기록입니다.</p>
      <div className="table-wrap">
        <table className="decision-log-table">
          <thead>
            <tr>
              <th>시간</th>
              <th>판단</th>
              <th>출처</th>
              <th>종목</th>
              <th>현재가</th>
              <th>보유</th>
              <th>평가금액</th>
              <th>예상 금액</th>
              <th>사유</th>
            </tr>
          </thead>
          <tbody>
            {decisions.map((log) => {
              const evaluationAmount = Number(log.holdingQuantity || 0) * Number(log.currentPrice || 0);
              return (
                <tr key={log.id}>
                  <td className="muted">{formatDate(log.createdAt)}</td>
                  <td><span className={`decision compact ${String(log.decision).toLowerCase()}`}>{decisionLabel(log)}</span></td>
                  <td className="muted">{log.evaluationSource === 'MANUAL' ? '수동' : '스케줄러'}</td>
                  <td>{log.selectedSymbol ? `${log.selectedSymbolName || ''} ${log.selectedSymbol}`.trim() : '-'}</td>
                  <td>{log.currentPrice > 0 ? formatUsd(log.currentPrice) : '-'}</td>
                  <td>{log.holdingQuantity > 0 ? `${formatNumber(log.holdingQuantity)}주` : '-'}</td>
                  <td>{evaluationAmount > 0 ? formatUsd(evaluationAmount) : '-'}</td>
                  <td>{log.expectedAmount > 0 ? formatUsd(log.expectedAmount) : '-'}</td>
                  <td className="muted">{log.reason}</td>
                </tr>
              );
            })}
            {decisions.length === 0 && <tr><td className="empty-row" colSpan="9">아직 판단 로그가 없습니다.</td></tr>}
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
              <th>종목</th>
              <th>구분</th>
              <th>매도 사유</th>
              <th>상태</th>
              <th>수량</th>
              <th>가격</th>
              <th>총 금액</th>
              <th>사유</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => (
              <tr key={order.id}>
                <td className="muted">{formatDate(order.createdAt)}</td>
                <td>{order.symbolName ? `${order.symbolName} ${order.symbol}` : order.symbol}</td>
                <td>{order.side === 'BUY' ? '매수' : '매도'}</td>
                <td>{order.sellReason ? sellReasonLabel(order.sellReason) : '-'}</td>
                <td><span className={`badge ${order.status === 'DRY_RUN' ? 'warning' : order.status === 'FAILED' || order.status === 'REJECTED' ? 'danger' : 'active'}`}>{orderStatusLabel(order.status)}</span></td>
                <td>{formatNumber(order.quantity)}주</td>
                <td>{formatUsd(order.orderPrice)}</td>
                <td>{formatUsd(order.estimatedAmount)}</td>
                <td className="muted">{order.decisionReason}{order.errorMessage ? ` / ${order.errorMessage}` : ''}</td>
              </tr>
            ))}
            {orders.length === 0 && <tr><td className="empty-row" colSpan="9">아직 주문 이력이 없습니다.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function TradeTable({ trades }) {
  return (
    <section className="subsection">
      <h4>매매 사이클</h4>
      <p className="helper">한 번 매수하고 매도까지 끝나는 과정을 하나의 사이클로 기록합니다.</p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>거래일</th>
              <th>회차</th>
              <th>상태</th>
              <th>종목</th>
              <th>선택가</th>
              <th>등락률</th>
              <th>매수가</th>
              <th>매도가</th>
              <th>수익률</th>
            </tr>
          </thead>
          <tbody>
            {trades.map((trade) => (
              <tr key={trade.id}>
                <td className="muted">{trade.tradeDate}</td>
                <td>{trade.tradeSeq}</td>
                <td>{tradeStatusLabel(trade.status)}</td>
                <td>{trade.symbol ? `${trade.symbolName || ''} ${trade.symbol}`.trim() : '-'}</td>
                <td>{trade.selectedPrice > 0 ? formatUsd(trade.selectedPrice) : '-'}</td>
                <td>{trade.selectedFluctuationRate != null ? `${(trade.selectedFluctuationRate * 100).toFixed(2)}%` : '-'}</td>
                <td>{trade.entryPrice > 0 ? `${formatUsd(trade.entryPrice)} · ${formatNumber(trade.entryQuantity)}주` : '-'}</td>
                <td>{trade.exitPrice > 0 ? `${formatUsd(trade.exitPrice)} · ${sellReasonLabel(trade.exitReason)}` : '-'}</td>
                <td>{trade.profitRate != null ? `${(trade.profitRate * 100).toFixed(2)}%` : '-'}</td>
              </tr>
            ))}
            {trades.length === 0 && <tr><td className="empty-row" colSpan="9">아직 매매 사이클이 없습니다.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function defaultForm() {
  return {
    autoBudgetEnabled: true,
    fixedBuyUsdAmount: '1000',
    targetProfitPercent: '2',
    stopLossPercent: '5',
    forceCloseKst: '04:30',
    exchange: 'NAS',
    cycleTargetEnabled: false,
    cycleTargetPercent: '20'
  };
}

function nonNegative(value) {
  if (String(value).startsWith('-')) return '0';
  return value;
}

function decisionLabel(log) {
  if (log.decision === 'BUY') return '매수';
  if (log.decision === 'SELL') return '매도';
  if (log.decision === 'HOLD') return '보유';
  if (log.decision === 'ERROR') return '오류';
  return '관망';
}

function sellReasonLabel(reason) {
  if (reason === 'TARGET') return '익절';
  if (reason === 'STOP_LOSS') return '손절';
  if (reason === 'FORCE_CLOSE') return '강제 청산';
  if (reason === 'CYCLE_COMPLETE') return '누적 목표 달성';
  return reason || '-';
}

function lockReasonLabel(reason) {
  if (reason === 'STOP_LOSS') return '손절로 오늘 매수 중단';
  if (reason === 'FORCE_CLOSE') return '강제 청산 후 오늘 매수 중단';
  return '오늘 매수 중단';
}

function orderStatusLabel(status) {
  const labels = {
    DRY_RUN: '기록만',
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

function tradeStatusLabel(status) {
  const labels = {
    NO_CANDIDATE: '후보 없음',
    SELECTED: '선택',
    BOUGHT: '보유 중',
    CLOSED: '청산',
    FAILED: '실패',
    SKIPPED: '건너뜀'
  };
  return labels[status] || status;
}

function pct(rate) {
  return `${(Number(rate || 0) * 100).toFixed(1)}%`;
}

function formatUsd(value) {
  return `${Number(value || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD`;
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString('ko-KR', { maximumFractionDigits: 4 });
}

function formatDate(value) {
  if (!value) return '-';
  const raw = String(value).trim();
  const normalized = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/.test(raw)
    ? `${raw.replace(' ', 'T')}Z`
    : raw;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
}

function isUsRegularSessionNow() {
  const parts = {};
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  for (const part of formatter.formatToParts(new Date())) {
    if (part.type !== 'literal') parts[part.type] = part.value;
  }
  if (parts.weekday === 'Sat' || parts.weekday === 'Sun') return false;
  const hour = Number(parts.hour === '24' ? 0 : parts.hour);
  const minute = Number(parts.minute);
  const minutes = hour * 60 + minute;
  return minutes >= 9 * 60 + 30 && minutes < 16 * 60;
}
