import React, { useMemo, useState } from 'react';
import { getAccountDeposit } from '../api/client.js';
import { StockSearchField } from './StockSearchField.jsx';

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
  const [stockSearchReset, setStockSearchReset] = useState(0);
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
    setStockSearchError('');
  }

  async function loadDeposit() {
    setDepositLoading(true);
    setDepositError('');
    try {
      const data = await getAccountDeposit();
      const amount = data.availableOrderAmount || data.deposit;
      if (!amount) {
        setDepositError('키움 계좌 금액을 읽어왔지만 사용할 수 있는 금액이 없습니다.');
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
      setStockSearchReset((value) => value + 1);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="strategy-form" onSubmit={submit}>
      <label>
        <span>전략명</span>
        <input
          placeholder="예: TQQQ 40분할"
          value={form.name}
          onChange={(e) => update('name', e.target.value)}
          required
        />
        <p className="helper">나중에 알아보기 쉬운 이름이면 충분합니다.</p>
      </label>

      <div>
        <StockSearchField
          stockCode={form.stockCode}
          stockName={form.stockName}
          onSelect={selectStock}
          onClear={() => setForm((current) => ({ ...current, stockCode: '', stockName: '' }))}
          clearSignal={stockSearchReset}
          helper="검색 결과를 선택하면 종목코드와 종목명이 자동으로 입력됩니다."
        />
        {stockSearchError && <p className="form-error">{stockSearchError}</p>}
      </div>

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
        <p className="helper">이 전략에 사용할 전체 예산입니다. 예수금을 불러와도 실제 주문은 발생하지 않습니다.</p>
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
          <p className="helper">예산을 몇 번에 나눠 매수할지 정합니다. 기본값은 40회입니다.</p>
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
          <p className="helper">평균단가 대비 이 수익률에 도달하면 매도 신호가 표시됩니다. 예: 10 = 10%</p>
        </label>
      </div>

      <div className="note">
        <span className="note-icon">i</span>
        <div>
          <b>1회 매수금</b>은 자동으로 계산됩니다: <b>{perRoundBuy.toLocaleString('ko-KR')}원</b>
          <br />
          현재가가 이 금액보다 높으면 해당 회차는 자동으로 <b>HOLD</b>(관망)로 처리됩니다.
        </div>
      </div>

      <button className="primary wide" type="submit" disabled={submitting}>
        {submitting ? '저장 중...' : '전략 저장하기'}
      </button>
    </form>
  );
}
