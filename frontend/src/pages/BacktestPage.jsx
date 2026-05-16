import React, { useEffect, useMemo, useState } from 'react';
import { createBacktest, deleteBacktest, listBacktestTrades, listBacktests } from '../api/client.js';
import { AssetCurveChart } from '../components/AssetCurveChart.jsx';
import { AveragePriceChart } from '../components/AveragePriceChart.jsx';
import { LaorStrategyGuide } from '../components/LaorStrategyGuide.jsx';
import { ResultSummary } from '../components/ResultSummary.jsx';
import { RiskNotice } from '../components/RiskNotice.jsx';
import { StockSearchField } from '../components/StockSearchField.jsx';
import { TradeHistoryTable } from '../components/TradeHistoryTable.jsx';

export function BacktestPage({ onBack, initialStrategy }) {
  const [form, setForm] = useState(createDefaultForm);
  const [runs, setRuns] = useState([]);
  const [selectedRun, setSelectedRun] = useState(null);
  const [trades, setTrades] = useState([]);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function refresh(nextRun = selectedRun) {
    const items = await listBacktests();
    setRuns(items);
    const run = nextRun ? items.find((item) => item.id === nextRun.id) || nextRun : items[0] || null;
    setSelectedRun(run);
    setTrades(run ? await listBacktestTrades(run.id) : []);
  }

  useEffect(() => {
    refresh().catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    if (!initialStrategy) return;
    const symbol = initialStrategy.stockCode || initialStrategy.symbol || '';
    const market = initialStrategy.market || inferMarket(symbol);
    setForm((current) => ({
      ...current,
      symbol,
      name: initialStrategy.stockName || initialStrategy.symbolName || symbol,
      market,
      exchange: initialStrategy.exchange || '',
      currency: initialStrategy.currency || inferCurrency(market),
      totalBudget: initialStrategy.totalBudget || current.totalBudget,
      splitCount: initialStrategy.splitCount || current.splitCount,
      targetProfitPercent: Number(initialStrategy.targetProfitRate || 0.1) * 100,
      bigBuyPremiumPercent: initialStrategy.bigBuyPremiumRate == null ? '' : Number(initialStrategy.bigBuyPremiumRate) * 100
    }));
  }, [initialStrategy]);

  async function runBacktest(event) {
    event.preventDefault();
    if (!form.symbol || !form.fromDate || !form.toDate) {
      setError('심볼과 기간을 입력해 주세요.');
      return;
    }
    setRunning(true);
    setError('');
    setMessage('');
    try {
      const run = await createBacktest({
        symbol: form.symbol.toUpperCase(),
        market: form.market,
        exchange: form.exchange,
        fromDate: form.fromDate,
        toDate: form.toDate,
        totalBudget: Number(form.totalBudget),
        splitCount: Number(form.splitCount),
        targetProfitRate: Number(form.targetProfitPercent) / 100,
        bigBuyPremiumRate: form.bigBuyPremiumPercent === '' ? null : Number(form.bigBuyPremiumPercent) / 100,
        restartAfterSell: form.restartAfterSell,
        allowFractionalShares: form.allowFractionalShares
      });
      setSelectedRun(run);
      await refresh(run);
      setMessage(`${run.symbol} 실제 일봉 기준 백테스트를 완료했습니다.`);
    } catch (err) {
      setError(`${err.message} KIS 설정에서 App Key와 App Secret을 확인해 주세요.`);
    } finally {
      setRunning(false);
    }
  }

  const chartData = useMemo(() => trades.map((trade) => ({
    date: trade.tradeDate,
    totalAsset: trade.totalAsset,
    price: trade.price,
    averagePrice: trade.averagePrice,
    side: trade.side
  })), [trades]);

  return (
    <section className="mode-workspace">
      <header className="page-header">
        <div>
          <h1>백테스트</h1>
          <p>KIS에서 조회한 실제 일봉 데이터로 무한매수 전략 결과를 계산합니다.</p>
        </div>
        <button type="button" className="ghost" onClick={onBack}>돌아가기</button>
      </header>
      <RiskNotice />

      <LaorStrategyGuide />

      <section className="guide-panel">
        <h3>실행 절차</h3>
        <ol>
          <li>KIS 설정에서 App Key와 App Secret을 저장하고 연결 테스트를 완료합니다.</li>
          <li>종목을 검색해 선택합니다. 예: TQQQ, 005930.</li>
          <li>기간, 총 시드, 분할 회차, 목표 수익률을 입력합니다.</li>
          <li>앱은 KIS 일봉 시가·고가·종가로 매수와 매도 체결을 계산합니다.</li>
        </ol>
        <p className="helper">국내 종목은 KRW, 해외 종목은 USD로 표시합니다. 수수료, 세금, 환율, 슬리피지는 계산에서 제외합니다. 결과는 투자 수익을 보장하지 않습니다.</p>
      </section>

      <section className="panel section">
        <div className="panel-heading">
          <div>
            <h3>백테스트 실행</h3>
            <p>TQQQ 예시는 40분할, 목표 수익률 10%, USD 예산 기준입니다. 국내 종목을 선택하면 원화 기준으로 계산합니다.</p>
          </div>
        </div>
        <form className="mode-form" onSubmit={runBacktest}>
          <StockSearchField
            label="종목 검색"
            helper="종목코드나 심볼을 입력한 뒤 KIS 검색 결과를 선택하세요. 예: 005930, TQQQ"
            stockCode={form.symbol}
            stockName={form.name}
            onSelect={(stock) => {
              const symbol = stock.symbol || stock.stockCode || '';
              const rawName = (stock.name || stock.stockName || '').trim();
              setForm({
                ...form,
                symbol,
                name: rawName && rawName !== symbol ? rawName : '',
                market: stock.market || inferMarket(symbol),
                exchange: stock.exchange || '',
                currency: stock.currency || inferCurrency(stock.market || inferMarket(symbol))
              });
            }}
            onClear={() => setForm({ ...form, name: '', exchange: '', market: inferMarket(form.symbol), currency: inferCurrency(inferMarket(form.symbol)) })}
          />
          <label><span>시작일</span><input type="date" value={form.fromDate} onChange={(e) => setForm({ ...form, fromDate: e.target.value })} required /></label>
          <label><span>종료일</span><input type="date" value={form.toDate} onChange={(e) => setForm({ ...form, toDate: e.target.value })} required /></label>
          <label>
            <span>총 시드 ({form.currency})</span>
            <input type="number" min="1" step="0.01" value={form.totalBudget} onChange={(e) => setForm({ ...form, totalBudget: e.target.value })} required />
            <p className="helper">전체 투자 자금. 분할 회차로 나눠 매일 매수 시도에 쓰입니다.</p>
          </label>
          <label>
            <span>분할 회차</span>
            <input type="number" min="1" max="200" step="1" value={form.splitCount} onChange={(e) => setForm({ ...form, splitCount: e.target.value })} required />
            <p className="helper">시드를 몇 번에 나눠 매수할지. 라오어 기본값은 <b>40분할</b>. 회차당 예산 = 시드 ÷ 분할 회차.</p>
          </label>
          <label>
            <span>목표 수익률 (%)</span>
            <input type="number" min="0.1" step="0.1" value={form.targetProfitPercent} onChange={(e) => setForm({ ...form, targetProfitPercent: e.target.value })} required />
            <p className="helper">장중 고가가 평단가 × (1 + 목표 수익률)에 닿으면 목표가에 전량 매도한 것으로 계산합니다.</p>
          </label>
          <label>
            <span>큰수 매수 여유율 (%)</span>
            <input type="number" min="0" step="0.1" value={form.bigBuyPremiumPercent} onChange={(e) => setForm({ ...form, bigBuyPremiumPercent: nonNegativeInput(e.target.value) })} />
            <p className="helper">
              전일 종가보다 조금 높은 값까지 매수하는 ‘큰수 매수’ 지정가 여유율. 비워두면 0.1 ÷ 분할 회차로 자동 계산합니다.
              {' '}{form.bigBuyPremiumPercent === '' ? `현재 자동값 ${formatPercent(0.1 / Number(form.splitCount || 40))}` : `직접 입력 ${form.bigBuyPremiumPercent}%`}
            </p>
          </label>
          <label className="checkbox-field">
            <input type="checkbox" checked={form.restartAfterSell} onChange={(e) => setForm({ ...form, restartAfterSell: e.target.checked })} />
            <span>목표 매도 후 새 사이클 시작</span>
          </label>
          <label className="checkbox-field">
            <input type="checkbox" checked={form.allowFractionalShares} onChange={(e) => setForm({ ...form, allowFractionalShares: e.target.checked })} />
            <span>소수점 매매 시뮬레이션</span>
          </label>
          <p className="helper">
            기본은 자동매매와 동일한 <b>1주 단위 매수</b>입니다. 체크하면 소수점 수량으로 매수하는 시뮬레이션 결과를 봅니다(참고용이며, 실거래는 1주 단위만 가능).
          </p>
          <button type="submit" className="primary" disabled={running}>{running ? '실행 중...' : '백테스트 실행'}</button>
        </form>
      </section>

      {runs.length > 0 && (
        <RunPicker
          runs={runs}
          selectedRun={selectedRun}
          onSelectRun={async (run) => {
            setSelectedRun(run);
            setTrades(run ? await listBacktestTrades(run.id) : []);
          }}
          onBulkDelete={async (ids) => {
            if (ids.size === 0) return;
            if (!window.confirm(`선택한 ${ids.size}개 백테스트 결과를 삭제할까요? 되돌릴 수 없습니다.`)) return;
            setError('');
            setMessage('');
            try {
              for (const id of ids) await deleteBacktest(id);
              if (selectedRun && ids.has(selectedRun.id)) {
                setSelectedRun(null);
                setTrades([]);
              }
              await refresh(selectedRun && ids.has(selectedRun.id) ? null : selectedRun);
              setMessage(`${ids.size}개 결과를 삭제했습니다.`);
            } catch (err) {
              setError(err.message || '백테스트 결과 삭제에 실패했습니다.');
            }
          }}
        />
      )}

      {selectedRun && selectedRun.status === 'FAILED' && (
        <section className="panel section">
          <div className="panel-heading">
            <div>
              <h3>백테스트 실패</h3>
          <p>KIS 설정, 종목, 기간을 확인한 뒤 다시 실행해 주세요.</p>
            </div>
          </div>
          <p className="error">{selectedRun.errorMessage || '시세 조회 또는 백테스트 계산이 실패했습니다.'}</p>
        </section>
      )}

      {selectedRun && selectedRun.status !== 'FAILED' && (
        <>
          <ResultSummary title="백테스트 요약" items={[
            { label: '최종 자산', value: formatMoney(selectedRun.finalAsset, selectedRun.currency) },
            { label: '수익률(%)', value: formatPercent(selectedRun.returnRate), hint: '초기 투자금 대비 최종 자산 기준입니다.' },
            { label: '실현손익', value: formatMoney(selectedRun.realizedProfit, selectedRun.currency) },
            { label: '미실현손익', value: formatMoney(selectedRun.unrealizedProfit, selectedRun.currency) },
            { label: '최대 낙폭', value: formatPercent(selectedRun.maxDrawdownRate) },
            { label: '매수/매도', value: `${selectedRun.totalBuyCount || 0} / ${selectedRun.totalSellCount || 0}` },
            { label: '큰수 매수 여유율', value: `+${((selectedRun.effectiveBigBuyPremiumRate ?? selectedRun.bigBuyPremiumRate ?? 0) * 100).toFixed(4)}%`, hint: selectedRun.bigBuyPremiumRate == null ? '분할 회차 기반 자동값입니다.' : '사용자가 직접 입력한 값입니다.' },
            { label: '매수 단위', value: selectedRun.allowFractionalShares ? '소수점 매매' : '1주 단위', hint: selectedRun.allowFractionalShares ? '소수점 시뮬레이션 결과입니다. 실거래는 1주 단위만 가능합니다.' : '자동매매와 동일한 1주 단위 매수 결과입니다.' }
          ]} />
          {selectedRun.status === 'COMPLETED' && (selectedRun.totalBuyCount || 0) === 0 && (
            <ZeroBuyDiagnostic run={selectedRun} trades={trades} />
          )}
          <AssetCurveChart data={chartData} title={`백테스트 자산 변화 (${selectedRun.currency})`} unit={selectedRun.currency} />
          <AveragePriceChart data={chartData} unit={selectedRun.currency} />
          <TradeHistoryTable trades={trades} title="백테스트 거래 이력" currency={selectedRun.currency} />
        </>
      )}

      {message && <p className="success">{message}</p>}
      {error && <p className="error">{error}</p>}
    </section>
  );
}

