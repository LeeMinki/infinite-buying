import React from 'react';

const SIDE_LABEL = { BUY: '매수', SELL: '매도' };
const STATUS_LABEL = {
  PENDING: '대기',
  FILLED: '체결',
  CANCELED: '취소'
};

export function OrdersTable({ orders, onFill, onCancel }) {
  return (
    <section className="panel section">
      <div className="panel-heading">
        <div>
          <h3>가상 주문</h3>
          <p>평가 결과로 만들어진 가상 주문입니다. 체결 또는 취소를 직접 눌러 처리합니다.</p>
        </div>
        <span className="heading-meta">{orders.length}건</span>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>일자</th>
              <th>구분</th>
              <th>가격</th>
              <th>수량</th>
              <th>상태</th>
              <th style={{ textAlign: 'right' }}>처리</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => (
              <tr key={order.id}>
                <td className="muted">{order.orderDate}</td>
                <td>
                  <span className={`side ${order.side.toLowerCase()}`}>
                    {SIDE_LABEL[order.side] || order.side}
                  </span>
                </td>
                <td>{Math.round(order.price).toLocaleString('ko-KR')}원</td>
                <td>{order.quantity.toLocaleString('ko-KR')}주</td>
                <td>
                  <span className={`status-pill ${order.status.toLowerCase()}`}>
                    {STATUS_LABEL[order.status] || order.status}
                  </span>
                </td>
                <td style={{ textAlign: 'right' }}>
                  <div className="button-pair" style={{ justifyContent: 'flex-end' }}>
                    <button
                      className="subtle sm"
                      type="button"
                      disabled={order.status !== 'PENDING'}
                      onClick={() => onFill(order.id)}
                    >
                      체결
                    </button>
                    <button
                      className="ghost danger-button sm"
                      type="button"
                      disabled={order.status !== 'PENDING'}
                      onClick={() => onCancel(order.id)}
                    >
                      취소
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {orders.length === 0 && (
              <tr>
                <td className="empty-row" colSpan="6">
                  아직 가상 주문이 없습니다. 평가 실행 결과가 매수 또는 매도이면 여기에 자동으로 추가됩니다.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
