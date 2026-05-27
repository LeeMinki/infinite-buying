import React, { useEffect, useState } from 'react';
import {
  getKisSettings,
  getKrRankOverview,
  getUsRankOverview,
  listBacktests
} from '../api/client.js';

// 메인 중앙 작업 공간. 현재 상태(KIS 연결·자동매매·전략)와 다음 행동(설정·백테스트·자동매매)을
// 한눈에 보여준다. 전략/백테스트/주문 로직은 건드리지 않고 조회만 한다.
export function DashboardPage({ user, onOpenKis, onOpenBacktest, onOpenAutoTrading }) {
  const [state, setState] = useState({ loading: true });

  useEffect(() => {
    let alive = true;
    (async () => {
      const [kis, kr, us, backtests] = await Promise.all([
        getKisSettings().catch(() => null),
        getKrRankOverview().catch(() => ({ strategies: [], liveOrderEnabled: false })),
        getUsRankOverview().catch(() => ({ strategies: [], liveOrderEnabled: false })),
        listBacktests().catch(() => [])
      ]);
      if (!alive) return;
      setState({ loading: false, kis, kr, us, backtests: Array.isArray(backtests) ? backtests : [] });
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (state.loading) {
    return (
      <section className="content dashboard">
        <div className="empty">대시보드를 불러오는 중...</div>
      </section>
    );
  }

  const kisConnected = Boolean(state.kis?.configured);
  const kisStatus = String(state.kis?.status || '');
  const kisTested = kisConnected && ['TOKEN_VALID', 'CONFIGURED'].includes(kisStatus);
  const liveOrderEnabled = Boolean(state.kr?.liveOrderEnabled || state.us?.liveOrderEnabled);
  const krStrategies = state.kr?.strategies || [];
  const usStrategies = state.us?.strategies || [];
  const allStrategies = [...krStrategies, ...usStrategies];
  const runningStrategies = allStrategies.filter((s) => s.status === 'RUNNING');
  const autoTradingRunning = runningStrategies.length > 0;
  const hasStrategy = allStrategies.length > 0;
  const hasBacktest = (state.backtests || []).length > 0;

  const checklist = [
    { key: 'kis', label: 'KIS API 키 등록', done: kisConnected, action: onOpenKis, cta: 'KIS 설정' },
    { key: 'account', label: '계좌 연결 확인', done: kisConnected && kisTested, action: onOpenKis, cta: '연결 테스트' },
    { key: 'strategy', label: '전략 선택', done: hasStrategy, action: onOpenAutoTrading, cta: '전략 만들기' },
    { key: 'backtest', label: '백테스트 실행', done: hasBacktest, action: onOpenBacktest, cta: '백테스트' },
    { key: 'auto', label: '자동매매 시작', done: autoTradingRunning, action: onOpenAutoTrading, cta: '자동매매' }
  ];

  return (
    <section className="content dashboard">
      <header className="dashboard-header">
        <h2>자동매매 대시보드</h2>
        <p>{user?.email ? `${user.email} · ` : ''}KIS 연결 상태를 확인하고, 백테스트 또는 자동매매를 시작하세요.</p>
      </header>

      <div className="dashboard-status">
        <StatusCard label="KIS 연결" value={kisConnected ? '연결됨' : '미연결'} tone={kisConnected ? 'ok' : 'warn'} />
        <StatusCard
          label="자동매매"
          value={autoTradingRunning ? `실행 중 ${runningStrategies.length}개` : '정지'}
          tone={autoTradingRunning ? 'ok' : 'muted'}
        />
        <StatusCard label="운용 전략" value={hasStrategy ? `${allStrategies.length}개` : '없음'} tone={hasStrategy ? 'info' : 'muted'} />
        <StatusCard label="실주문" value={liveOrderEnabled ? '켜짐' : '꺼짐'} tone={liveOrderEnabled ? 'warn' : 'muted'} />
      </div>

      <section className="home-actions" aria-label="주요 기능">
        <button type="button" className={`home-action-card ${kisConnected ? '' : 'primary-card'}`} onClick={onOpenKis}>
          <span>KIS 설정</span>
          <strong>{kisConnected ? 'API·계좌 연결 확인' : '먼저 API·계좌를 연결하세요'}</strong>
          <small>가격 조회와 자동매매에 필요한 연결 상태를 점검합니다.</small>
        </button>
        <button type="button" className={`home-action-card ${kisConnected ? 'primary-card' : ''}`} onClick={onOpenBacktest}>
          <span>백테스트</span>
          <strong>과거 가격으로 전략 검증</strong>
          <small>KIS 일봉 데이터로 라오어 전략 결과를 확인합니다.</small>
        </button>
        <button type="button" className={`home-action-card ${kisConnected ? 'primary-card' : ''}`} onClick={onOpenAutoTrading}>
          <span>자동매매</span>
          <strong>한국장·미국장 랭킹 전략 실행</strong>
          <small>실주문 설정을 확인하고 전략별 기록을 관리합니다.</small>
        </button>
      </section>

      <div className="dashboard-grid">
        <section className="subsection dashboard-checklist">
          <h4>체크리스트</h4>
          <p className="helper">자동매매를 시작하려면 다음 설정을 확인하세요.</p>
          <ul className="checklist">
            {checklist.map((item) => (
              <li key={item.key} className={item.done ? 'done' : 'todo'}>
                <span className="check-mark" aria-hidden="true">{item.done ? '✅' : '⬜'}</span>
                <span className="check-label">{item.label}</span>
                {!item.done && (
                  <button type="button" className="ghost sm" onClick={item.action}>{item.cta}</button>
                )}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </section>
  );
}

function StatusCard({ label, value, tone }) {
  return (
    <div className={`status-card tone-${tone}`}>
      <span className="status-card-label">{label}</span>
      <strong className="status-card-value">{value}</strong>
    </div>
  );
}
