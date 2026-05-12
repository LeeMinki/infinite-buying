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

function normalizeMarket(value, symbol) {
  const market = String(value || '').trim().toUpperCase();
  if (market === 'KR' || market === 'KOSPI' || market === 'KOSDAQ') return 'KR';
  if (market === 'US') return 'US';
  return /^\d{6}$/.test(String(symbol || '')) ? 'KR' : 'US';
}
