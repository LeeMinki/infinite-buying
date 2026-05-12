import React, { useState } from 'react';

const DECISION_LABEL = {
  BUY: '매수',
  SELL: '매도',
  HOLD: '관망',
  PAUSE: '일시정지'
};

const DECISION_HEADLINE = {
  BUY: '매수 신호입니다',
  SELL: '매도 신호입니다',
  HOLD: '이번 회차는 관망입니다',
  PAUSE: '전략이 일시정지 상태입니다'
};

const LEGEND = [
  { key: 'buy', label: '매수 (BUY)', desc: '이번 회차 1회 매수금으로 살 수량이 있을 때' },
  { key: 'sell', label: '매도 (SELL)', desc: '평균단가 대비 목표 수익률에 도달했을 때' },
  { key: 'hold', label: '관망 (HOLD)', desc: '현재가가 1회 매수금보다 비싸 살 수량이 0일 때' },
  { key: 'pause', label: '일시정지 (PAUSE)', desc: '전략 상태가 PAUSED일 때' }
];

export function EvaluationPanel({ strategy, currentPrice, setCurrentPrice, onFetchPrice, onEvaluate, decision, priceSource, currency = 'KRW' }) {
  const [error, setError] = useState('');
  const [fetching, setFetching] = useState(false);
  const [evaluating, setEvaluating] = useState(false);

  async function fetchPrice() {
    setError('');
    setFetching(true);
    try {
      await onFetchPrice();
    } catch (err) {
      setError(`현재가를 가져오지 못했습니다: ${err.message} 아래 칸에 직접 입력하면 평가를 계속할 수 있습니다.`);
    } finally {
      setFetching(false);
    }
  }

  async function evaluate() {
    setEvaluating(true);
    try {
      await onEvaluate();
    } finally {
      setEvaluating(false);
    }
  }

  const decisionKey = decision?.decision?.toLowerCase();

  return (
    <section className="panel section">
      <div className="panel-heading">
        <div>
          <h3>전략 평가</h3>
          <p>현재가를 가져오거나 직접 입력한 뒤 <b>평가 실행</b>을 눌러주세요.</p>
        </div>
        <span className="heading-meta">BUY · SELL · HOLD · PAUSE</span>
      </div>

      <div className="action-row">
        <button type="button" className="subtle" onClick={fetchPrice} disabled={fetching || !strategy}>
          {fetching ? '조회 중...' : '현재가 자동 조회'}
        </button>
        <label className="price-input">
          <span>현재가 (수동 입력 가능)</span>
          <div className="input-with-unit">
            <input
              type="number"
              min="1"
              placeholder="조회 실패 시 직접 입력"
              value={currentPrice}
              onChange={(e) => setCurrentPrice(e.target.value)}
            />
            <em>{currency}</em>
          </div>
        </label>
        <button
          className="primary"
          type="button"
          onClick={evaluate}
          disabled={!strategy || !currentPrice || evaluating}
        >
          {evaluating ? '판단 중...' : '평가 실행'}
        </button>
      </div>

      {error && (
        <div className="note" style={{ background: '#fef2f2', borderColor: '#fecaca', color: '#991b1b', marginTop: 12 }}>
          <span className="note-icon" style={{ background: '#fee2e2', color: '#b91c1c' }}>!</span>
          <span>{error}</span>
        </div>
      )}

      {priceSource && !error && (
        <div className="note" style={{ marginTop: 12 }}>
          <span>현재가 출처: {priceSource}</span>
        </div>
      )}

      {decision && decisionKey && (
        <div className={`decision-card ${decisionKey}`}>
          <div className="decision-headline">
            <span className={`decision ${decisionKey}`}>{DECISION_LABEL[decision.decision] || decision.decision}</span>
            <strong>{DECISION_HEADLINE[decision.decision] || '판단 결과'}</strong>
          </div>
          <span className="decision-reason">{decision.reason}</span>
        </div>
      )}

      <div className="legend">
        {LEGEND.map((item) => (
          <div key={item.key} className="legend-item">
            <b><span className={`decision compact ${item.key}`}>{item.label}</span></b>
            <span>{item.desc}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
