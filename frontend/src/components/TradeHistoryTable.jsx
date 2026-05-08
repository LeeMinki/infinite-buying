import React from 'react';

const SIDE_LABEL = {
  BUY: '매수',
  SELL: '매도',
  HOLD: '관망',
  COMPLETED: '완료'
};

export function TradeHistoryTable({ trades = [], title = '거래 이력' }) {
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
              <th>사유</th>
            </tr>
          </thead>
          <tbody>
            {trades.map((trade) => (
              <tr key={trade.id}>
                <td className="muted">{trade.tradeDate || formatDate(trade.createdAt)}</td>
                <td><span className={`decision compact ${String(trade.side || '').toLowerCase()}`}>{SIDE_LABEL[trade.side] || trade.side}</span></td>
                <td>{formatWon(trade.price)}</td>
                <td>{Number(trade.quantity || 0).toLocaleString('ko-KR')}</td>
                <td>{formatWon(trade.totalAsset)}</td>
                <td className="muted">{trade.reason}</td>
              </tr>
            ))}
            {trades.length === 0 && (
              <tr>
                <td className="empty-row" colSpan="6">아직 거래 이력이 없습니다.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function formatWon(value) {
  return `${Math.round(Number(value || 0)).toLocaleString('ko-KR')}원`;
}

function formatDate(value) {
  if (!value) return '-';
  return String(value).slice(0, 10);
}
