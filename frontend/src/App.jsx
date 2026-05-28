import React, { Suspense, lazy, useEffect, useState } from 'react';
import { AuthProvider, useAuth } from './auth/AuthContext.jsx';
import { LoginPage } from './auth/LoginPage.jsx';
import { RegisterPage } from './auth/RegisterPage.jsx';

const StrategiesPage = lazy(() => import('./pages/StrategiesPage.jsx').then((module) => ({ default: module.StrategiesPage })));
const DashboardPage = lazy(() => import('./pages/DashboardPage.jsx').then((module) => ({ default: module.DashboardPage })));
const KisSetupPage = lazy(() => import('./pages/KisSetupPage.jsx').then((module) => ({ default: module.KisSetupPage })));
const BacktestPage = lazy(() => import('./pages/BacktestPage.jsx').then((module) => ({ default: module.BacktestPage })));
const AutoTradingPage = lazy(() => import('./pages/AutoTradingPage.jsx').then((module) => ({ default: module.AutoTradingPage })));

const KNOWN_VIEWS = new Set(['strategies', 'kis', 'backtest', 'auto-trading']);

// F5 후에도 현재 보고 있던 화면이 유지되도록 URL hash(#auto-trading 등)에서 view를 복원한다.
// hash가 없거나 모르는 값이면 기본 화면.
function getInitialView() {
  if (typeof window === 'undefined') return 'strategies';
  const hash = (window.location.hash || '').replace(/^#/, '');
  if (KNOWN_VIEWS.has(hash) && hash !== 'strategies') {
    // hash와 history state를 정렬해 popstate 동작도 정상화한다.
    try {
      window.history.replaceState({ ibView: hash }, '', `#${hash}`);
    } catch {}
    return hash;
  }
  return 'strategies';
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
  const [view, setViewState] = useState(getInitialView);
  const [strategySeed, setStrategySeed] = useState(null);

  function setView(nextView, { replace = false } = {}) {
    if (nextView === view) return;
    if (typeof window === 'undefined') {
      setViewState(nextView);
      return;
    }
    const url = nextView === 'strategies'
      ? `${window.location.pathname}${window.location.search}`
      : `#${nextView}`;
    const method = replace ? 'replaceState' : 'pushState';
    window.history[method]({ ibView: nextView }, '', url);
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

  function openBacktest(strategy = null) {
    setStrategySeed(strategy);
    setView('backtest');
  }

  function openAutoTrading(strategy = null) {
    setStrategySeed(strategy);
    setView('auto-trading');
  }

  if (auth.loading) {
    return <section className="auth-screen"><div className="auth-panel">로딩 중...</div></section>;
  }

  if (!auth.user) {
    return authMode === 'login'
      ? <LoginPage onSwitch={() => setAuthMode('register')} />
      : <RegisterPage onSwitch={() => setAuthMode('login')} />;
  }

  return (
    <Suspense fallback={<section className="auth-screen"><div className="auth-panel">화면 준비 중...</div></section>}>
      <main className="app-shell">
        <StrategiesPage
          activeView={view === 'strategies' ? 'dashboard' : view}
          onOpenDashboard={() => setView('strategies', { replace: true })}
          onOpenKis={() => setView('kis')}
          onOpenBacktest={() => openBacktest()}
          onOpenAutoTrading={() => openAutoTrading()}
          user={auth.user}
          onLogout={auth.logout}
        />
        {view === 'kis' ? (
          <KisSetupPage onBack={() => setView('strategies')} />
        ) : view === 'backtest' ? (
          <BacktestPage onBack={() => setView('strategies')} initialStrategy={strategySeed} />
        ) : view === 'auto-trading' ? (
          <AutoTradingPage onBack={() => setView('strategies')} initialStrategy={strategySeed} />
        ) : (
          <DashboardPage
            user={auth.user}
            onOpenKis={() => setView('kis')}
            onOpenBacktest={() => openBacktest()}
            onOpenAutoTrading={() => openAutoTrading()}
          />
        )}
      </main>
    </Suspense>
  );
}
