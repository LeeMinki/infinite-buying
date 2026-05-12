import React, { useMemo, useState } from 'react';
import { StockSearchField } from './StockSearchField.jsx';

const initial = {
  name: '',
  stockCode: 'TQQQ',
  stockName: 'TQQQ',
  market: 'US',
  currency: 'USD',
  totalBudget: 10000,
  splitCount: 40,
  targetProfitPercent: 10,
  status: 'ACTIVE'
};

export function StrategyForm({ onSubmit }) {
  const [form, setForm] = useState(initial);
  const [submitting, setSubmitting] = useState(false);

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  const perRoundBuy = useMemo(() => {
    const total = Number(form.totalBudget);
    const count = Number(form.splitCount);
    if (!total || !count || count <= 0) return 0;
    return Math.floor(total / count);
  }, [form.totalBudget, form.splitCount]);

  async function submit(event) {
    event.preventDefault();
    if (!form.stockCode) {
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

      <StockSearchField
        label="종목 검색"
        helper="종목코드나 심볼을 입력한 뒤 KIS 검색 결과를 선택하세요. 예: 005930, TQQQ"
        stockCode={form.stockCode}
        stockName={form.stockName}
        onSelect={(stock) => setForm((current) => {
          const symbol = stock.stockCode || stock.symbol || '';
          const rawName = (stock.stockName || stock.name || '').trim();
          return {
            ...current,
            stockCode: symbol,
            stockName: rawName && rawName !== symbol ? rawName : '',
            market: stock.market || inferMarket(symbol),
            currency: stock.currency || inferCurrency(stock.market || inferMarket(symbol))
          };
        })}
        onClear={() => {}}
      />

      <label>
        <span>총 투자금 ({form.currency})</span>
        <div className="input-with-unit">
          <input
            type="number"
            min="1"
            value={form.totalBudget}
            onChange={(e) => update('totalBudget', e.target.value)}
          />
          <em>{form.currency}</em>
        </div>
        <p className="helper">백테스트와 자동매매 전략 생성에 함께 가져갈 기준 예산입니다.</p>
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
          <b>1회 매수금</b>은 자동으로 계산됩니다: <b>{formatMoney(perRoundBuy, form.currency)}</b>
          <br />
          현재가가 이 금액보다 높으면 해당 회차는 자동으로 관망 처리됩니다.
        </div>
      </div>

      <button className="primary wide" type="submit" disabled={submitting}>
        {submitting ? '저장 중...' : '초안 저장하기'}
      </button>
    </form>
  );
}

function inferMarket(symbol) {
  return /^\d{6}$/.test(String(symbol || '')) ? 'KR' : 'US';
}

function inferCurrency(market) {
  return market === 'KR' ? 'KRW' : 'USD';
}

function formatMoney(value, currency) {
  const locale = currency === 'KRW' ? 'ko-KR' : 'en-US';
  const maximumFractionDigits = currency === 'KRW' ? 0 : 2;
  return `${Number(value || 0).toLocaleString(locale, { maximumFractionDigits })} ${currency}`;
}
