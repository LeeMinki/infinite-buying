import { MarketDataProvider } from './MarketDataProvider.js';

export class KiwoomMarketDataProvider extends MarketDataProvider {
  constructor(options) {
    super();
    this.baseUrl = options.baseUrl;
    this.appKey = options.appKey;
    this.secretKey = options.secretKey;
    this.timeoutMs = options.timeoutMs;
    this.token = null;
    this.tokenExpiresAt = 0;
  }

  isConfigured() {
    return Boolean(this.baseUrl && this.appKey && this.secretKey);
  }

  async getCurrentPrice(stockCode) {
    const data = await this.requestJson('/api/dostk/stkinfo', 'ka10001', {
      stk_cd: stockCode
    });
    const price = normalizeNumber(
      data.cur_prc ?? data.current_price ?? data.prpr ?? data.stck_prpr ?? data.close
    );
    if (!price) {
      throw new Error('Kiwoom current price response could not be normalized');
    }
    return {
      stockCode,
      price,
      source: 'kiwoom',
      fetchedAt: new Date().toISOString()
    };
  }

  async getDailyPrices(stockCode) {
    const data = await this.requestJson('/api/dostk/chart', 'ka10081', {
      stk_cd: stockCode,
      base_dt: currentDate(),
      upd_stkpc_tp: '1'
    });
    const rows = data.output ?? data.output1 ?? data.output2 ?? data.list ?? data;
    const list = Array.isArray(rows) ? rows : [];
    if (list.length === 0) {
      throw new Error('Kiwoom daily price response was empty');
    }
    return list.map((row) => ({
      stockCode,
      date: normalizeDate(row.dt ?? row.date ?? row.base_dt ?? row.stck_bsop_date),
      open: normalizeNumber(row.open_pric ?? row.open ?? row.stck_oprc),
      high: normalizeNumber(row.high_pric ?? row.high ?? row.stck_hgpr),
      low: normalizeNumber(row.low_pric ?? row.low ?? row.stck_lwpr),
      close: normalizeNumber(row.cur_prc ?? row.close ?? row.stck_clpr),
      volume: normalizeNumber(row.trde_qty ?? row.volume ?? row.acml_vol) || 0
    })).filter((row) => row.date && row.open && row.high && row.low && row.close);
  }

  async requestJson(path, apiId, body) {
    const token = await this.getAccessToken();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json;charset=UTF-8',
          Authorization: `Bearer ${token}`,
          'api-id': apiId
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.return_msg || data.message || `Kiwoom request failed with ${response.status}`);
      }
      return data;
    } finally {
      clearTimeout(timeout);
    }
  }

  async getAccessToken() {
    if (this.token && Date.now() < this.tokenExpiresAt) {
      return this.token;
    }
    const response = await fetch(`${this.baseUrl}/oauth2/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json;charset=UTF-8'
      },
      body: JSON.stringify({
        grant_type: 'client_credentials',
        appkey: this.appKey,
        secretkey: this.secretKey
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.return_msg || data.message || 'Kiwoom OAuth failed');
    }
    this.token = data.token || data.access_token;
    if (!this.token) {
      throw new Error('Kiwoom OAuth response did not include a token');
    }
    const expiresIn = Number(data.expires_in || 3600);
    this.tokenExpiresAt = Date.now() + Math.max(60, expiresIn - 60) * 1000;
    return this.token;
  }
}

function normalizeNumber(value) {
  if (value === undefined || value === null) return 0;
  const number = Number(String(value).replace(/[,+-]/g, ''));
  return Number.isFinite(number) ? Math.abs(number) : 0;
}

function normalizeDate(value) {
  const text = String(value || '');
  if (/^\d{8}$/.test(text)) {
    return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
  }
  return text.slice(0, 10);
}

function currentDate() {
  return new Date().toISOString().slice(0, 10).replaceAll('-', '');
}
