import React, { useEffect, useState } from 'react';
import {
  getKisSettings,
  getKrRankOverview,
  getUsRankOverview,
  listBacktests
} from '../api/client.js';

// 메인 중앙 작업 공간. 현재 상태(KIS 연결·자동매매·전략·최근 백테스트)와 다음 행동(설정·백테스트·
// 자동매매)을 한눈에 보여준다. 전략/백테스트/주문 로직은 건드리지 않고 조회만 한다.
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
  const backtests = state.backtests;
  const hasBacktest = backtests.length > 0;
  const recentBacktest = backtests[0] || null;

  const checklist = [
    { key: 'kis', label: 'KIS API 키 등록', done: kisConnected, action: onOpenKis, cta: 'KIS 설정' },
    { key: 'account', label: '계좌 연결 확인', done: kisConnected && kisTested, action: onOpenKis, cta: '연결 테스트' },
    { key: 'strategy', label: '전략 선택', done: hasStrategy, action: onOpenAutoTrading, cta: '전략 만들기' },
    { key: 'backtest', label: '백테스트 실행', done: hasBacktest, action: onOpenBacktest, cta: '백테스트' },
    { key: 'auto', label: '자동매매 시작', done: autoTradingRunning, action: onOpenAutoTrading, cta: '자동매매' }
  ];
  const allDone = checklist.every((item) => item.done);

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
        <StatusCard
          label="최근 백테스트"
          value={recentBacktest ? `${recentBacktest.symbol} ${formatPct(recentBacktest.returnRate)}` : '없음'}
          tone={recentBacktest ? 'info' : 'muted'}
        />
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
          <h4>시작 체크리스트</h4>
          {allDone ? (
            <p className="helper">설정이 모두 완료됐습니다. 자동매매 상태를 확인하세요.</p>
          ) : (
            <p className="helper">자동매매를 시작하려면 다음 설정이 필요합니다.</p>
          )}
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

        <section className="subsection dashboard-activity">
          <h4>최근 활동</h4>
          {hasBacktest ? (
            <div className="activity-item">
              <span className="activity-title">최근 백테스트</span>
              <span className="activity-body">
                {recentBacktest.symbol} · 수익률 {formatPct(recentBacktest.returnRate)} · {recentBacktest.fromDate}~{recentBacktest.toDate}
              </span>
              <button type="button" className="ghost sm" onClick={onOpenBacktest}>백테스트 화면</button>
            </div>
          ) : (
            <div className="activity-item empty-activity">
              <span className="activity-title">최근 백테스트</span>
              <span className="activity-body">아직 백테스트 결과가 없습니다. 백테스트를 실행하면 여기에 표시됩니다.</span>
              <button type="button" className="ghost sm" onClick={onOpenBacktest}>백테스트 실행</button>
            </div>
          )}
          {autoTradingRunning ? (
            <div className="activity-item">
              <span className="activity-title">주문/체결 로그</span>
              <span className="activity-body">
                실행 중: {runningStrategies.map((s) => s.holdingSymbol ? `${s.holdingSymbolName || s.holdingSymbol}` : (s.exchange || '랭킹')).join(', ')}
              </span>
              <button type="button" className="ghost sm" onClick={onOpenAutoTrading}>자동매매 화면</button>
            </div>
          ) : (
            <div className="activity-item empty-activity">
              <span className="activity-title">주문/체결 로그</span>
              <span className="activity-body">자동매매를 시작하면 주문·체결 기록이 여기에 표시됩니다.</span>
              <button type="button" className="ghost sm" onClick={onOpenAutoTrading}>자동매매 설정</button>
            </div>
          )}
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

function formatPct(rate) {
  const n = Number(rate);
  if (!Number.isFinite(n)) return '-';
  return `${n >= 0 ? '+' : ''}${(n * 100).toFixed(2)}%`;
}
