const API_BASE = import.meta.env.VITE_API_BASE || (import.meta.env.DEV ? 'http://localhost:4000' : '');

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    },
    ...options
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const error = new Error(data?.error || `Request failed: ${response.status}`);
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
export const getCurrentPrice = (stockCode) => request(`/api/market/${stockCode}/price`);
export const getDailyPrices = (stockCode) => request(`/api/market/${stockCode}/daily`);
export const listOrders = (id) => request(`/api/strategies/${id}/orders`);
export const listLogs = (id) => request(`/api/strategies/${id}/logs`);
export const fillOrder = (id) => request(`/api/orders/${id}/fill`, { method: 'POST' });
export const cancelOrder = (id) => request(`/api/orders/${id}/cancel`, { method: 'POST' });
export const register = (payload) => request('/api/auth/register', { method: 'POST', body: JSON.stringify(payload) });
export const login = (payload) => request('/api/auth/login', { method: 'POST', body: JSON.stringify(payload) });
export const logout = () => request('/api/auth/logout', { method: 'POST' });
export const getMe = () => request('/api/auth/me');
export const getKiwoomSettings = () => request('/api/settings/kiwoom');
export const saveKiwoomSettings = (payload) => request('/api/settings/kiwoom', { method: 'POST', body: JSON.stringify(payload) });
export const deleteKiwoomSettings = () => request('/api/settings/kiwoom', { method: 'DELETE' });
export const testKiwoomSettings = () => request('/api/settings/kiwoom/test', { method: 'POST' });