function RunPicker({ runs, selectedRun, onSelectRun, onBulkDelete }) {
  const [checked, setChecked] = useState(() => new Set());

  function toggle(id) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const allChecked = runs.length > 0 && checked.size === runs.length;
  const someChecked = checked.size > 0;

  function toggleAll() {
    if (allChecked) setChecked(new Set());
    else setChecked(new Set(runs.map((r) => r.id)));
  }

  async function handleBulkDelete() {
    await onBulkDelete(checked);
    setChecked(new Set());
  }

  return (
    <section className="panel section">
      <div className="panel-heading">
        <div>
          <h3>결과 선택 · 관리</h3>
          <p>왼쪽 체크박스로 삭제할 결과를 고르고, 행을 클릭하면 그 결과의 상세를 봅니다.</p>
        </div>
        <span className="heading-meta">{runs.length}개</span>
      </div>
      <div className="run-toolbar">
        <label className="run-check-all">
          <input type="checkbox" checked={allChecked} onChange={toggleAll} />
          <span>{allChecked ? '전체 해제' : '전체 선택'}</span>
        </label>
        <button
          type="button"
          className="ghost danger-button sm"
          disabled={!someChecked}
          onClick={handleBulkDelete}
        >
          선택한 {checked.size > 0 ? `${checked.size}개 ` : ''}결과 삭제
        </button>
      </div>
      <ul className="run-list">
        {runs.map((run) => {
          const isViewing = selectedRun?.id === run.id;
          const isChecked = checked.has(run.id);
          return (
            <li
              key={run.id}
              className={`run-row${isViewing ? ' viewing' : ''}`}
            >
              <input
                type="checkbox"
                checked={isChecked}
                onChange={() => toggle(run.id)}
                aria-label={`${run.symbol} 결과 선택`}
              />
              <button
                type="button"
                className="run-row-body"
                onClick={() => onSelectRun(run)}
              >
                <span className="run-symbol">{run.symbol}</span>
                <span className="run-period">{run.fromDate} ~ {run.toDate}</span>
                <span className={`run-status status-${String(run.status || '').toLowerCase()}`}>{run.status}</span>
                {isViewing && <span className="run-viewing-badge">보는 중</span>}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function ZeroBuyDiagnostic({ run, trades }) {
  const buyAmountPerRound = Number(run.buyAmountPerRound || 0);
  const firstPrice = trades.length > 0 ? Number(trades[0].price || 0) : 0;
  return (
    <section className="panel section">
      <div className="panel-heading">
        <div>
          <h3>매수가 0건입니다</h3>
          <p>해당 기간에는 매수 조건이 충족되지 않았습니다.</p>
        </div>
      </div>
      <ul className="diagnostic-list">
        <li><strong>회차당 예산</strong>: {formatMoney(buyAmountPerRound, run.currency)}</li>
        {firstPrice > 0 && <li><strong>첫 거래일 가격</strong>: {formatMoney(firstPrice, run.currency)}</li>}
      </ul>
    </section>
  );
}

function formatMoney(value, currency = 'USD') {
  const locale = currency === 'KRW' ? 'ko-KR' : 'en-US';
  const maximumFractionDigits = currency === 'KRW' ? 0 : 2;
  return `${Number(value || 0).toLocaleString(locale, { maximumFractionDigits })} ${currency}`;
}

function formatPercent(value) {
  return `${(Number(value || 0) * 100).toFixed(2)}%`;
}

function createDefaultForm() {
  const to = new Date();
  const from = new Date(to);
  from.setFullYear(to.getFullYear() - 1);
  return {
    symbol: 'TQQQ',
    name: 'TQQQ',
    market: 'US',
    exchange: 'NAS',
    currency: 'USD',
    fromDate: toDateInputValue(from),
    toDate: toDateInputValue(to),
    totalBudget: 4000,
    splitCount: 40,
    targetProfitPercent: 10,
    bigBuyPremiumPercent: '',
    restartAfterSell: false,
    allowFractionalShares: false
  };
}

function inferMarket(symbol) {
  return /^\d{6}$/.test(String(symbol || '')) ? 'KR' : 'US';
}

function inferCurrency(market) {
  return market === 'KR' ? 'KRW' : 'USD';
}

function toDateInputValue(date) {
  return date.toISOString().slice(0, 10);
}

function nonNegativeInput(value) {
  if (String(value).startsWith('-')) return '0';
  return value;
}
