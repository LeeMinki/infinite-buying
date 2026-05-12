import React from 'react';

const SIDE_LABEL = {
  BUY: '매수',
  SELL: '매도',
  HOLD: '관망',
  COMPLETED: '완료'
};

export function TradeHistoryTable({ trades = [], title = '거래 이력', currency = 'KRW' }) {
  return (
    <section className="panel section">
      <div className="panel-heading">
        <div>
          <h3>{title}</h3>
          <p>모든 체결과 판단은 가상 기록입니다.</p>
        </div>
        <span className="heading-meta">{trades.length}건</span>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>일자</th>
              <th>구분</th>
              <th>가격</th>
              <th>수량</th>
              <th>총자산</th>
              <th>보유 현금</th>
              <th>보유 주식</th>
              <th>사유</th>
            </tr>
          </thead>
          <tbody>
            {trades.map((trade) => (
              <tr key={trade.id}>
                <td className="muted">{trade.tradeDate || formatDate(trade.createdAt)}</td>
                <td><span className={`decision compact ${String(trade.side || '').toLowerCase()}`}>{SIDE_LABEL[trade.side] || trade.side}</span></td>
                <td>{formatMoney(trade.price, currency)}</td>
                <td>{formatShares(trade.quantity)}</td>
                <td>{formatMoney(trade.totalAsset, currency)}</td>
                <td>{formatMoney(trade.cash, currency)}</td>
                <td>{formatShares(trade.holdingQuantity)}주</td>
                <td className="muted reason-cell">{trade.reason}</td>
              </tr>
            ))}
            {trades.length === 0 && (
              <tr>
                <td className="empty-row" colSpan="8">아직 거래 이력이 없습니다.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function formatMoney(value, currency) {
  if (currency === 'USD') {
    return `${Number(value || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })} USD`;
  }
  return `${Math.round(Number(value || 0)).toLocaleString('ko-KR')} KRW`;
}

function formatShares(value) {
  const n = Number(value || 0);
  if (n === 0) return '0';
  return n.toLocaleString('en-US', { maximumFractionDigits: 6 });
}

function formatDate(value) {
  if (!value) return '-';
  return String(value).slice(0, 10);
}
