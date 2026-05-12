import React, { Suspense, lazy, useEffect, useState } from 'react';
import { AuthProvider, useAuth } from './auth/AuthContext.jsx';
import { LoginPage } from './auth/LoginPage.jsx';
import { RegisterPage } from './auth/RegisterPage.jsx';
import { listStrategies } from './api/client.js';

const SIDEBAR_KEY = 'ib.sidebarOpen';
const NARROW_QUERY = '(max-width: 1100px)';
const StrategiesPage = lazy(() => import('./pages/StrategiesPage.jsx').then((module) => ({ default: module.StrategiesPage })));
const StrategyDetailPage = lazy(() => import('./pages/StrategyDetailPage.jsx').then((module) => ({ default: module.StrategyDetailPage })));
const KisSetupPage = lazy(() => import('./pages/KisSetupPage.jsx').then((module) => ({ default: module.KisSetupPage })));
const BacktestPage = lazy(() => import('./pages/BacktestPage.jsx').then((module) => ({ default: module.BacktestPage })));

function isNarrow() {
  return typeof window !== 'undefined' && window.matchMedia(NARROW_QUERY).matches;
}

function getInitialSidebarState() {
  if (typeof window === 'undefined') return true;
  if (isNarrow()) return false;
  const saved = window.localStorage.getItem(SIDEBAR_KEY);
  return saved === null ? true : saved === '1';
}

export default function App() {
  return (
    <AuthProvider>
      <AuthenticatedApp />
    </AuthProvider>
  );
}

function AuthenticatedApp() {
  const auth = useAuth();
  const [authMode, setAuthMode] = useState('login');
  const [strategies, setStrategies] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(getInitialSidebarState);
  const [view, setViewState] = useState('strategies');

  function setView(nextView) {
    if (nextView === view) return;
    if (typeof window === 'undefined') {
      setViewState(nextView);
      return;
    }
    if (nextView === 'strategies') {
      const onSubpage = window.history.state && window.history.state.ibView && window.history.state.ibView !== 'strategies';
      if (onSubpage) {
        window.history.back();
        return;
      }
      setViewState(nextView);
      return;
    }
    window.history.pushState({ ibView: nextView }, '', `#${nextView}`);
    setViewState(nextView);
  }

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onPop = (event) => {
      const next = event.state && event.state.ibView ? event.state.ibView : 'strategies';
      setViewState(next);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  async function refreshStrategies(nextSelectedId = selectedId) {
    const items = await listStrategies();
    setStrategies(items);
    if (nextSelectedId) {
      setSelectedId(nextSelectedId);
      if (isNarrow()) setSidebarOpen(false);
    } else if (!selectedId && items.length > 0) {
      setSelectedId(items[0].id);
    }
  }

  useEffect(() => {
    if (auth.user) refreshStrategies().catch(console.error);
  }, [auth.user]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia(NARROW_QUERY);
    const handler = (event) => {
      if (event.matches) {
        setSidebarOpen(false);
      }
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  function setSidebar(next) {
    setSidebarOpen(next);
    try {
      if (!isNarrow()) window.localStorage.setItem(SIDEBAR_KEY, next ? '1' : '0');
    } catch {}
  }

  function toggleSidebar() {
    setSidebar(!sidebarOpen);
  }

  function handleSelect(id) {
    setSelectedId(id);
    if (isNarrow()) setSidebar(false);
  }

  if (auth.loading) {
    return <section className="auth-screen"><div className="auth-panel">로딩 중...</div></section>;
  }

  if (!auth.user) {
    return authMode === 'login'
      ? <LoginPage onSwitch={() => setAuthMode('register')} />
      : <RegisterPage onSwitch={() => setAuthMode('login')} />;
  }

  if (view === 'kis') {
    return (
      <Suspense fallback={<section className="auth-screen"><div className="auth-panel">화면 준비 중...</div></section>}>
        <KisSetupPage onBack={() => setView('strategies')} />
      </Suspense>
    );
  }

  if (view === 'backtest') {
    return (
      <Suspense fallback={<section className="auth-screen"><div className="auth-panel">화면 준비 중...</div></section>}>
        <BacktestPage onBack={() => setView('strategies')} />
      </Suspense>
    );
  }

  return (
    <Suspense fallback={<section className="auth-screen"><div className="auth-panel">화면 준비 중...</div></section>}>
      <main className={`app-shell ${sidebarOpen ? '' : 'collapsed'}`}>
        <button
          type="button"
          className="sidebar-toggle"
          onClick={toggleSidebar}
          aria-label={sidebarOpen ? '사이드바 접기' : '사이드바 펼치기'}
          title={sidebarOpen ? '사이드바 접기' : '사이드바 펼치기'}
        >
          <ChevronIcon direction={sidebarOpen ? 'left' : 'right'} />
        </button>
        <div
          className="sidebar-backdrop"
          onClick={() => setSidebar(false)}
          aria-hidden="true"
        />
        <StrategiesPage
          strategies={strategies}
          selectedId={selectedId}
          onSelect={handleSelect}
          onChanged={refreshStrategies}
          onClose={() => setSidebar(false)}
          onOpenKis={() => setView('kis')}
          onOpenBacktest={() => setView('backtest')}
          user={auth.user}
          onLogout={auth.logout}
        />
        <StrategyDetailPage strategyId={selectedId} onChanged={refreshStrategies} />
      </main>
    </Suspense>
  );
}

function ChevronIcon({ direction }) {
  if (direction === 'left') {
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
        <path d="M9 11L5 7L9 3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M5 11L9 7L5 3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
