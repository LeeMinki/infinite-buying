import React, { useEffect, useMemo, useState } from 'react';
import { getAccountDeposit, searchStocks } from '../api/client.js';

const initial = {
  name: '',
  stockCode: '',
  stockName: '',
  totalBudget: 4000000,
  splitCount: 40,
  targetProfitPercent: 10,
  status: 'ACTIVE'
};

export function StrategyForm({ onSubmit }) {
  const [form, setForm] = useState(initial);
  const [submitting, setSubmitting] = useState(false);
  const [stockQuery, setStockQuery] = useState('');
  const [stockResults, setStockResults] = useState([]);
  const [stockSearching, setStockSearching] = useState(false);
  const [stockSearchError, setStockSearchError] = useState('');
  const [depositLoading, setDepositLoading] = useState(false);
  const [depositError, setDepositError] = useState('');

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function selectStock(stock) {
    setForm((current) => ({
      ...current,
      stockCode: stock.stockCode,
      stockName: stock.stockName
    }));
    setStockQuery(`${stock.stockCode} · ${stock.stockName}`);
    setStockResults([]);
    setStockSearchError('');
  }

  useEffect(() => {
    const keyword = stockQuery.trim();
    if (keyword.length < 2) {
      setStockResults([]);
      setStockSearchError('');
      return undefined;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      setStockSearching(true);
      setStockSearchError('');
      try {
        const data = await searchStocks(keyword);
        if (!cancelled) setStockResults(data?.items || []);
      } catch (error) {
        if (!cancelled) {
          setStockResults([]);
          setStockSearchError(error.message);
        }
      } finally {
        if (!cancelled) setStockSearching(false);
      }
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [stockQuery]);

  async function loadDeposit() {
    setDepositLoading(true);
    setDepositError('');
    try {
      const data = await getAccountDeposit();
      const amount = data.availableOrderAmount || data.deposit;
      if (!amount) {
        setDepositError('키움 계좌 금액을 읽어왔지만 사용할 수 있는 금액이 없어요.');
        return;
      }
      update('totalBudget', amount);
    } catch (error) {
      setDepositError(error.message);
    } finally {
      setDepositLoading(false);
    }
  }

  const perRoundBuy = useMemo(() => {
    const total = Number(form.totalBudget);
    const count = Number(form.splitCount);
    if (!total || !count || count <= 0) return 0;
    return Math.floor(total / count);
  }, [form.totalBudget, form.splitCount]);

  async function submit(event) {
    event.preventDefault();
    if (!form.stockCode || !form.stockName) {
      setStockSearchError('검색 결과에서 종목을 먼저 선택해 주세요.');
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit({
        ...form,
        totalBudget: Number(form.totalBudget),
        splitCount: Number(form.splitCount),
        targetProfitRate: Number(form.targetProfitPercent) / 100
      });
      setForm(initial);
      setStockQuery('');
      setStockResults([]);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="strategy-form" onSubmit={submit}>
      <label>
        <span>전략명</span>
        <input
          placeholder="예: TQQQ 40분할 시뮬"
          value={form.name}
          onChange={(e) => update('name', e.target.value)}
          required
        />
        <p className="helper">나중에 알아보기 쉬운 이름이면 충분해요.</p>
      </label>

      <label>
        <span>종목 검색</span>
        <div className="stock-search">
          <input
            placeholder="예: 005930 또는 삼성전자"
            value={stockQuery}
            onChange={(e) => {
              setStockQuery(e.target.value);
              setForm((current) => ({ ...current, stockCode: '', stockName: '' }));
            }}
            autoComplete="off"
            required
          />
          {stockResults.length > 0 && (
            <div className="stock-results" role="listbox" aria-label="종목 검색 결과">
              {stockResults.map((stock) => (
                <button
                  type="button"
                  role="option"
                  key={`${stock.stockCode}-${stock.stockName}`}
                  onClick={() => selectStock(stock)}
                >
                  <strong>{stock.stockCode}</strong>
                  <span>{stock.stockName}</span>
                  <em>{stock.source}</em>
                </button>
              ))}
            </div>
          )}
        </div>
        <p className="helper">
          {stockSearching ? '키움 REST API로 종목을 확인하는 중이에요.' : '검색 결과를 선택하면 종목코드와 종목명이 자동으로 들어가요.'}
        </p>
        {stockSearchError && <p className="form-error">{stockSearchError}</p>}
        {stockQuery.trim().length >= 2 && !stockSearching && stockResults.length === 0 && !form.stockCode && !stockSearchError && (
          <p className="helper">검색 결과가 없어요. 종목코드나 종목명을 조금 더 정확히 입력해 주세요.</p>
        )}
        {form.stockCode && (
          <p className="selected-stock">
            선택됨: <b>{form.stockCode}</b> · {form.stockName}
          </p>
        )}
      </label>

      <label>
        <span>총 투자금</span>
        <div className="input-with-unit">
          <input
            type="number"
            min="1"
            value={form.totalBudget}
            onChange={(e) => update('totalBudget', e.target.value)}
          />
          <em>원</em>
        </div>
        <div className="button-row compact budget-actions">
          <button type="button" className="ghost sm" onClick={loadDeposit} disabled={depositLoading}>
            {depositLoading ? '불러오는 중...' : '키움 예수금 불러오기'}
          </button>
        </div>
        <p className="helper">이 전략에 쏟을 전체 예산이에요. 예수금을 불러와도 실제 주문은 발생하지 않아요.</p>
        {depositError && <p className="form-error">{depositError}</p>}
      </label>

      <div className="form-grid two">
        <label>
          <span>분할 회차</span>
          <div className="input-with-unit">
            <input
              type="number"
              min="1"
              value={form.splitCount}
              onChange={(e) => update('splitCount', e.target.value)}
            />
            <em>회</em>
          </div>
          <p className="helper">예산을 몇 번에 나눠 살지 정해요. 기본 40회.</p>
        </label>
        <label>
          <span>목표 수익률</span>
          <div className="input-with-unit">
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.targetProfitPercent}
              onChange={(e) => update('targetProfitPercent', e.target.value)}
            />
            <em>%</em>
          </div>
          <p className="helper">평균단가 대비 이 수익률에 닿으면 매도 신호가 떠요. 예: 10 = 10%</p>
        </label>
      </div>

      <div className="note">
        <span className="note-icon">i</span>
        <div>
          <b>1회 매수금</b>은 자동으로 계산돼요 → <b>{perRoundBuy.toLocaleString('ko-KR')}원</b>
          <br />
          현재가가 이 금액보다 높으면 그 회차는 자동으로 <b>HOLD</b>(관망)로 처리돼요.
        </div>
      </div>

      <button className="primary wide" type="submit" disabled={submitting}>
        {submitting ? '저장 중…' : '전략 저장하기'}
      </button>
    </form>
  );
}
