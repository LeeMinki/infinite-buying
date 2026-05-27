import React, { useEffect, useMemo, useState } from 'react';
import {
  createAutoTradingStrategy,
  deleteAutoTradingStrategy,
  evaluateAutoTradingStrategy,
  getAutoTradingAccountSummary,
  getAutoTradingBuyingPowerPreview,
  getAutoTradingDashboard,
  getAutoTradingSettings,
  getCurrentPrice,
  listAutoTradingDecisions,
  listAutoTradingOrders,
  listAutoTradingPositions,
  listAutoTradingStrategies,
  refreshAutoTradingOrder,
  startAutoTradingStrategy,
  stopAutoTradingStrategy,
  updateAutoTradingLiveOrder
} from '../api/client.js';
import { LaorStrategyGuide } from '../components/LaorStrategyGuide.jsx';
import { StockSearchField } from '../components/StockSearchField.jsx';
import { KrRankAutoTradingPanel } from './KrRankAutoTradingPanel.jsx';
import { UsRankAutoTradingPanel } from './UsRankAutoTradingPanel.jsx';

export function AutoTradingPage({ onBack, initialStrategy }) {
  const [tab, setTab] = useState(initialStrategy ? 'laor' : 'kr-rank');
  const [settings, setSettings] = useState(null);
  const [dashboard, setDashboard] = useState(null);
  const [strategies, setStrategies] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [orders, setOrders] = useState([]);
  const [decisions, setDecisions] = useState([]);
  const [positions, setPositions] = useState([]);
  const [accountSummary, setAccountSummary] = useState(null);
  const [budgetPreview, setBudgetPreview] = useState(null);
  const [budgetPreviewLoading, setBudgetPreviewLoading] = useState(false);
  const [referencePrice, setReferencePrice] = useState(0);
  const [form, setForm] = useState(defaultForm);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const selected = useMemo(
    () => strategies.find((strategy) => strategy.id === selectedId) || strategies[0] || null,
    [strategies, selectedId]
  );

  async function refresh(nextSelectedId = selectedId) {
    const [nextSettings, nextDashboard, nextStrategies] = await Promise.all([
      getAutoTradingSettings(),
      getAutoTradingDashboard(),
      listAutoTradingStrategies()
    ]);
    setSettings(nextSettings);
    setDashboard(nextDashboard);
    setStrategies(nextStrategies);
    const target = nextSelectedId || nextStrategies[0]?.id || null;
    setSelectedId(target);
    if (target) {
      const [nextOrders, nextDecisions, nextPositions] = await Promise.all([
        listAutoTradingOrders(target),
        listAutoTradingDecisions(target),
        listAutoTradingPositions(target)
      ]);
      setOrders(nextOrders);
      setDecisions(nextDecisions);
      setPositions(nextPositions);
      try {
        setAccountSummary(await getAutoTradingAccountSummary(target));
      } catch (err) {
        setAccountSummary({ error: err.message });
      }
    } else {
      setOrders([]);
      setDecisions([]);
      setPositions([]);
      setAccountSummary(null);
    }
  }

  useEffect(() => {
    refresh().catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    if (!initialStrategy) return;
    const symbol = initialStrategy.stockCode || initialStrategy.symbol || '';
    const market = initialStrategy.market || inferMarket(symbol);
    const totalBudget = Number(initialStrategy.totalBudget || 4000);
    const splitCount = Number(initialStrategy.splitCount || 40);
    setForm((current) => ({
      ...current,
      symbol,
      symbolName: initialStrategy.stockName || initialStrategy.symbolName || symbol,
      market,
      currency: initialStrategy.currency || inferCurrency(market),
      exchange: initialStrategy.exchange || current.exchange,
      totalBudget: String(totalBudget),
      splitCount: String(splitCount),
      targetProfitPercent: String(Number(initialStrategy.targetProfitRate || 0.1) * 100),
      bigBuyPremiumPercent: initialStrategy.bigBuyPremiumRate == null ? '' : String(Number(initialStrategy.bigBuyPremiumRate) * 100)
    }));
  }, [initialStrategy]);

  async function submitStrategy(event) {
    event.preventDefault();
    setBusy('create');
    setError('');
    setMessage('');
    try {
      const created = await createAutoTradingStrategy({
        symbol: form.symbol,
        symbolName: form.symbolName,
        market: form.market,
        currency: form.currency,
        exchange: form.exchange,
        totalBudget: Number(form.totalBudget),
        splitCount: Number(form.splitCount),
        targetProfitRate: Number(form.targetProfitPercent) / 100,
        bigBuyPremiumRate: form.bigBuyPremiumPercent === '' ? null : Number(form.bigBuyPremiumPercent) / 100,
        referencePrice
      });
      setMessage(`${created.symbol} 자동매매 전략을 만들었습니다.`);
      await refresh(created.id);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  }

  async function toggleLiveOrder(nextValue) {
    setBusy('toggle');
    setError('');
    setMessage('');
    try {
      const next = await updateAutoTradingLiveOrder(nextValue);
      setSettings(next);
      setMessage(next.liveOrderEnabled ? '실주문 모드로 전환했습니다.' : '기록 모드로 전환했습니다. 주문은 전송하지 않습니다.');
      await refresh(selectedId);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  }

  async function loadBudgetPreview({ market, symbol, exchange }) {
    if (!symbol || !market) {
      setBudgetPreview(null);
      setReferencePrice(0);
      return;
    }
    setBudgetPreviewLoading(true);
    try {
      const preview = await getAutoTradingBuyingPowerPreview({ market, symbol, exchange });
      setBudgetPreview(preview);
    } catch (err) {
      setBudgetPreview({ error: err.message });
    } finally {
      setBudgetPreviewLoading(false);
    }
    try {
      const price = await getCurrentPrice(symbol, { market, exchange });
      setReferencePrice(Number(price?.price) || 0);
    } catch (err) {
      setReferencePrice(0);
    }
  }

  async function removeStrategy(strategy) {
    if (!strategy) return;
    if (strategy.status === 'RUNNING') {
      const proceed = window.confirm(
        `'${strategy.symbol}' 전략은 실행 중입니다.\n바로 삭제하면 다음 평가가 멈추고, 이미 접수된 주문은 자동 취소되지 않습니다.\n그래도 삭제할까요?`
      );
      if (!proceed) return;
    } else {
      const proceed = window.confirm(
        `'${strategy.symbol}' 전략과 관련된 모든 판단·주문·포지션 기록을 삭제합니다. 되돌릴 수 없습니다. 계속할까요?`
      );
      if (!proceed) return;
    }
    setBusy(`delete-${strategy.id}`);
    setError('');
    setMessage('');
    try {
      await deleteAutoTradingStrategy(strategy.id);
      setMessage(`'${strategy.symbol}' 전략을 삭제했습니다.`);
      const nextId = selected?.id === strategy.id ? null : selected?.id;
      await refresh(nextId);
    } catch (err) {
      setError(err.message || '전략 삭제에 실패했습니다.');
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
      if (label === 'start') setMessage('자동매매를 시작했습니다. 서버가 최대 10분 간격으로 평가하고 로그를 남깁니다.');
      if (label === 'stop') setMessage('자동매매를 종료했습니다. 이미 접수된 주문은 자동 취소하지 않습니다.');
      if (label === 'evaluate') setMessage(result?.decision?.reason || '평가를 완료했습니다.');
      await refresh(selected.id);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  }

  async function refreshOrder(id) {
    setBusy(`order-${id}`);
    setError('');
    try {
      await refreshAutoTradingOrder(id);
      await refresh(selected?.id);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  }

  return (
    <section className="mode-workspace auto-trading-page">
      <header className="page-header">
        <div>
          <h1>자동매매</h1>
          <p>선택한 종목의 가격과 계좌 상태를 주기적으로 확인하고, 설정에 따라 기록 모드 또는 실주문 모드로 처리합니다.</p>
        </div>
        <button type="button" className="ghost" onClick={onBack}>돌아가기</button>
      </header>

      <section className={`live-toggle-panel ${settings?.liveOrderEnabled ? 'live' : 'dry'}`}>
        <div>
          <span className="eyebrow">실주문 실행</span>
          <h2>{settings?.liveOrderEnabled ? '실주문 모드' : '기록 모드'}</h2>
          <p>
            {settings?.liveOrderEnabled
              ? '실제 주문 전 미체결 주문이 없는지, 같은 주문이 중복되지 않는지, 주문 수량이 0보다 큰지, 매수가능금액·보유 수량이 충분한지 확인합니다. 모두 통과한 주문만 KIS로 전송합니다.'
              : '자동매매는 계속 평가하지만 주문은 전송하지 않습니다. 현재가, 잔고, 매수가능금액을 확인하고 판단 로그와 모의 주문 기록만 남깁니다.'}
          </p>
        </div>
        <button
          type="button"
          className={settings?.liveOrderEnabled ? 'danger-button' : 'primary'}
          disabled={busy === 'toggle'}
          onClick={() => toggleLiveOrder(!settings?.liveOrderEnabled)}
        >
          {settings?.liveOrderEnabled ? '실주문 끄기' : '실주문 켜기'}
        </button>
      </section>

      <nav className="strategy-type-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'kr-rank'}
          className={`strategy-type-tab ${tab === 'kr-rank' ? 'active' : ''}`}
          onClick={() => setTab('kr-rank')}
        >
          한국 국장 상승률 랭킹 전략
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'us-rank'}
          className={`strategy-type-tab ${tab === 'us-rank' ? 'active' : ''}`}
          onClick={() => setTab('us-rank')}
        >
          미국장 상승률 랭킹 전략
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'laor'}
          className={`strategy-type-tab ${tab === 'laor' ? 'active' : ''}`}
          onClick={() => setTab('laor')}
        >
          라오어 무한매수법
        </button>
      </nav>

      {tab === 'kr-rank' && (
        <KrRankAutoTradingPanel liveOrderEnabled={settings?.liveOrderEnabled} />
      )}

      {tab === 'us-rank' && (
        <UsRankAutoTradingPanel liveOrderEnabled={settings?.liveOrderEnabled} />
      )}

      {tab === 'laor' && (
        <>
      {selected?.market && selected.market !== 'KR' && (
        <ForeignCurrencyGuide />
      )}

      <AccountSummaryPanel
        summary={accountSummary}
        fallbackCurrency={selected?.currency || 'KRW'}
        liveOrderEnabled={settings?.liveOrderEnabled}
        hasStrategy={Boolean(selected)}
      />

      <section className="metric-grid auto-metrics">
        <Metric label="실행 중 전략" value={dashboard?.stats?.runningStrategyCount || 0} hint="스케줄러 평가 대상" />
        <Metric label="오류 전략" value={dashboard?.stats?.errorStrategyCount || 0} hint="확인 후 재시작 필요" />
        <Metric label="오늘 주문 금액" value={formatMoney(dashboard?.stats?.todayOrderAmount || 0, selected?.currency || 'KRW')} hint="실주문 접수 기준" />
        <Metric label="최근 판단" value={dashboard?.recentDecisions?.[0]?.decision || '-'} hint={dashboard?.recentDecisions?.[0]?.reason || '아직 판단 없음'} />
      </section>

      <LaorStrategyGuide mode="auto" />

      <section className="panel section">
        <div className="panel-heading">
          <div>
            <h3>전략 만들기</h3>
            <p>종목을 선택하고 예산을 정합니다. 기본 분할 회차는 40회, 목표 수익률은 10%입니다.</p>
            <p className="helper">
              <b>1주 단위 매수만 지원</b>됩니다 (KIS Open API 표준 주문 기준). 한 회차는 하루씩 진행하며, 첫날은 시작가에 한 번 매수하고 둘째 날부터 회차 예산을 평단가 매수·큰수 매수로 나눠 하루 최대 두 번 매수합니다.
            </p>
          </div>
        </div>
        <form className="mode-form auto-strategy-form" onSubmit={submitStrategy}>
          <StockSearchField
            label="종목 검색"
            stockCode={form.symbol}
            stockName={form.symbolName}
            helper="KIS 검색 결과를 선택하세요. 예: 005930, TQQQ"
            onSelect={(stock) => {
              const sym = stock.symbol || stock.stockCode || '';
              const mkt = stock.market || inferMarket(sym);
              const cur = stock.currency || inferCurrency(mkt);
              const exchange = stock.exchange;
              setForm((prev) => ({
                ...prev,
                symbol: sym,
                symbolName: stock.name || stock.stockName || '',
                market: mkt,
                currency: cur,
                exchange: exchange || ''
              }));
              loadBudgetPreview({ market: mkt, symbol: sym, exchange });
            }}
            onClear={() => setForm({ ...form, symbolName: '' })}
          />
          <label>
            <span>총 예산 ({form.currency})</span>
            <input type="number" min="1" step="0.01" value={form.totalBudget} onChange={(event) => setForm({ ...form, totalBudget: event.target.value })} required />
            <BudgetHint
              preview={budgetPreview}
              loading={budgetPreviewLoading}
              currentCurrency={form.currency}
              onApply={(amount) => setForm((prev) => ({
                ...prev,
                totalBudget: String(amount)
              }))}
            />
          </label>
          <label>
            <span>분할 회차</span>
            <input
              type="number"
              min="1"
              step="1"
              max={computeMaxSplit(form.totalBudget, referencePrice) || undefined}
              value={form.splitCount}
              onChange={(event) => {
                const next = event.target.value;
                const cap = computeMaxSplit(form.totalBudget, referencePrice);
                if (cap > 0 && Number(next) > cap) {
                  setForm({ ...form, splitCount: String(cap) });
                } else {
                  setForm({ ...form, splitCount: next });
                }
              }}
              required
            />
            <p className="helper">
              {referencePrice > 0
                ? `현재가 ${formatMoney(referencePrice, form.currency)} 기준 최대 ${computeMaxSplit(form.totalBudget, referencePrice)}분할. 한 회차의 절반이 1주 가격 이상이어야 KIS 표준 주문이 가능합니다.`
                : '종목 선택 후 현재가 기준 최대 분할 회차가 안내됩니다. 1주 단위 매수만 지원되므로 회차가 너무 많으면 매수가 미뤄집니다.'}
            </p>
          </label>
          <label>
            <span>목표 수익률 (%)</span>
            <input type="number" min="0.1" step="0.1" value={form.targetProfitPercent} onChange={(event) => setForm({ ...form, targetProfitPercent: event.target.value })} required />
          </label>
          <label>
            <span>큰수 매수 여유율 (%)</span>
            <input type="number" min="0" step="0.1" value={form.bigBuyPremiumPercent} onChange={(event) => setForm({ ...form, bigBuyPremiumPercent: nonNegativeInput(event.target.value) })} />
            <p className="helper">
              내 평단가보다 몇 % 높은 가격까지 ‘큰수 매수’ 지정가를 걸지 정합니다. 예: 2를 넣으면 평단가 +2%까지 매수합니다. 비워두면 <b>평단가 +10%</b>로 자동 적용합니다(분할 회차와 무관).
              {' '}{form.bigBuyPremiumPercent === '' ? '지금은 비어 있어 자동값 10%.' : `직접 입력: ${form.bigBuyPremiumPercent}%.`}
            </p>
          </label>
          <button type="submit" className="primary" disabled={busy === 'create'}>{busy === 'create' ? '저장 중...' : '전략 생성'}</button>
        </form>
      </section>

      <section className="panel section">
        <div className="panel-heading">
          <div>
            <h3>전략 목록</h3>
            <p>RUNNING 상태인 전략만 서버 스케줄러가 평가합니다. 카드를 누르면 아래 전략 상세가 그 전략 기준으로 갱신됩니다.</p>
          </div>
          <span className="heading-meta">{strategies.length}개</span>
        </div>
        <div className="strategy-chip-list">
          {strategies.map((strategy) => (
            <div
              key={strategy.id}
              className={`strategy-chip ${selected?.id === strategy.id ? 'active' : ''}`}
            >
              <button
                type="button"
                className="strategy-chip-body"
                onClick={() => refresh(strategy.id)}
              >
                <span className="strategy-chip-symbol">
                  <strong>{strategy.symbol}</strong>
                  <span className="strategy-chip-sub">{strategy.symbolName || strategy.market} · {strategy.currency}</span>
                </span>
                <span className={`badge ${strategy.status === 'RUNNING' ? 'active' : strategy.status === 'ERROR' ? 'danger' : 'warning'}`}>
                  {strategy.status}
                </span>
              </button>
              <button
                type="button"
                className="ghost danger-button sm strategy-chip-delete"
                disabled={busy === `delete-${strategy.id}`}
                title={strategy.status === 'RUNNING' ? '실행 중인 전략은 먼저 종료해야 합니다.' : '전략과 관련된 모든 기록을 삭제합니다.'}
                onClick={() => removeStrategy(strategy)}
              >
                삭제
              </button>
            </div>
          ))}
          {strategies.length === 0 && <div className="empty">아직 자동매매 전략이 없습니다.</div>}
        </div>
      </section>

      <section className="panel section">
        <div className="panel-heading">
          <div>
            <h3>전략 상세</h3>
            <p>{selected ? `${selected.symbol} 자동매매 상태와 최근 기록입니다.` : '위 전략 목록에서 카드를 선택하세요.'}</p>
          </div>
        </div>
        {selected ? (
          <>
            <div className="metric-grid compact-grid">
              <Metric label="상태" value={selected.status} hint={selected.lastErrorMessage || '정상'} />
              <Metric label="회차" value={`${selected.currentRound}/${selected.splitCount}`} hint={`1회 매수금 ${formatMoney(selected.buyAmountPerRound, selected.currency)}`} />
              <Metric label="목표 수익률" value={`${(selected.targetProfitRate * 100).toFixed(1)}%`} hint="평단가 기준" />
              <Metric label="큰수 매수 여유율" value={`+${((selected.effectiveBigBuyPremiumRate ?? selected.bigBuyPremiumRate ?? 0) * 100).toFixed(4)}%`} hint={selected.bigBuyPremiumRate == null ? '분할 회차 기반 자동값' : '사용자 입력값'} />
              <Metric label="마지막 판단" value={selected.lastDecision || '-'} hint={selected.lastEvaluatedAt || '아직 없음'} />
            </div>
            <div className="auto-action-row">
              <button type="button" className="primary" disabled={busy === 'start' || selected.status === 'RUNNING'} onClick={() => runAction(startAutoTradingStrategy, 'start')}>시작</button>
              <button type="button" className="ghost danger-button" disabled={busy === 'stop' || selected.status !== 'RUNNING'} onClick={() => runAction(stopAutoTradingStrategy, 'stop')}>종료</button>
              <button type="button" className="ghost" disabled={busy === 'evaluate'} onClick={() => runAction(evaluateAutoTradingStrategy, 'evaluate')}>지금 평가</button>
            </div>
            <p className="auto-log-note">
              시작 후 서버는 최대 10분 간격으로 가격, 계좌 잔액, 보유 수량, 미체결 주문, 현재 설정을 확인하고 판단 로그를 남깁니다.
            </p>
            <LatestPosition positions={positions} currency={selected.currency} />
            <OrdersTable orders={orders} onRefresh={refreshOrder} busy={busy} />
            <DecisionLogTable decisions={decisions} currency={selected.currency} />
          </>
        ) : (
          <div className="empty">자동매매 전략을 만들면 상세가 표시됩니다.</div>
        )}
      </section>

      {message && <p className="success">{message}</p>}
      {error && <p className="error">{error}</p>}
        </>
      )}
    </section>
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

function BudgetHint({ preview, loading, currentCurrency, onApply }) {
  if (loading) {
    return <p className="helper">한국투자증권에서 잔액을 확인하는 중입니다…</p>;
  }
  if (!preview) {
    return <p className="helper">종목을 선택하면 한국투자증권에 등록된 매수가능금액을 기준으로 추천 예산을 보여드립니다.</p>;
  }
  if (preview.error) {
    return <p className="helper">잔액 확인 실패: {preview.error}</p>;
  }
  const cur = preview.currency || currentCurrency || '';
  const cash = Number(preview.cashAvailable || 0);
  const afterFx = Number(preview.cashAvailableAfterFx || 0);
  const candidates = [];
  if (cash > 0) candidates.push({ label: '현재 잔고로 가능', amount: cash, hint: `${cur} ${formatNumber(cash)}` });
  if (afterFx > 0) candidates.push({ label: '환전 후 가능', amount: afterFx, hint: `${cur} ${formatNumber(afterFx)} (환율 적용)` });
  if (candidates.length === 0) {
    return (
      <p className="helper">
        한국투자증권 잔액으로 살 수 있는 금액이 현재 0입니다. 원화만 있다면 통합증거금을 신청하거나, HTS/MTS에서 미리 환전한 뒤 다시 시도하세요.
      </p>
    );
  }
  return (
    <div className="budget-hint">
      <p className="helper">한국투자증권 매수가능금액을 기준으로 채우려면 아래 버튼을 누르세요. 직접 입력해도 됩니다.</p>
      <div className="budget-hint-actions">
        {candidates.map((c) => (
          <button
            type="button"
            key={c.label}
            className="ghost sm"
            onClick={() => onApply(c.amount)}
          >
            {c.label} · {c.hint}
          </button>
        ))}
      </div>
    </div>
  );
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function ForeignCurrencyGuide() {
  return (
    <section className="panel section foreign-currency-guide">
      <div className="panel-heading">
        <div>
          <h3>원화로 입금하고 해외 종목을 살 수 있나요?</h3>
          <p>한국투자증권은 주문이 나갈 때 원화를 자동으로 외화로 바꿔주지 않습니다. 미리 준비가 필요합니다.</p>
        </div>
      </div>
      <div className="foreign-currency-body">
        <p>방법은 두 가지입니다.</p>
        <ol>
          <li>
            한국투자증권에 <b>통합증거금</b>을 신청하면 됩니다. 그러면 계좌의 원화가 환율로 계산되어 해외 매수가능금액에 더해지고, 환전을 따로 하지 않아도 해외 종목을 살 수 있습니다.
          </li>
          <li>
            아니면 HTS나 MTS에서 <b>원화를 미리 외화로 환전</b>해 두세요. 환전해 둔 외화 잔고로 매수가 됩니다.
          </li>
        </ol>
        <p>아래 "연결 계좌"의 매수가능금액이 0이면 둘 중 어느 것도 되어 있지 않은 상태입니다. 통합증거금 신청 여부나 환전 잔고부터 확인해 주세요.</p>
        <p className="helper">
          참고로 이 화면에 보이는 평가 금액과 매수가능금액은 해당 종목의 결제 통화 기준이고, 원화 환산 값은 별도로 보여주지 않습니다. 수수료·세금·환율 차이·슬리피지는 계산에서 빠집니다.
        </p>
      </div>
    </section>
  );
}

function AccountSummaryPanel({ summary, fallbackCurrency, liveOrderEnabled, hasStrategy }) {
  if (!hasStrategy) {
    return (
      <section className="panel section account-summary-panel">
        <div className="panel-heading">
          <div>
            <h3>연결 계좌</h3>
            <p>전략을 선택하거나 새로 만들면 해당 종목 기준으로 계좌 잔액을 조회합니다.</p>
          </div>
        </div>
      </section>
    );
  }
  if (!summary) {
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
  if (summary.error) {
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
        </div>
      </section>
    );
  }
  const currency = summary.currency || fallbackCurrency;
  const modeText = liveOrderEnabled
    ? '실주문 모드입니다. 안전 검증을 통과하면 실제 주문이 전송될 수 있습니다.'
    : '기록 모드입니다. 실제 주문은 전송하지 않고, 아래 잔액은 조회만 한 결과입니다.';
  return (
    <section className="panel section account-summary-panel">
      <div className="panel-heading">
        <div>
          <h3>연결 계좌</h3>
          <p>선택한 전략 종목 기준으로 한국투자증권에서 조회한 잔액과 미체결 주문입니다. 계좌번호 원문은 표시하지 않습니다.</p>
          <p className="helper">{modeText}</p>
        </div>
        <span className="heading-meta">{summary.checkedAt ? formatDate(summary.checkedAt) : '-'}</span>
      </div>
      <div className="metric-grid compact-grid">
        <Metric
          label="매수가능금액 (현재 잔고)"
          value={formatMoney(summary.cashAvailable, currency)}
          hint={summary.cashAvailable > 0 ? '바로 주문 가능' : '외화 잔고 없음'}
        />
        <Metric
          label="환전 후 매수가능금액"
          value={summary.cashAvailableAfterFx > 0 ? formatMoney(summary.cashAvailableAfterFx, currency) : '-'}
          hint={summary.exchangeRate > 0 ? `환율 1${currency} ≈ ${formatMoney(summary.exchangeRate, 'KRW')}` : '환율 정보 없음'}
        />
        <Metric label="보유 수량" value={formatQuantity(summary.holdingQuantity)} hint={`평단 ${formatMoney(summary.averagePrice, currency)}`} />
        <Metric label="미체결 주문" value={`${summary.openOrderCount || 0}건`} hint="있으면 신규 주문 차단" />
      </div>
      {summary.cashAvailable === 0 && summary.cashAvailableAfterFx > 0 && (
        <p className="helper">
          외화 잔고가 0이지만 원화 잔고가 있어 환전한다면 약 {formatMoney(summary.cashAvailableAfterFx, currency)} 만큼 매수 가능합니다.
          자동매매로 매수하려면 통합증거금을 신청하거나 한국투자증권에서 미리 환전해 주세요.
        </p>
      )}
      {summary.cashAvailable === 0 && summary.cashAvailableAfterFx === 0 && summary.market !== 'KR' && (
        <p className="helper">
          외화 잔고와 환전 가능 원화 잔고가 모두 0입니다. 한국투자증권 계좌에 원화나 외화를 먼저 입금하세요.
        </p>
      )}
    </section>
  );
}

function LatestPosition({ positions, currency }) {
  const latest = positions[0];
  return (
    <section className="subsection">
      <h4>
        최근 포지션 스냅샷
        {latest?.decision && (
          <span className={`decision compact ${String(latest.decision).toLowerCase()}`} style={{ marginLeft: 8 }}>
            그때 판단: {latest.decision}
          </span>
        )}
      </h4>
      <p className="helper">
        자동매매가 평가를 한 번 돌릴 때마다 그 시점의 KIS 잔고를 사진처럼 저장한 기록입니다.
        실시간 KIS 잔고가 아니라 마지막 평가 순간의 값이므로, 지금 KIS 화면과는 약간 다를 수 있습니다.
        오른쪽 위 배지는 그 스냅샷이 찍히던 때 자동매매가 내린 판단(매수/매도/관망 등)입니다.
      </p>
      {latest ? (
        <div className="metric-grid compact-grid">
          <Metric label="현재가" value={formatMoney(latest.currentPrice, currency)} hint={`기록 시각 ${formatDate(latest.capturedAt)}`} />
          <Metric label="보유 수량" value={formatQuantity(latest.quantity)} hint={`평단 ${formatMoney(latest.averagePrice, currency)}`} />
          <Metric label="평가금액" value={formatMoney(latest.evaluationAmount, currency)} hint={`미실현 ${formatMoney(latest.unrealizedProfit, currency)}`} />
          <Metric label="현금" value={formatMoney(latest.cashAvailable || 0, currency)} hint="평가 시점 KIS 매수가능금액" />
        </div>
      ) : <div className="empty">아직 평가가 한 번도 일어나지 않았습니다. 전략을 시작하거나 "지금 평가"를 눌러보세요.</div>}
    </section>
  );
}

function OrdersTable({ orders, onRefresh, busy }) {
  return (
    <section className="subsection">
      <h4>주문 이력</h4>
      <div className="table-wrap">
        <table className="decision-log-table">
          <thead>
            <tr>
              <th>시간</th>
              <th>구분</th>
              <th>주문 종류</th>
              <th>상태</th>
              <th>수량</th>
              <th>가격</th>
              <th>총 금액</th>
              <th>사유</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => {
              const totalAmount = Number(order.estimatedAmount) > 0
                ? Number(order.estimatedAmount)
                : Number(order.quantity || 0) * Number(order.orderPrice || 0);
              return (
                <tr key={order.id}>
                  <td className="muted">{formatDate(order.createdAt)}</td>
                  <td>{order.side}</td>
                  <td><span className="half-chip">{orderHalfLabel(order.half)}</span></td>
                  <td><span className={`badge ${order.status === 'DRY_RUN' ? 'warning' : order.status === 'FAILED' ? 'danger' : 'active'}`}>{orderStatusLabel(order.status)}</span></td>
                  <td>{formatQuantity(order.quantity)}</td>
                  <td>{formatMoney(order.orderPrice, order.currency)}</td>
                  <td>{totalAmount > 0 ? formatMoney(totalAmount, order.currency) : '-'}</td>
                  <td className="muted">
                    {order.decisionReason}
                    {(order.status === 'FAILED' || order.status === 'REJECTED') && order.errorMessage && (
                      <div className="order-error">⚠ 실패 사유: {order.errorMessage}</div>
                    )}
                  </td>
                  <td>
                    <button type="button" className="ghost sm" disabled={busy === `order-${order.id}` || order.status === 'DRY_RUN'} onClick={() => onRefresh(order.id)}>
                      갱신
                    </button>
                  </td>
                </tr>
              );
            })}
            {orders.length === 0 && <tr><td className="empty-row" colSpan="9">아직 주문 이력이 없습니다.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function DecisionLogTable({ decisions, currency }) {
  return (
    <section className="subsection">
      <h4>판단 로그</h4>
      <p className="helper">
        스케줄러가 자동으로 평가한 것은 스케줄러, 사용자가 "지금 평가" 버튼을 눌러서 만든 것은 수동으로 표시됩니다.
        "목표가까지"는 현재가가 익절 목표가에 도달하기까지 필요한 상승률입니다. 0% 이하면 이미 목표가에 닿았다는 뜻이고, 양수가 클수록 멀었다는 뜻입니다.
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>시간</th>
              <th>판단</th>
              <th>출처</th>
              <th>현재가</th>
              <th>평단가</th>
              <th>목표가</th>
              <th>목표가까지</th>
              <th>보유 수량</th>
              <th>평가금액</th>
              <th>예상 수량</th>
              <th>예상 금액</th>
              <th>미체결</th>
              <th>주문</th>
              <th>사유</th>
            </tr>
          </thead>
          <tbody>
            {decisions.map((log) => {
              const dist = log.distanceToTargetRate;
              const distLabel = dist == null
                ? '-'
                : dist <= 0
                  ? `도달 (${(Math.abs(dist) * 100).toFixed(2)}% 위)`
                  : `+${(dist * 100).toFixed(2)}%`;
              const distClass = dist == null ? '' : dist <= 0 ? 'positive' : 'neutral';
              const holdingValue = Number(log.holdingQuantity || 0) * Number(log.currentPrice || 0);
              return (
                <tr key={log.id}>
                  <td className="muted">{formatDate(log.createdAt)}</td>
                  <td><span className={`decision compact ${String(log.decision).toLowerCase()}`}>{log.decision}</span></td>
                  <td className="muted">{log.evaluationSource === 'MANUAL' ? '수동' : '스케줄러'}</td>
                  <td>{formatMoney(log.currentPrice, currency)}</td>
                  <td>{log.averagePrice > 0 ? formatMoney(log.averagePrice, currency) : '-'}</td>
                  <td>{log.targetSellPrice > 0 ? formatMoney(log.targetSellPrice, currency) : '-'}</td>
                  <td className={distClass}>{distLabel}</td>
                  <td>{log.holdingQuantity > 0 ? formatQuantity(log.holdingQuantity) : '-'}</td>
                  <td>{holdingValue > 0 ? formatMoney(holdingValue, currency) : '-'}</td>
                  <td>{log.expectedQuantity ? formatQuantity(log.expectedQuantity) : '-'}</td>
                  <td>{log.expectedAmount ? formatMoney(log.expectedAmount, currency) : '-'}</td>
                  <td className="muted">{log.openOrderCount || 0}</td>
                  <td className="muted">{log.orderId ? `#${log.orderId}` : '-'}</td>
                  <td className="muted">{log.reason}</td>
                </tr>
              );
            })}
            {decisions.length === 0 && <tr><td className="empty-row" colSpan="14">아직 판단 로그가 없습니다.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function defaultForm() {
  return {
    symbol: 'TQQQ',
    symbolName: '',
    market: 'US',
    currency: 'USD',
    exchange: 'NAS',
    totalBudget: '4000',
    splitCount: '40',
    targetProfitPercent: '10',
    bigBuyPremiumPercent: ''
  };
}

function inferMarket(symbol) {
  return /^\d{6}$/.test(String(symbol || '')) ? 'KR' : 'US';
}

function inferCurrency(market) {
  return market === 'KR' ? 'KRW' : 'USD';
}

function formatMoney(value, currency = 'KRW') {
  const maximumFractionDigits = currency === 'KRW' ? 0 : 2;
  return `${Number(value || 0).toLocaleString(currency === 'KRW' ? 'ko-KR' : 'en-US', { maximumFractionDigits })} ${currency}`;
}

function formatQuantity(value) {
  return Number(value || 0).toLocaleString('ko-KR', { maximumFractionDigits: 6 });
}

function formatPercent(rate) {
  return `${(Number(rate || 0) * 100).toFixed(2)}%`;
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

function orderHalfLabel(half) {
  const labels = {
    FIRST: '첫 매수',
    AVG: '평단가 매수',
    BIG: '큰수 매수',
    SELL: '매도'
  };
  return labels[half] || '-';
}

function nonNegativeInput(value) {
  if (String(value).startsWith('-')) return '0';
  return value;
}

function computeMaxSplit(totalBudget, referencePrice) {
  const budget = Number(totalBudget);
  const price = Number(referencePrice);
  if (!Number.isFinite(budget) || budget <= 0) return 0;
  if (!Number.isFinite(price) || price <= 0) return 0;
  return Math.max(1, Math.floor(budget / (price * 2)));
}
