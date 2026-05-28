import React, { useEffect, useState } from 'react';
import { getAutoTradingDashboard } from '../api/client.js';

export function DashboardPage({ user, onOpenKis, onOpenBacktest, onOpenAutoTrading }) {
  const [state, setState] = useState({ loading: true });

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const dashboard = await getAutoTradingDashboard();
        if (alive) setState({ loading: false, dashboard, error: '' });
      } catch (error) {
        if (alive) setState({ loading: false, dashboard: null, error: error.message || '대시보드를 불러오지 못했습니다.' });
      }
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

  const dashboard = state.dashboard || {};
  const operation = dashboard.operationStatus || {};
  const account = dashboard.account || {};
  const byCurrency = account.byCurrency || {};
  const strategyGroups = dashboard.strategyGroups || [];
  const pendingSetup = buildChecklist(dashboard);
  const hasSetupIssue = pendingSetup.some((item) => !item.done);
  const recentOrders = dashboard.recentOrders || [];
  const recentErrors = dashboard.recentErrors || [];

  const runningTotal = strategyGroups.reduce((sum, group) => sum + (group.runningCount || 0), 0);
  const errorTotal = strategyGroups.reduce((sum, group) => sum + (group.errorCount || 0), 0);
  const totalStrategies = strategyGroups.reduce((sum, group) => sum + (group.totalCount || 0), 0);
  const kisConnected = Boolean(operation.kisConnected);

  return (
    <section className="content dashboard">
      <header className="dashboard-header">
        <h2>운용 대시보드</h2>
        <p>{user?.email ? `${user.email} · ` : ''}계좌, 전략, 주문 상태를 한 화면에서 확인합니다.</p>
      </header>

      {state.error && <p className="error">{state.error}</p>}

      {/* 히어로 KPI: 진입 즉시 보이는 핵심 지표(매수가능금액·운용 상태) */}
      <section className="kpi-strip" aria-label="핵심 지표">
        <KpiCard
          label="매수가능금액 (KRW)"
          value={formatMoneyMetric(byCurrency.KRW?.buyableCash, 'KRW')}
          available={byCurrency.KRW?.buyableCash?.status === 'available'}
        />
        <KpiCard
          label="매수가능금액 (USD)"
          value={formatMoneyMetric(byCurrency.USD?.buyableCash, 'USD')}
          available={byCurrency.USD?.buyableCash?.status === 'available'}
        />
        <KpiCard
          label="실행 중 전략"
          value={`${runningTotal}개`}
          sub={`전체 ${totalStrategies}개${errorTotal > 0 ? ` · 오류 ${errorTotal}` : ''}`}
          tone={errorTotal > 0 ? 'danger' : runningTotal > 0 ? 'ok' : 'muted'}
          available
        />
        <KpiCard
          label="KIS 연결"
          value={kisConnected ? '연결됨' : '미연결'}
          sub={operation.liveOrderEnabled ? '실주문 켜짐' : '실주문 꺼짐'}
          tone={kisConnected ? 'ok' : 'warn'}
          available
        />
      </section>

      {hasSetupIssue && (
        <section className="subsection dashboard-checklist warning">
          <h4>체크리스트</h4>
          <p className="helper">운용 상태를 정확히 보려면 아래 항목을 먼저 확인하세요.</p>
          <ul className="checklist">
            {pendingSetup.map((item) => (
              <li key={item.key} className={item.done ? 'done' : 'todo'}>
                <Badge tone={item.done ? 'ok' : 'warn'}>{item.done ? '완료' : '필요'}</Badge>
                <span className="check-label">{item.label}</span>
                {!item.done && (
                  <button type="button" className="ghost sm" onClick={item.action === 'kis' ? onOpenKis : onOpenAutoTrading}>{item.cta}</button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="dashboard-panel">
        <div className="panel-heading">
          <div>
            <h3>계좌 요약</h3>
            <p>{account.lookupStatus === 'ok' ? 'KIS에서 조회한 매수가능금액 기준입니다.' : account.lookupMessage || '계좌 조회 상태를 확인하세요.'}</p>
          </div>
          <Badge tone={lookupTone(account.lookupStatus)}>{lookupLabel(account.lookupStatus)}</Badge>
        </div>
        <div className="account-currency-grid">
          {['KRW', 'USD'].map((currency) => (
            <CurrencyAccountCard key={currency} currency={currency} data={byCurrency[currency]} />
          ))}
        </div>
      </section>

      <section className="ops-strip" aria-label="운영 상태">
        <StatusCard label="실주문" value={operation.liveOrderEnabled ? '켜짐' : '꺼짐'} tone={operation.liveOrderEnabled ? 'warn' : 'muted'} />
        <StatusCard label="한국장" value={marketLabel(operation.marketSessions?.KR)} tone={operation.marketSessions?.KR?.status === 'OPEN' ? 'ok' : 'muted'} />
        <StatusCard label="미국장" value={marketLabel(operation.marketSessions?.US)} tone={operation.marketSessions?.US?.status === 'OPEN' ? 'ok' : 'muted'} />
      </section>

      <section className="dashboard-panel">
        <div className="panel-heading">
          <div>
            <h3>전략별 상태</h3>
            <p>라오어, 한국 랭킹, 미국장 랭킹 전략의 최근 판단과 주문 상태입니다.</p>
          </div>
          <span className="heading-meta">{totalStrategies}개</span>
        </div>
        <div className="strategy-status-grid">
          {strategyGroups.map((group) => (
            <StrategyStatusCard key={group.key} group={group} />
          ))}
        </div>
      </section>

      <div className="dashboard-two-column">
        <section className="dashboard-panel">
          <div className="panel-heading">
            <div>
              <h3>최근 주문/체결</h3>
              <p>자동매매가 만든 최근 주문 상태입니다.</p>
            </div>
          </div>
          <div className="compact-list">
            {recentOrders.slice(0, 6).map((order) => (
              <div className="compact-row" key={`${order.strategyId}-${order.id}-${order.createdAt}`}>
                <div className="compact-row-head">
                  <span className="compact-symbol">{order.symbol || '-'}</span>
                  <Badge tone={order.side === 'SELL' ? 'info' : 'ok'}>{order.side === 'SELL' ? '매도' : '매수'}</Badge>
                  <span className="compact-status">{orderStatusLabel(order.status)}</span>
                </div>
                <small>{formatMoney(order.estimatedAmount, order.currency)} · {formatDateTime(order.createdAt)}</small>
              </div>
            ))}
            {recentOrders.length === 0 && <div className="empty compact-empty">아직 주문 기록이 없습니다.</div>}
          </div>
        </section>

        <section className="dashboard-panel">
          <div className="panel-heading">
            <div>
              <h3>최근 오류와 관망 사유</h3>
              <p>주문하지 않은 이유나 확인이 필요한 오류입니다.</p>
            </div>
          </div>
          <div className="compact-list">
            {recentErrors.slice(0, 6).map((item, index) => (
              <div className="compact-row" key={`${item.strategyType}-${item.id ?? index}`}>
                <div className="compact-row-head">
                  <span className="compact-symbol">{item.label}</span>
                  <Badge tone={item.type === 'ERROR' ? 'danger' : 'muted'}>{item.type === 'ERROR' ? '오류' : '관망'}</Badge>
                  {item.createdAt && <span className="compact-status">{formatDateTime(item.createdAt)}</span>}
                </div>
                <small>{item.reason || '-'}</small>
              </div>
            ))}
            {recentErrors.length === 0 && <div className="empty compact-empty">최근 오류나 관망 사유가 없습니다.</div>}
          </div>
        </section>
      </div>

      {/* 상단 메뉴와 중복되지 않도록, 화면 이동은 하단의 조용한 바로가기로만 둔다 */}
      <nav className="dashboard-quicklinks" aria-label="바로가기">
        <span className="quicklinks-label">바로가기</span>
        <button type="button" className="linklike" onClick={onOpenKis}>KIS 설정</button>
        <button type="button" className="linklike" onClick={onOpenBacktest}>백테스트</button>
        <button type="button" className="linklike" onClick={onOpenAutoTrading}>자동매매</button>
      </nav>
    </section>
  );
}

function KpiCard({ label, value, sub, tone = 'default', available = false }) {
  return (
    <div className={`kpi-card kpi-${tone}`}>
      <span className="kpi-label">{label}</span>
      <strong className={`kpi-value ${available ? '' : 'kpi-value-muted'}`}>{value}</strong>
      {sub && <span className="kpi-sub">{sub}</span>}
    </div>
  );
}

function CurrencyAccountCard({ currency, data = {} }) {
  const cashAvailable = data.buyableCash?.status === 'available';
  return (
    <div className="currency-account-card">
      <div className="currency-title">
        <strong>{currency}</strong>
        {data.exchangeRate ? <span className="currency-fx">₩{formatNumber(data.exchangeRate)} / {currency}</span> : null}
      </div>
      <div className="metric-grid compact">
        <Metric label="매수가능금액" value={formatMoneyMetric(data.buyableCash, currency)} hint={cashAvailable ? '' : metricHint(data.buyableCash)} />
        {currency === 'USD' && data.cashAvailableAfterFx?.status === 'available' && (
          <Metric label="환전 후 매수가능" value={formatMoneyMetric(data.cashAvailableAfterFx, currency)} />
        )}
      </div>
      {cashAvailable
        ? <p className="metric-progress">보유 평가금액·당일 손익은 준비 중입니다.</p>
        : data.lookupMessage ? <p className="helper">{data.lookupMessage}</p> : null}
    </div>
  );
}

function StrategyStatusCard({ group }) {
  return (
    <article className="strategy-status-card">
      <div className="strategy-status-head">
        <div className="strategy-status-title">
          <span className={`status-dot-viz dot-${(group.status || 'empty').toLowerCase()}`} aria-hidden="true" />
          <div>
            <h4>{group.label}</h4>
            <p>{group.totalCount > 0 ? `${group.totalCount}개 전략 · 실행 중 ${group.runningCount}개` : '아직 전략이 없습니다.'}</p>
          </div>
        </div>
        <Badge tone={strategyTone(group.status)}>{strategyStatusLabel(group.status)}</Badge>
      </div>
      <dl className="status-detail-list">
        <div>
          <dt>최근 판단</dt>
          <dd>{group.recentDecision ? `${decisionLabel(group.recentDecision.decision)} · ${group.recentDecision.reason || '-'}` : '기록 없음'}</dd>
        </div>
        <div>
          <dt>최근 주문</dt>
          <dd>{group.recentOrder ? `${group.recentOrder.symbol || '-'} ${group.recentOrder.side === 'SELL' ? '매도' : '매수'} · ${orderStatusLabel(group.recentOrder.status)}` : '기록 없음'}</dd>
        </div>
        <div>
          <dt>확인 사항</dt>
          <dd>{group.recentIssue?.reason || '특이사항 없음'}</dd>
        </div>
      </dl>
    </article>
  );
}

function Badge({ tone = 'muted', children }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

function StatusCard({ label, value, tone }) {
  return (
    <div className={`status-card tone-${tone}`}>
      <span className="status-card-label">{label}</span>
      <strong className="status-card-value">{value}</strong>
    </div>
  );
}

function Metric({ label, value, hint }) {
  return (
    <div className="metric">
      <span className="metric-label">{label}</span>
      <strong>{value}</strong>
      {hint && <span className="metric-hint">{hint}</span>}
    </div>
  );
}

function buildChecklist(dashboard) {
  const operation = dashboard.operationStatus || {};
  const hasStrategy = (dashboard.strategyGroups || []).some((group) => group.totalCount > 0);
  return [
    { key: 'kis', label: 'KIS API 키 등록', done: Boolean(operation.kisConnected), action: 'kis', cta: 'KIS 설정' },
    { key: 'account', label: '계좌 연결 확인', done: Boolean(operation.accountConfigured) && dashboard.account?.lookupStatus === 'ok', action: 'kis', cta: '연결 확인' },
    { key: 'strategy', label: '자동매매 전략 준비', done: hasStrategy, action: 'auto', cta: '전략 만들기' }
  ];
}

function lookupTone(status) {
  return status === 'ok' ? 'ok' : status === 'not_configured' ? 'warn' : 'warn';
}

function lookupLabel(status) {
  if (status === 'ok') return '조회 완료';
  if (status === 'not_configured') return '설정 필요';
  return '확인 필요';
}

function strategyTone(status) {
  if (status === 'RUNNING') return 'ok';
  if (status === 'ERROR') return 'danger';
  return 'muted';
}

function formatMoneyMetric(metric, currency) {
  if (!metric || metric.status !== 'available') return '—';
  return formatMoney(metric.value, currency);
}

function metricHint(metric) {
  return metric?.status === 'available' ? '' : metric?.reason || '데이터 부족';
}

function formatMoney(value, currency = 'KRW') {
  const n = Number(value);
  if (!Number.isFinite(n)) return '-';
  const fraction = currency === 'KRW' ? 0 : 2;
  return `${currency} ${n.toLocaleString('ko-KR', { minimumFractionDigits: fraction, maximumFractionDigits: fraction })}`;
}

function formatNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '-';
  return n.toLocaleString('ko-KR', { maximumFractionDigits: 2 });
}

function marketLabel(session) {
  if (!session) return '확인 중';
  if (session.status === 'OPEN') return '열림';
  if (session.status === 'CLOSED') return '닫힘';
  return '확인 필요';
}

function strategyStatusLabel(status) {
  if (status === 'RUNNING') return '실행 중';
  if (status === 'ERROR') return '오류';
  if (status === 'STOPPED') return '정지';
  return '없음';
}

function decisionLabel(value) {
  const labels = { BUY: '매수', SELL: '매도', HOLD: '보유', SKIP: '관망', ERROR: '오류' };
  return labels[value] || value || '-';
}

function orderStatusLabel(status) {
  const labels = {
    FILLED: '체결', ACCEPTED: '접수', SUBMITTED: '제출', PARTIAL: '부분체결',
    CANCELLED: '취소', REJECTED: '거부', FAILED: '실패', PENDING: '대기'
  };
  return labels[status] || status || '-';
}

function formatDateTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}
