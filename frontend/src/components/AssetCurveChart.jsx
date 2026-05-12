import React from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';

export function AssetCurveChart({ data = [], title = '자산 변화', description = '총자산 흐름입니다.', unit = '원' }) {
  const hasData = Array.isArray(data) && data.length > 0;
  return (
    <section className="panel section">
      <div className="panel-heading">
        <div>
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
      </div>
      {!hasData ? (
        <div className="empty">표시할 자산 데이터가 없습니다.</div>
      ) : (
        <div className="chart-box">
          <ResponsiveContainer>
            <LineChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="#eef0f7" vertical={false} />
              <XAxis dataKey="date" minTickGap={24} tick={{ fill: '#94a3b8', fontSize: 11 }} tickLine={false} />
              <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} tickLine={false} width={70} tickFormatter={formatNumber} />
              <Tooltip formatter={(value) => [`${formatNumber(value)}${unit === '원' ? '원' : ` ${unit}`}`, '총자산']} />
              <Line type="monotone" dataKey="totalAsset" stroke="#4f46e5" strokeWidth={2.5} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
}
