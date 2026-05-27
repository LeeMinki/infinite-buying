import React from 'react';
import { deleteStrategy } from '../api/client.js';

export function StrategiesPage({ strategies, selectedId, onSelect, onChanged, onClose, onOpenKis, onOpenBacktest, onOpenAutoTrading, user, onLogout }) {
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
          <span>백테스트와 자동매매</span>
        </div>
      </div>

      <div className="account-bar">
        <span>{user?.email}</span>
        <div className="button-row compact">
          <button type="button" className="sm" onClick={onOpenBacktest}>백테스트</button>
          <button type="button" className="sm" onClick={onOpenAutoTrading}>자동매매</button>
          <button type="button" className="sm" onClick={onOpenKis}>KIS 설정</button>
          <button type="button" className="ghost sm" onClick={onLogout}>로그아웃</button>
        </div>
      </div>

      <section className="home-actions" aria-label="주요 기능">
        <button type="button" className="home-action-card primary-card" onClick={onOpenAutoTrading}>
          <span>자동매매</span>
          <strong>한국장·미국장 랭킹 전략 실행</strong>
          <small>실주문 설정을 확인하고 전략별 기록을 관리합니다.</small>
        </button>
        <button type="button" className="home-action-card" onClick={onOpenBacktest}>
          <span>백테스트</span>
          <strong>과거 가격으로 전략 검증</strong>
          <small>KIS 일봉 데이터로 라오어 전략 결과를 확인합니다.</small>
        </button>
        <button type="button" className="home-action-card" onClick={onOpenKis}>
          <span>KIS 설정</span>
          <strong>API 키와 계좌 연결 확인</strong>
          <small>가격 조회와 자동매매에 필요한 연결 상태를 점검합니다.</small>
        </button>
      </section>

      <div className="sidebar-section">
        <div className="section-title" style={{ marginBottom: 10 }}>
          <h4 style={{ margin: 0 }}>라오어 초안</h4>
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
              아직 저장된 라오어 초안이 없습니다.<br />백테스트나 자동매매 화면에서 바로 시작할 수 있습니다.
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
