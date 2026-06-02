import React, { useEffect, useState } from 'react';
import { getKisSettings, getKrRankOverview, getUsRankOverview } from '../api/client.js';

// 상단 네비게이션: 주요 화면 이동과 가벼운 상태 요약만 담당한다.
export function StrategiesPage({ activeView = 'dashboard', onOpenDashboard, onOpenKis, onOpenBacktest, onOpenAutoTrading, user, onLogout }) {
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
    { key: 'dashboard', label: '대시보드', onClick: onOpenDashboard },
    { key: 'backtest', label: '백테스트', onClick: onOpenBacktest },
    { key: 'auto-trading', label: '자동매매', onClick: onOpenAutoTrading },
    { key: 'kis', label: 'KIS 설정', onClick: onOpenKis }
  ];

  return (
    <header className="top-nav">
      <div className="brand">
        <div className="brand-logo" aria-hidden="true">∞</div>
        <div className="brand-text">
          <h1>무한매수 해죠</h1>
          <span>티끌모아 태산</span>
        </div>
      </div>

      <nav className="top-nav-menu" aria-label="주요 메뉴">
        {navItems.map((item) => (
          <button
            key={item.key}
            type="button"
            className={`top-nav-item ${item.key === activeView ? 'active' : ''}`}
            onClick={item.onClick}
          >
            {item.label}
          </button>
        ))}
      </nav>

      <div className="top-nav-status">
        <span className="top-nav-email">{user?.email}</span>
        <span className={`status-dot ${status.kisConnected ? 'ok' : 'warn'}`}>
          KIS {status.kisConnected == null ? '확인 중' : status.kisConnected ? '연결됨' : '미연결'}
        </span>
        <span className={`status-dot ${status.autoTradingRunning ? 'ok' : 'muted'}`}>
          자동매매 {status.autoTradingRunning == null ? '확인 중' : status.autoTradingRunning ? '실행 중' : '정지'}
        </span>
        <button type="button" className="ghost sm" onClick={onLogout}>로그아웃</button>
      </div>
    </header>
  );
}
