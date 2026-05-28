import React from 'react';

// 자동매매 화면에서 한 전략 종류(국장/미국장/라오어)의 기간별 손익만 보여주는 패널.
// 데이터는 대시보드 응답의 periodReturns[].strategyTypes 를 그대로 재사용한다.
const PERIOD_NOTE = '매도까지 짝지어진 주문 이력 기준 손익입니다. 체결가 미확인 시 주문가로 근사하고, 모의(실주문 OFF) 기록은 제외합니다. KRW·USD는 통화별로 따로 합산합니다.';

export function StrategyPeriodReturns({ periods, strategyType }) {
  const rows = (periods || []).map((period) => ({
    key: period.key,
    label: period.label,
    summary: (period.strategyTypes || []).find((type) => type.key === strategyType) || null
  }));

  return (
    <section className="panel section period-return-panel">
      <div className="panel-heading">
        <div>
          <h3>기간별 수익률</h3>
          <p>{PERIOD_NOTE}</p>
        </div>
      </div>
      <div className="period-return-grid">
        {rows.length === 0 && <div className="empty compact-empty">기간 수익률을 계산할 주문 이력이 없습니다.</div>}
        {rows.map((row) => {
          const available = row.summary && Object.keys(row.summary.byCurrency || {}).length > 0;
          return (
            <article className="period-return-card" key={row.key}>
              <div className="period-return-head">
                <strong>{row.label}</strong>
                <span>{available ? '주문 이력 기준' : '데이터 부족'}</span>
              </div>
              <ReturnCurrencyList summary={row.summary} />
            </article>
          );
        })}
      </div>
    </section>
  );
}

function ReturnCurrencyList({ summary }) {
  const values = Object.values(summary?.byCurrency || {});
  if (values.length === 0) {
    return <span className="period-return-muted">{summary?.reason || '매도 완료 기록 없음'}</span>;
  }
  return (
    <div className="period-return-currencies">
      {values.map((item) => (
        <span
          key={item.currency}
          className={`period-return-currency ${Number(item.profitAmount || 0) >= 0 ? 'positive' : 'negative'}`}
        >
          {formatMoney(item.profitAmount, item.currency)}
          {' · '}
          {formatSignedPercent(item.returnRate)}
          {` · ${item.tradeCount}건`}
        </span>
      ))}
    </div>
  );
}

function formatMoney(value, currency = 'KRW') {
  const n = Number(value);
  if (!Number.isFinite(n)) return '-';
  const fraction = currency === 'KRW' ? 0 : 2;
  return `${currency} ${n.toLocaleString('ko-KR', { minimumFractionDigits: fraction, maximumFractionDigits: fraction })}`;
}

function formatSignedPercent(rate) {
  const n = Number(rate || 0) * 100;
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(2)}%`;
}
