import React, { useMemo, useState } from 'react';

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
          placeholder="예: TQQQ 40분할 시뮬"
          value={form.name}
          onChange={(e) => update('name', e.target.value)}
          required
        />
        <p className="helper">나중에 알아보기 쉬운 이름이면 충분해요.</p>
      </label>

      <div className="form-grid two">
        <label>
          <span>종목코드</span>
          <input
            placeholder="예: TQQQ"
            value={form.stockCode}
            onChange={(e) => update('stockCode', e.target.value)}
            required
          />
        </label>
        <label>
          <span>종목명</span>
          <input
            placeholder="예: ProShares UltraPro QQQ"
            value={form.stockName}
            onChange={(e) => update('stockName', e.target.value)}
            required
          />
        </label>
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
        <p className="helper">이 전략에 쏟을 전체 예산이에요. 실제로 빠져나가지 않아요.</p>
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
