import React from 'react';
import { createStrategy, deleteStrategy } from '../api/client.js';
import { StrategyForm } from '../components/StrategyForm.jsx';

export function StrategiesPage({ strategies, selectedId, onSelect, onChanged, onClose, onOpenKiwoom, onOpenBacktest, user, onLogout }) {
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
          <span>무한매수 백테스트</span>
        </div>
      </div>

      <div className="account-bar">
        <span>{user?.email}</span>
        <div className="button-row compact">
          <button type="button" className="sm" onClick={onOpenBacktest}>백테스트</button>
          <button type="button" className="sm" onClick={onOpenKiwoom}>키움 설정</button>
          <button type="button" className="ghost sm" onClick={onLogout}>로그아웃</button>
        </div>
      </div>

      <div className="disclaimer" role="note">
        <div className="dot" aria-hidden="true" />
        <div>
          <b>실제 주문은 발생하지 않습니다.</b><br />
          모든 매수·매도는 앱 안의 <b>가상 주문</b>으로만 기록됩니다.
        </div>
      </div>

      <section className="onboard" aria-label="시작 가이드">
        <h2>시작 가이드</h2>
        <p>라오어 무한매수법을 기준으로 전략을 만들고 실제 과거 가격 백테스트를 실행합니다.</p>
        <ol>
          <li><b>1</b><span>전략을 만들고 종목·예산·분할 회차를 정합니다.</span></li>
          <li><b>2</b><span>키움 설정에서 App Key와 Secret Key를 저장합니다.</span></li>
          <li><b>3</b><span>백테스트에서 종목과 기간을 입력해 실제 과거 가격 기준 결과를 확인합니다.</span></li>
          <li><b>4</b><span>필요하면 전략 상세에서 현재가 기준 단일 평가를 확인합니다.</span></li>
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
              아직 등록된 전략이 없습니다.<br />위에서 첫 전략을 만들어 주세요.
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
