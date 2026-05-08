import React, { useEffect, useMemo, useState } from 'react';
import {
  createBacktest,
  getDailyPrices,
  listBacktestTrades,
  listBacktests
} from '../api/client.js';
import { AssetCurveChart } from '../components/AssetCurveChart.jsx';
import { AveragePriceChart } from '../components/AveragePriceChart.jsx';
import { ResultSummary } from '../components/ResultSummary.jsx';
import { RiskNotice } from '../components/RiskNotice.jsx';
import { StockSearchField } from '../components/StockSearchField.jsx';
import { TradeHistoryTable } from '../components/TradeHistoryTable.jsx';

export function BacktestPage({ onBack }) {
  const [form, setForm] = useState(createDefaultForm);
  const [runs, setRuns] = useState([]);
  const [selectedRun, setSelectedRun] = useState(null);
  const [trades, setTrades] = useState([]);
  const [running, setRunning] = useState(false);
  const [priceCount, setPriceCount] = useState(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function refresh(nextRun = selectedRun) {
    const items = await listBacktests();
    setRuns(items);
    const run = nextRun ? items.find((item) => item.id === nextRun.id) || nextRun : items[0] || null;
    setSelectedRun(run);
    if (run) {
      setTrades(await listBacktestTrades(run.id));
    } else {
      setTrades([]);
    }
  }

  useEffect(() => {
    refresh().catch((err) => setError(err.message));
  }, []);

  async function runBacktest(event) {
    event.preventDefault();
    if (!form.stockCode || !form.fromDate || !form.toDate) {
      setError('종목과 조회 기간을 먼저 입력해 주세요.');
      return;
    }
    setRunning(true);
    setError('');
    setMessage('');
    try {
      const rows = await getDailyPrices(form.stockCode, {
        from: form.fromDate,
        to: form.toDate,
        requireReal: true
      });
      if (rows.length === 0) {
        throw new Error('선택한 기간에 사용할 수 있는 실제 가격 데이터가 없습니다.');
      }
      setPriceCount(rows.length);
      const run = await createBacktest({
        ...form,
        totalBudget: Number(form.totalBudget),
        splitCount: Number(form.splitCount),
        targetProfitRate: Number(form.targetProfitPercent) / 100
      });
      setSelectedRun(run);
      await refresh(run);
      setMessage(`실제 가격 ${rows.length.toLocaleString('ko-KR')}건으로 백테스트를 완료했습니다.`);
    } catch (err) {
      setError(`${err.message} 키움 설정 화면에서 App Key와 Secret Key를 저장하고, 서버 IP 등록이 완료되어 있는지 확인해 주세요.`);
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
          <h1>BACKTEST</h1>
          <p>실제 과거 가격으로 무한매수 전략 결과를 계산합니다.</p>
        </div>
        <button type="button" className="ghost" onClick={onBack}>돌아가기</button>
      </header>
      <RiskNotice />

      <LaorStrategyGuide />

      <section className="guide-panel">
        <h3>사용 방법</h3>
        <ol>
          <li>종목 검색에서 종목을 선택합니다.</li>
          <li>기간, 총 투자금, 분할 회차(기본 40), 목표 수익률(기본 10%)을 입력하고 백테스트를 실행합니다.</li>
          <li>앱은 선택한 기간의 실제 일봉 종가를 가져와 날짜순으로 위 규칙대로 매수·매도를 계산합니다.</li>
          <li>수수료, 세금, 슬리피지는 MVP에서 0으로 계산합니다.</li>
        </ol>
      </section>

      <section className="panel section">
        <div className="panel-heading">
          <div>
            <h3>백테스트 실행</h3>
            <p>입력한 기간의 실제 종가를 기준으로 전략을 검증합니다.</p>
          </div>
          {priceCount !== null && <span className="heading-meta">가격 {priceCount}건</span>}
        </div>
        <form className="mode-form" onSubmit={runBacktest}>
          <StockSearchField
            stockCode={form.stockCode}
            stockName={form.stockName}
            onSelect={(stock) => setForm({ ...form, stockCode: stock.stockCode, stockName: stock.stockName })}
            onClear={() => setForm({ ...form, stockCode: '', stockName: '' })}
            helper="검색 결과를 선택하면 종목코드와 종목명이 함께 입력됩니다."
          />
          <label><span>종목코드</span><input value={form.stockCode} onChange={(e) => setForm({ ...form, stockCode: e.target.value, stockName: '' })} required /><p className="helper">검색이 실패하면 종목코드를 직접 입력한 뒤 일봉 조회를 시도할 수 있습니다.</p></label>
          <label><span>시작일</span><input type="date" value={form.fromDate} onChange={(e) => setForm({ ...form, fromDate: e.target.value })} required /></label>
          <label><span>종료일</span><input type="date" value={form.toDate} onChange={(e) => setForm({ ...form, toDate: e.target.value })} required /></label>
          <label><span>총 투자금</span><input type="number" min="1" value={form.totalBudget} onChange={(e) => setForm({ ...form, totalBudget: e.target.value })} required /></label>
          <label><span>분할 회차</span><input type="number" min="1" value={form.splitCount} onChange={(e) => setForm({ ...form, splitCount: e.target.value })} required /></label>
          <label><span>목표 수익률(%)</span><input type="number" min="0.1" step="0.1" value={form.targetProfitPercent} onChange={(e) => setForm({ ...form, targetProfitPercent: e.target.value })} required /><p className="helper">퍼센트로 입력합니다. 예: 10 = 10%, 2.5 = 2.5%</p></label>
          <label className="checkbox-field"><input type="checkbox" checked={form.restartAfterSell} onChange={(e) => setForm({ ...form, restartAfterSell: e.target.checked })} /><span>매도 후 새 사이클 시작 (라오어 캐논, 차트가 복잡해집니다)</span></label>
          <button type="submit" className="primary" disabled={running}>{running ? '실행 중...' : '백테스트 실행'}</button>
        </form>
      </section>

      {runs.length > 0 && (
        <section className="panel section">
          <div className="panel-heading"><h3>결과 선택</h3><span className="heading-meta">{runs.length}개</span></div>
          <select value={selectedRun?.id || ''} onChange={async (event) => {
            const run = runs.find((item) => item.id === Number(event.target.value));
            setSelectedRun(run);
            setTrades(run ? await listBacktestTrades(run.id) : []);
          }}>
            {runs.map((run) => <option key={run.id} value={run.id}>{run.stockCode} · {run.fromDate}~{run.toDate} · {run.status}</option>)}
          </select>
        </section>
      )}

      {selectedRun && selectedRun.status === 'FAILED' && (
        <section className="panel section">
          <div className="panel-heading">
            <div>
              <h3>백테스트 실패</h3>
              <p>최근 실행이 실패했습니다. 키움 설정을 확인한 뒤 다시 실행해 주세요.</p>
            </div>
          </div>
          <p className="error">
            {selectedRun.errorMessage || '키움 데이터 조회 또는 백테스트 계산이 실패했습니다.'}
          </p>
        </section>
      )}

      {selectedRun && selectedRun.status !== 'FAILED' && (
        <>
          <ResultSummary title="백테스트 요약" items={[
            { label: '최종 자산', value: formatWon(selectedRun.finalAsset) },
            { label: '수익률(%)', value: formatPercent(selectedRun.returnRate), hint: '초기 투자금 대비 최종 자산 기준입니다.' },
            { label: '실현손익', value: formatWon(selectedRun.realizedProfit) },
            { label: '미실현손익', value: formatWon(selectedRun.unrealizedProfit) },
            { label: '최대 낙폭', value: formatPercent(selectedRun.maxDrawdownRate) },
            { label: '매수/매도', value: `${selectedRun.totalBuyCount || 0} / ${selectedRun.totalSellCount || 0}` }
          ]} />
          {selectedRun.status === 'COMPLETED' && (selectedRun.totalBuyCount || 0) === 0 && (
            <ZeroBuyDiagnostic run={selectedRun} trades={trades} />
          )}
          <AssetCurveChart data={chartData} title="백테스트 자산 변화" />
          <AveragePriceChart data={chartData} />
          <TradeHistoryTable trades={trades} title="백테스트 거래 이력" />
        </>
      )}

      {message && <p className="success">{message}</p>}
      {error && <p className="error">{error}</p>}
    </section>
  );
}

function LaorStrategyGuide() {
  return (
    <section className="laor-guide">
      <header>
        <h3>이 백테스트가 적용하는 규칙</h3>
        <p>라오어 무한매수법(단기)을 일봉 종가만으로 단순화해 적용합니다.</p>
      </header>

      <div className="laor-step">
        <span className="step-num">1</span>
        <div>
          <h4>회차당 기본 매수 금액 정하기</h4>
          <p>
            총 투자금을 분할 회차로 나눈 금액이 <b>회차당 기본 매수 금액</b>입니다.
          </p>
          <p className="laor-example">
            예) 총 투자금 4,000,000원, 분할 회차 40 → <b>회차당 100,000원</b>
          </p>
        </div>
      </div>

      <div className="laor-step">
        <span className="step-num">2</span>
        <div>
          <h4>매일 종가에 매수 — 평단가에 따라 수량을 다르게</h4>
          <p>오늘 종가와 내 평균단가를 비교해 다음 표대로 매수합니다.</p>
          <table className="laor-rules">
            <thead>
              <tr>
                <th>오늘 상황</th>
                <th>오늘 매수 수량</th>
                <th>이유</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>보유 수량이 0 (첫 매수)</td>
                <td><b>기본 수량</b><br />= floor(회차예산 ÷ 종가)</td>
                <td>새 사이클 시작</td>
              </tr>
              <tr>
                <td>종가 &lt; 평단가 <span className="badge cool">쌀 때</span></td>
                <td><b>기본 수량 × 2</b></td>
                <td>평단가를 더 빨리 낮추기 위해 더 많이 매수</td>
              </tr>
              <tr>
                <td>종가 ≥ 평단가 <span className="badge warm">비쌀 때</span></td>
                <td><b>기본 수량 ÷ 2</b><br />(최소 1주)</td>
                <td>평단가가 올라가는 걸 줄이기 위해 적게 매수</td>
              </tr>
              <tr>
                <td>현금이 부족해 1주도 못 살 때</td>
                <td>매수 보류 (HOLD)</td>
                <td>그날은 매수 없이 통과</td>
              </tr>
            </tbody>
          </table>
          <p className="laor-example">
            예) 회차예산 100,000원, 종가 75,000원, 평단가 80,000원 → 종가 &lt; 평단가 → <b>기본수량 1주 × 2 = 2주 매수</b>
          </p>
        </div>
      </div>

      <div className="laor-step">
        <span className="step-num">3</span>
        <div>
          <h4>익절 매도 — 목표 수익률에 도달하면 전량 매도</h4>
          <p>
            종가가 <b>평단가 × (1 + 목표 수익률)</b> 이상이 되면 보유 전량을 매도하고 회차 1부터 새로 시작합니다.
          </p>
          <p className="laor-example">
            예) 평단가 76,000원, 목표 수익률 10% → 종가 83,600원 이상이면 전량 매도 → 회차 1부터 재시작
          </p>
        </div>
      </div>

      <div className="laor-step">
        <span className="step-num">4</span>
        <div>
          <h4>40회 다 채웠는데 익절 안 났을 때 — 1/4 매도로 시드 재확보</h4>
          <p>
            분할 회차를 모두 소진했는데도 목표 수익률에 도달하지 못했다면, 보유 수량의 <b>1/4 (올림)</b>을
            그날 종가로 매도해 현금을 확보하고 회차 1부터 매수를 재개합니다. 남은 보유의 평단가는 그대로 유지합니다.
          </p>
          <p className="laor-example">
            예) 40회 모두 매수 완료, 보유 7주 → 7 ÷ 4 = 1.75 → 올림하여 <b>2주 매도</b> → 회차 1부터 다시 매수
          </p>
        </div>
      </div>

      <div className="laor-step">
        <span className="step-num">5</span>
        <div>
          <h4>종료</h4>
          <p>분할 회차를 모두 소진하고 보유 수량도 0이 된 시점에 백테스트가 종료됩니다.</p>
        </div>
      </div>

      <footer className="laor-foot">
        실제 라오어 무한매수법은 LOC 분할지정가 등 장중 호가를 사용하지만, 이 백테스트는 일봉 종가만 사용하므로
        “쌀 때 2배 / 비쌀 때 1/2”로 단순화한 종가 기준 변형입니다.
      </footer>
    </section>
  );
}

