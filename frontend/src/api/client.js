const rawApiBase = import.meta.env.VITE_API_BASE || (import.meta.env.DEV ? 'http://localhost:4000' : '');

function normalizeApiBase(value) {
  if (!value || value === '/') return '';
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

function toApiUrl(path) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${normalizeApiBase(rawApiBase)}${normalizedPath}`;
}

async function request(path, options = {}) {
  let response;
  try {
    response = await fetch(toApiUrl(path), {
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      },
      ...options
    });
  } catch {
    throw new Error('서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.');
  }

  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
  }

  if (!response.ok) {
    const message =
      data?.error ||
      (typeof data?.raw === 'string' && !data.raw.startsWith('<') ? data.raw : null) ||
      `요청에 실패했습니다. (${response.status})`;
    const error = new Error(message);
    error.data = data;
    throw error;
  }
  return data;
}

export const listStrategies = () => request('/api/strategies');
export const createStrategy = (payload) => request('/api/strategies', { method: 'POST', body: JSON.stringify(payload) });
export const updateStrategy = (id, payload) => request(`/api/strategies/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
export const deleteStrategy = (id) => request(`/api/strategies/${id}`, { method: 'DELETE' });
export const getStrategy = (id) => request(`/api/strategies/${id}`);
export const getHolding = (id) => request(`/api/strategies/${id}/holding`);
export const evaluateStrategy = (id, currentPrice) => request(`/api/strategies/${id}/evaluate`, {
  method: 'POST',
  body: JSON.stringify({ currentPrice })
});
export const searchStocks = (query) => request(`/api/market/stocks/search?q=${encodeURIComponent(query)}`);
export const getCurrentPrice = (symbol, options = {}) => {
  const market = normalizeMarket(options.market, symbol);
  const params = new URLSearchParams();
  if (options.exchange) params.set('exchange', options.exchange);
  const suffix = params.toString() ? `?${params.toString()}` : '';
  return request(`/api/market/${market}/${symbol}/price${suffix}`);
};
export const getDailyPrices = (symbol, options = {}) => {
  const market = normalizeMarket(options.market, symbol);
  const params = new URLSearchParams();
  if (options.exchange) params.set('exchange', options.exchange);
  if (options.from) params.set('from', options.from);
  if (options.to) params.set('to', options.to);
  if (options.refresh) params.set('refresh', 'true');
  const suffix = params.toString() ? `?${params.toString()}` : '';
  return request(`/api/market/${market}/${symbol}/daily${suffix}`);
};
export const listOrders = (id) => request(`/api/strategies/${id}/orders`);
export const listLogs = (id) => request(`/api/strategies/${id}/logs`);
export const fillOrder = (id) => request(`/api/orders/${id}/fill`, { method: 'POST' });
export const cancelOrder = (id) => request(`/api/orders/${id}/cancel`, { method: 'POST' });
export const register = (payload) => request('/api/auth/register', { method: 'POST', body: JSON.stringify(payload) });
export const login = (payload) => request('/api/auth/login', { method: 'POST', body: JSON.stringify(payload) });
export const logout = () => request('/api/auth/logout', { method: 'POST' });
export const getMe = () => request('/api/auth/me');
export const getKisSettings = () => request('/api/settings/kis');
export const saveKisSettings = (payload) => request('/api/settings/kis', { method: 'POST', body: JSON.stringify(payload) });
export const deleteKisSettings = () => request('/api/settings/kis', { method: 'DELETE' });
export const testKisSettings = () => request('/api/settings/kis/test', { method: 'POST' });

export const listBacktests = () => request('/api/backtests');
export const createBacktest = (payload) => request('/api/backtests', { method: 'POST', body: JSON.stringify(payload) });
export const getBacktest = (id) => request(`/api/backtests/${id}`);
export const listBacktestTrades = (id) => request(`/api/backtests/${id}/trades`);
export const deleteBacktest = (id) => request(`/api/backtests/${id}`, { method: 'DELETE' });

export const getAutoTradingSettings = () => request('/api/auto-trading/settings');
export const updateAutoTradingLiveOrder = (liveOrderEnabled) => request('/api/auto-trading/settings/live-order', {
  method: 'PUT',
  body: JSON.stringify({ liveOrderEnabled })
});
export const getAutoTradingDashboard = () => request('/api/auto-trading/dashboard');
export const getAutoTradingAccountSummary = (strategyId) => request(`/api/auto-trading/account-summary?strategyId=${encodeURIComponent(strategyId)}`);
export const getAutoTradingBuyingPowerPreview = ({ market, symbol, exchange } = {}) => {
  const params = new URLSearchParams();
  if (market) params.set('market', market);
  if (symbol) params.set('symbol', symbol);
  if (exchange) params.set('exchange', exchange);
  const suffix = params.toString() ? `?${params.toString()}` : '';
  return request(`/api/auto-trading/buying-power-preview${suffix}`);
};
export const createAutoTradingStrategy = (payload) => request('/api/auto-trading/strategies', {
  method: 'POST',
  body: JSON.stringify(payload)
});
export const listAutoTradingStrategies = () => request('/api/auto-trading/strategies');
export const getAutoTradingStrategy = (id) => request(`/api/auto-trading/strategies/${id}`);
export const updateAutoTradingStrategy = (id, payload) => request(`/api/auto-trading/strategies/${id}`, {
  method: 'PUT',
  body: JSON.stringify(payload)
});
export const deleteAutoTradingStrategy = (id) => request(`/api/auto-trading/strategies/${id}`, { method: 'DELETE' });
export const startAutoTradingStrategy = (id) => request(`/api/auto-trading/strategies/${id}/start`, { method: 'POST' });
export const stopAutoTradingStrategy = (id) => request(`/api/auto-trading/strategies/${id}/stop`, { method: 'POST' });
export const evaluateAutoTradingStrategy = (id) => request(`/api/auto-trading/strategies/${id}/evaluate`, { method: 'POST' });
export const listAutoTradingOrders = (id, paging) => request(`/api/auto-trading/strategies/${id}/orders${pageQuery(paging)}`);
export const listAutoTradingDecisions = (id, paging) => request(`/api/auto-trading/strategies/${id}/decisions${pageQuery(paging)}`);
export const listAutoTradingPositions = (id) => request(`/api/auto-trading/strategies/${id}/positions`);
export const refreshAutoTradingOrder = (id) => request(`/api/auto-trading/orders/${id}/refresh`, { method: 'POST' });

// 한국 국장 상승률 랭킹 자동매매 전략
export const getKrRankOverview = () => request('/api/kr-rank/overview');
export const listKrRankStrategies = () => request('/api/kr-rank/strategies');
export const createKrRankStrategy = (payload) => request('/api/kr-rank/strategies', {
  method: 'POST',
  body: JSON.stringify(payload)
});
export const getKrRankStrategy = (id) => request(`/api/kr-rank/strategies/${id}`);
export const deleteKrRankStrategy = (id) => request(`/api/kr-rank/strategies/${id}`, { method: 'DELETE' });
export const startKrRankStrategy = (id) => request(`/api/kr-rank/strategies/${id}/start`, { method: 'POST' });
export const stopKrRankStrategy = (id) => request(`/api/kr-rank/strategies/${id}/stop`, { method: 'POST' });
export const evaluateKrRankStrategy = (id) => request(`/api/kr-rank/strategies/${id}/evaluate`, { method: 'POST' });
export const listKrRankOrders = (id, paging) => request(`/api/kr-rank/strategies/${id}/orders${pageQuery(paging)}`);
export const listKrRankTradeHistory = (id, paging) => request(`/api/kr-rank/strategies/${id}/trade-history${pageQuery(paging)}`);
export const listKrRankDecisions = (id, paging) => request(`/api/kr-rank/strategies/${id}/decisions${pageQuery(paging)}`);
export const listKrRankEntries = (id, paging) => request(`/api/kr-rank/strategies/${id}/entries${pageQuery(paging)}`);

// 미국장 상승률 랭킹 자동매매 전략
export const getUsRankOverview = () => request('/api/us-rank/overview');
export const listUsRankStrategies = () => request('/api/us-rank/strategies');
export const createUsRankStrategy = (payload) => request('/api/us-rank/strategies', {
  method: 'POST',
  body: JSON.stringify(payload)
});
export const getUsRankStrategy = (id) => request(`/api/us-rank/strategies/${id}`);
export const deleteUsRankStrategy = (id) => request(`/api/us-rank/strategies/${id}`, { method: 'DELETE' });
export const startUsRankStrategy = (id) => request(`/api/us-rank/strategies/${id}/start`, { method: 'POST' });
export const stopUsRankStrategy = (id) => request(`/api/us-rank/strategies/${id}/stop`, { method: 'POST' });
export const evaluateUsRankStrategy = (id) => request(`/api/us-rank/strategies/${id}/evaluate`, { method: 'POST' });
export const listUsRankTrades = (id, paging) => request(`/api/us-rank/strategies/${id}/trades${pageQuery(paging)}`);
export const listUsRankOrders = (id, paging) => request(`/api/us-rank/strategies/${id}/orders${pageQuery(paging)}`);
export const listUsRankTradeHistory = (id, paging) => request(`/api/us-rank/strategies/${id}/trade-history${pageQuery(paging)}`);
export const listUsRankDecisions = (id, paging) => request(`/api/us-rank/strategies/${id}/decisions${pageQuery(paging)}`);

// 페이징 쿼리스트링 생성. limit/offset 둘 다 없으면 빈 문자열.
function pageQuery({ limit, offset } = {}) {
  const params = new URLSearchParams();
  if (limit != null) params.set('limit', String(limit));
  if (offset != null) params.set('offset', String(offset));
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

function normalizeMarket(value, symbol) {
  const market = String(value || '').trim().toUpperCase();
  if (market === 'KR' || market === 'KOSPI' || market === 'KOSDAQ') return 'KR';
  if (market === 'US') return 'US';
  return /^\d{6}$/.test(String(symbol || '')) ? 'KR' : 'US';
}
