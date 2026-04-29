import React from 'react';
import { createStrategy, deleteStrategy } from '../api/client.js';
import { StrategyForm } from '../components/StrategyForm.jsx';

export function StrategiesPage({ strategies, selectedId, onSelect, onChanged, onClose, onOpenKiwoom, user, onLogout }) {
  async function create(payload) {
    const strategy = await createStrategy(payload);
    await onChanged(strategy.id);
  }

  async function remove(id) {
    if (!confirm('이 전략과 관련된 가상 보유, 가상 주문, 판단 로그가 모두 삭제됩니다. 계속할까요?')) return;
    await deleteStrategy(id);
    await onChanged(null);
  }

  return (
    <aside className="sidebar">
      <button
        type="button"
        className="sidebar-close"
        onClick={onClose}
        aria-label="사이드바 닫기"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <path d="M3 3L11 11M11 3L3 11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      </button>
      <div className="brand">
        <div className="brand-logo" aria-hidden="true">∞</div>
        <div className="brand-text">
          <h1>무한매수 해죠</h1>
          <span>가상 거래 시뮬레이터</span>
        </div>
      </div>

      <div className="account-bar">
        <span>{user?.email}</span>
        <div className="button-row compact">
          <button type="button" className="sm" onClick={onOpenKiwoom}>키움 설정</button>
          <button type="button" className="ghost sm" onClick={onLogout}>로그아웃</button>
        </div>
      </div>

      <div className="disclaimer" role="note">
        <div className="dot" aria-hidden="true" />
        <div>
          <b>실제 주문은 절대 발생하지 않아요.</b><br />
          모든 매수·매도는 앱 안의 <b>가상 주문</b>으로만 기록돼요.
        </div>
      </div>

      <section className="onboard" aria-label="시작 가이드">
        <h2>처음이신가요? 👋</h2>
        <p>라오어 무한매수법을 따라 분할 매수 시뮬레이션을 도와드려요. 아래 순서로 시작해보세요.</p>
        <ol>
          <li><b>1</b><span>전략을 만들고 종목·예산·분할 회차를 정해요.</span></li>
          <li><b>2</b><span>현재가를 조회하거나 직접 입력해 평가해요.</span></li>
          <li><b>3</b><span>BUY / SELL / HOLD / PAUSE 결과를 확인해요.</span></li>
          <li><b>4</b><span>가상 주문을 체결하면 보유 상태가 갱신돼요.</span></li>
        </ol>
      </section>

      <div className="sidebar-section">
        <h4>새 전략 만들기</h4>
        <StrategyForm onSubmit={create} />
      </div>

      <div className="sidebar-section">
        <div className="section-title" style={{ marginBottom: 10 }}>
          <h4 style={{ margin: 0 }}>내 전략</h4>
          <span className="heading-meta">{strategies.length}개</span>
        </div>
        <div className="strategy-list">
          {strategies.map((strategy) => {
            const isPaused = strategy.status === 'PAUSED';
            return (
              <button
                className={`strategy-item ${strategy.id === selectedId ? 'active' : ''}`}
                key={strategy.id}
                type="button"
                onClick={() => onSelect(strategy.id)}
              >
                <span className="name">
                  <strong>{strategy.name}</strong>
                  <span className="sub">{strategy.stockCode} · {strategy.stockName}</span>
                </span>
                <span className={`badge ${isPaused ? 'warning' : 'active'}`}>
                  {isPaused ? '일시정지' : '진행 중'}
                </span>
              </button>
            );
          })}
          {strategies.length === 0 && (
            <div className="empty" style={{ background: '#fafbff', border: '1px dashed var(--border-strong)', borderRadius: 12 }}>
              아직 등록된 전략이 없어요.<br />위에서 첫 전략을 만들어보세요.
            </div>
          )}
        </div>
        {selectedId && (
          <button
            className="ghost danger-button sm"
            type="button"
            onClick={() => remove(selectedId)}
            style={{ marginTop: 10 }}
          >
            선택한 전략 삭제
          </button>
        )}
      </div>
    </aside>
  );
}