function ZeroBuyDiagnostic({ run, trades }) {
  const buyAmountPerRound = Number(run.buyAmountPerRound || 0);
  const firstPrice = trades.length > 0 ? Number(trades[0].price || 0) : 0;
  const firstReason = trades.length > 0 ? trades[0].reason : '';
  const budgetTooSmall = buyAmountPerRound > 0 && firstPrice > 0 && firstPrice > buyAmountPerRound;
  return (
    <section className="panel section">
      <div className="panel-heading">
        <div>
          <h3>매수가 0건이라서 결과가 비어 보입니다</h3>
          <p>아래 진단을 확인해 주세요. 거래 이력의 `사유` 컬럼에 같은 메시지가 반복되고 있을 것입니다.</p>
        </div>
      </div>
      <ul className="diagnostic-list">
        <li>
          <strong>회차당 예산</strong>: {formatWon(buyAmountPerRound)} (총 투자금 {formatWon(run.totalBudget)} ÷ {run.splitCount}회 분할)
        </li>
        {firstPrice > 0 && (
          <li><strong>첫 영업일 가격</strong>: {formatWon(firstPrice)}</li>
        )}
        {firstReason && (
          <li><strong>전략 판단 사유</strong>: {firstReason}</li>
        )}
        {budgetTooSmall && (
          <li className="error">
            회차당 예산이 첫 영업일 가격보다 작아서 1주도 매수할 수 없었습니다.
            총 투자금을 늘리거나 분할 회차를 줄여 주세요. (예: 분할 회차 {Math.max(1, Math.floor(Number(run.totalBudget || 0) / firstPrice))}회 이하)
          </li>
        )}
      </ul>
    </section>
  );
}

function formatWon(value) {
  return `${Math.round(Number(value || 0)).toLocaleString('ko-KR')}원`;
}

function formatPercent(value) {
  return `${(Number(value || 0) * 100).toFixed(2)}%`;
}

function createDefaultForm() {
  const to = new Date();
  const from = new Date(to);
  from.setDate(to.getDate() - 59);
  return {
    stockCode: '005930',
    stockName: '삼성전자',
    fromDate: toDateInputValue(from),
    toDate: toDateInputValue(to),
    totalBudget: 4000000,
    splitCount: 40,
    targetProfitPercent: 10,
    restartAfterSell: false
  };
}

function toDateInputValue(date) {
  return date.toISOString().slice(0, 10);
}
