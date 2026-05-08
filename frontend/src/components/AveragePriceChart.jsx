import React, { useMemo } from 'react';
import {
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';

// Colorblind-safe (no red/green). Bright enough on dark backgrounds,
// saturated enough on light backgrounds.
const COLOR_CLOSE = '#3b82f6';
const COLOR_AVG = '#f59e0b';
const COLOR_BUY = '#a855f7';
const COLOR_SELL_FILL = '#ffffff';
const COLOR_SELL_STROKE = '#0f172a';
const COLOR_GRID = '#94a3b8';
const COLOR_REFLINE = '#94a3b8';

export function AveragePriceChart({ data = [] }) {
  const hasData = Array.isArray(data) && data.length > 0;

  const chartData = useMemo(() => {
    if (!Array.isArray(data)) return [];
    return data.map((d) => ({
      ...d,
      averagePrice: d.averagePrice && d.averagePrice > 0 ? d.averagePrice : null,
      buyPrice: d.side === 'BUY' && d.price > 0 ? d.price : null,
      sellPrice: d.side === 'SELL' && d.price > 0 ? d.price : null
    }));
  }, [data]);

  const sellDates = useMemo(
    () => chartData.filter((d) => d.sellPrice != null).map((d) => d.date),
    [chartData]
  );

  return (
    <section className="panel section">
      <div className="panel-heading">
        <div>
          <h3>평균단가 vs 종가</h3>
          <p>종가 흐름과 보유 평균단가, 매수/매도 시점을 함께 표시합니다.</p>
        </div>
      </div>
      <div className="chart-legend" aria-hidden="true">
        <span className="legend-item"><i className="legend-line solid" style={{ background: COLOR_CLOSE }} /> 종가</span>
        <span className="legend-item"><i className="legend-line dashed" style={{ borderTopColor: COLOR_AVG }} /> 평균단가</span>
        <span className="legend-item"><i className="legend-marker circle" style={{ background: COLOR_BUY }} /> 매수</span>
        <span className="legend-item"><i className="legend-marker diamond" style={{ background: COLOR_SELL_FILL, borderColor: COLOR_SELL_STROKE }} /> 매도</span>
      </div>
      {!hasData ? (
        <div className="empty">표시할 가격 데이터가 없습니다.</div>
      ) : (
        <div className="chart-box">
          <ResponsiveContainer>
            <ComposedChart data={chartData} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={COLOR_GRID} strokeOpacity={0.18} vertical={false} />
              <XAxis
                dataKey="date"
                type="category"
                allowDuplicatedCategory={false}
                minTickGap={24}
                tick={{ fill: COLOR_GRID, fontSize: 11 }}
                tickLine={false}
              />
              <YAxis
                tick={{ fill: COLOR_GRID, fontSize: 11 }}
                tickLine={false}
                width={70}
                tickFormatter={formatNumber}
                domain={['auto', 'auto']}
              />
              <Tooltip
                contentStyle={{ background: 'rgba(15,23,42,0.92)', border: 'none', borderRadius: 8, color: '#f8fafc' }}
                labelStyle={{ color: '#cbd5e1', fontSize: 12 }}
                itemStyle={{ color: '#f8fafc' }}
                formatter={(value, name) => {
                  if (value == null) return null;
                  return [`${formatNumber(value)}원`, NAME_LABEL[name] || name];
                }}
              />
              {sellDates.map((d) => (
                <ReferenceLine
                  key={`sell-line-${d}`}
                  x={d}
                  stroke={COLOR_REFLINE}
                  strokeDasharray="2 4"
                  strokeOpacity={0.4}
                />
              ))}
              <Line
                type="monotone"
                dataKey="price"
                stroke={COLOR_CLOSE}
                strokeWidth={2.4}
                dot={false}
                name="종가"
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="averagePrice"
                stroke={COLOR_AVG}
                strokeWidth={2.6}
                strokeDasharray="6 4"
                dot={false}
                connectNulls={false}
                name="평균단가"
                isAnimationActive={false}
              />
              <Scatter
                dataKey="buyPrice"
                name="매수"
                shape={renderBuyDot}
                legendType="none"
                isAnimationActive={false}
              />
              <Scatter
                dataKey="sellPrice"
                name="매도"
                shape={renderSellDot}
                legendType="none"
                isAnimationActive={false}
              />
              <Legend wrapperStyle={{ display: 'none' }} content={() => null} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}

function renderBuyDot(props) {
  const { cx, cy } = props;
  if (cx == null || cy == null) return null;
  return (
    <g>
      <circle cx={cx} cy={cy} r={6} fill={COLOR_BUY} stroke="#ffffff" strokeWidth={1.6} />
      <circle cx={cx} cy={cy} r={6} fill="none" stroke={COLOR_SELL_STROKE} strokeWidth={0.8} strokeOpacity={0.6} />
    </g>
  );
}

function renderSellDot(props) {
  const { cx, cy } = props;
  if (cx == null || cy == null) return null;
  const size = 7;
  const points = [
    `${cx},${cy - size}`,
    `${cx + size},${cy}`,
    `${cx},${cy + size}`,
    `${cx - size},${cy}`
  ].join(' ');
  return (
    <polygon
      points={points}
      fill={COLOR_SELL_FILL}
      stroke={COLOR_SELL_STROKE}
      strokeWidth={2}
    />
  );
}

const NAME_LABEL = {
  price: '종가',
  averagePrice: '평균단가',
  buyPrice: '매수가',
  sellPrice: '매도가'
};

function formatNumber(value) {
  return Number(value || 0).toLocaleString('ko-KR');
}
