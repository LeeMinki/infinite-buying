import React, { useEffect, useState } from 'react';
import { getKisSettings, getKrRankOverview, getUsRankOverview } from '../api/client.js';

// 사이드바: 네비게이션 + 가벼운 상태 요약만 담당한다. 주요 행동·상태 상세는 중앙 대시보드(DashboardPage)에 있다.
export function StrategiesPage({ activeView = 'dashboard', onClose, onOpenKis, onOpenBacktest, onOpenAutoTrading, user, onLogout }) {
  const [status, setStatus] = useState({ kisConnected: null, autoTradingRunning: null });

  useEffect(() => {
    let alive = true;
    (async () => {
      const [kis, kr, us] = await Promise.all([
        getKisSettings().catch(() => null),
        getKrRankOverview().catch(() => ({ strategies: [] })),
        getUsRankOverview().catch(() => ({ strategies: [] }))
      ]);
      if (!alive) return;
      const running = [...(kr?.strategies || []), ...(us?.strategies || [])].some((s) => s.status === 'RUNNING');
      setStatus({ kisConnected: Boolean(kis?.configured), autoTradingRunning: running });
    })();
    return () => {
      alive = false;
    };
  }, []);

  const navItems = [
    { key: 'dashboard', label: '대시보드', onClick: onClose },
    { key: 'strategies', label: '전략', onClick: onOpenAutoTrading },
    { key: 'backtest', label: '백테스트', onClick: onOpenBacktest },
    { key: 'auto-trading', label: '자동매매', onClick: onOpenAutoTrading },
    { key: 'orders', label: '주문/체결 로그', onClick: onOpenAutoTrading },
    { key: 'kis', label: 'KIS 설정', onClick: onOpenKis }
  ];

  return (
    <aside className="sidebar">
      <button type="button" className="sidebar-close" onClick={onClose} aria-label="사이드바 닫기">
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

      <nav className="sidebar-nav" aria-label="주요 메뉴">
        {navItems.map((item) => (
          <button
            key={item.key}
            type="button"
            className={`sidebar-nav-item ${item.key === activeView ? 'active' : ''}`}
            onClick={item.onClick}
          >
            {item.label}
          </button>
        ))}
      </nav>

      <div className="sidebar-status">
        <span className="sidebar-status-email">{user?.email}</span>
        <span className={`status-dot ${status.kisConnected ? 'ok' : 'warn'}`}>
          KIS {status.kisConnected == null ? '확인 중' : status.kisConnected ? '연결됨' : '미연결'}
        </span>
        <span className={`status-dot ${status.autoTradingRunning ? 'ok' : 'muted'}`}>
          자동매매 {status.autoTradingRunning == null ? '확인 중' : status.autoTradingRunning ? '실행 중' : '정지'}
        </span>
        <button type="button" className="ghost sm" onClick={onLogout}>로그아웃</button>
      </div>
    </aside>
  );
}
