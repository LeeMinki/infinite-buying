import React from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';

export function DailyChart({ data, stockCode }) {
  const hasData = Array.isArray(data) && data.length > 0;
  const lastClose = hasData ? data[data.length - 1].close : null;
  const firstClose = hasData ? data[0].close : null;
  const change = hasData && firstClose ? ((lastClose - firstClose) / firstClose) * 100 : 0;
  const changeColor = change >= 0 ? '#dc2626' : '#1d4ed8';

  return (
    <section className="panel section">
      <div className="panel-heading">
        <div>
          <h3>일봉 차트</h3>
          <p>최근 종가 흐름입니다. 평가에 직접 쓰이지는 않지만 추세 파악에 도움이 됩니다.</p>
        </div>
        {hasData && (
          <span className="heading-meta" style={{ color: changeColor }}>
            {stockCode} · {change >= 0 ? '▲' : '▼'} {Math.abs(change).toFixed(2)}%
          </span>
        )}
      </div>

      {!hasData ? (
        <div className="empty" style={{ background: '#fafbff', borderRadius: 12, padding: 32 }}>
          일봉 데이터를 가져올 수 없습니다.<br />
          <span className="muted" style={{ fontSize: 12 }}>(전략 평가는 차트 없이도 가능합니다.)</span>
        </div>
      ) : (
        <div style={{ width: '100%', height: 280 }}>
          <ResponsiveContainer>
            <AreaChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="closeFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#6366f1" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#eef0f7" vertical={false} />
              <XAxis
                dataKey="date"
                minTickGap={28}
                tick={{ fill: '#94a3b8', fontSize: 11 }}
                axisLine={{ stroke: '#e6eaf2' }}
                tickLine={false}
              />
              <YAxis
                domain={['auto', 'auto']}
                tick={{ fill: '#94a3b8', fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                width={60}
                tickFormatter={(v) => Number(v).toLocaleString('ko-KR')}
              />
              <Tooltip
                contentStyle={{
                  background: '#ffffff',
                  border: '1px solid #e6eaf2',
                  borderRadius: 10,
                  boxShadow: '0 8px 20px rgba(15,23,42,0.08)',
                  fontSize: 12
                }}
                labelStyle={{ color: '#475569', fontWeight: 600 }}
                formatter={(value) => [`${Number(value).toLocaleString('ko-KR')}원`, '종가']}
              />
              <Area
                type="monotone"
                dataKey="close"
                stroke="#4f46e5"
                strokeWidth={2.5}
                fill="url(#closeFill)"
                activeDot={{ r: 4, stroke: '#4f46e5', strokeWidth: 2, fill: '#fff' }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}
