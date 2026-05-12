import React from 'react';

export function HoldingPanel({ holding, currency = 'KRW' }) {
  if (!holding) return null;

  const realized = Number(holding.realizedProfit || 0);
  const realizedColor = realized > 0 ? 'var(--danger)' : realized < 0 ? '#1d4ed8' : 'var(--text)';

  return (
    <section className="panel section">
      <div className="panel-heading">
        <div>
          <h3>가상 보유 상태</h3>
          <p>실제 잔고가 아니라, 이 전략 안에서만 유지되는 가상 보유예요.</p>
        </div>
      </div>
      <div className="metric-grid">
        <Metric label="보유 수량" value={`${(holding.quantity || 0).toLocaleString('ko-KR')}주`} hint="현재 들고 있는 가상 주식 수" />
        <Metric label="평균단가" value={formatMoney(holding.averagePrice, currency)} hint="여태 매수한 가격의 평균" />
        <Metric label="투입금" value={formatMoney(holding.investedAmount, currency)} hint="가상으로 투입된 누적 금액" />
        <Metric label="잔여 예산" value={formatMoney(holding.remainingBudget, currency)} hint="앞으로 더 매수 가능한 금액" />
        <Metric
          label="실현 손익"
          value={formatSigned(realized, currency)}
          hint="매도 체결로 확정된 손익"
          valueColor={realizedColor}
        />
      </div>
    </section>
  );
}

function Metric({ label, value, hint, valueColor }) {
  return (
    <div className="metric">
      <span className="metric-label">{label}</span>
      <strong style={valueColor ? { color: valueColor } : undefined}>{value}</strong>
      {hint && <span className="metric-hint">{hint}</span>}
    </div>
  );
}

function formatMoney(value, currency) {
  const locale = currency === 'KRW' ? 'ko-KR' : 'en-US';
  const maximumFractionDigits = currency === 'KRW' ? 0 : 2;
  return `${Number(value || 0).toLocaleString(locale, { maximumFractionDigits })} ${currency}`;
}

function formatSigned(value, currency) {
  const locale = currency === 'KRW' ? 'ko-KR' : 'en-US';
  const maximumFractionDigits = currency === 'KRW' ? 0 : 2;
  const number = Number(value || 0);
  const formatted = `${Math.abs(number).toLocaleString(locale, { maximumFractionDigits })} ${currency}`;
  if (number > 0) return `+${formatted}`;
  if (number < 0) return `-${formatted}`;
  return formatted;
}
