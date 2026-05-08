import React from 'react';

export function ResultSummary({ title = '요약', items = [] }) {
  return (
    <section className="panel section">
      <div className="panel-heading">
        <div>
          <h3>{title}</h3>
          <p>수수료, 세금, 슬리피지는 MVP에서 0으로 계산합니다.</p>
        </div>
      </div>
      <div className="metric-grid">
        {items.map((item) => (
          <div className="metric" key={item.label}>
            <span className="metric-label">{item.label}</span>
            <strong>{item.value}</strong>
            {item.hint && <span className="metric-hint">{item.hint}</span>}
          </div>
        ))}
      </div>
    </section>
  );
}
