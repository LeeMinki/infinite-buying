import React, { useEffect, useState } from 'react';
import { StrategiesPage } from './pages/StrategiesPage.jsx';
import { StrategyDetailPage } from './pages/StrategyDetailPage.jsx';
import { listStrategies } from './api/client.js';

const SIDEBAR_KEY = 'ib.sidebarOpen';
const NARROW_QUERY = '(max-width: 1100px)';

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
  const [strategies, setStrategies] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(getInitialSidebarState);

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
    refreshStrategies().catch(console.error);
  }, []);

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

  return (
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
      />
      <StrategyDetailPage strategyId={selectedId} onChanged={refreshStrategies} />
    </main>
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
