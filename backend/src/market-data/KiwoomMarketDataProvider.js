import { MarketDataProvider } from './MarketDataProvider.js';

export class KiwoomMarketDataProvider extends MarketDataProvider {
  constructor(options) {
    super();
    this.baseUrl = options.baseUrl;
    this.timeoutMs = options.timeoutMs;
    this.tokenSupplier = options.tokenSupplier;
  }

  isConfigured() {
    return Boolean(this.baseUrl && this.tokenSupplier);
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
      source: 'KIWOOM',
      fetchedAt: new Date().toISOString()
    };
  }

  async getDailyPrices(stockCode, options = {}) {
    const data = await this.requestJson('/api/dostk/chart', 'ka10081', {
      stk_cd: stockCode,
      base_dt: (options.to || currentDate()).replaceAll('-', ''),
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
      volume: normalizeNumber(row.trde_qty ?? row.volume ?? row.acml_vol) || 0,
      source: 'KIWOOM'
    })).filter((row) => row.date && row.open && row.high && row.low && row.close);
  }

  async searchStocks(query) {
    const normalized = String(query || '').trim();
    if (!normalized) return [];

    const stocks = await this.getStockList();
    const keyword = normalized.toLowerCase();
    const matched = stocks
      .filter((stock) =>
        stock.stockCode.toLowerCase().includes(keyword) ||
        stock.stockName.toLowerCase().includes(keyword)
      )
      .slice(0, 10);

    if (matched.length > 0 || !/^\d{4,6}$/.test(normalized)) {
      return matched;
    }

    const data = await this.requestJson('/api/dostk/stkinfo', 'ka10001', {
      stk_cd: normalized
    });
    const stockCode = normalizeStockCode(data.stk_cd ?? data.stock_code ?? data.code ?? normalized);
    const stockName = String(data.stk_nm ?? data.stock_name ?? data.name ?? '').trim();
    if (!stockCode || !stockName) return [];
    return [{
      stockCode,
      stockName,
      source: 'KIWOOM'
    }];
  }

  async getStockList() {
    const now = Date.now();
    if (stockListCache.items && now - stockListCache.fetchedAt < STOCK_LIST_TTL_MS) {
      return stockListCache.items;
    }

    const lists = await Promise.all(KOREA_MARKET_TYPES.map(async (marketType) => {
      const data = await this.requestJson('/api/dostk/stkinfo', 'ka10099', {
        mrkt_tp: marketType
      });
      const rows = data.list ?? data.output ?? data.output1 ?? data.output2 ?? [];
      return Array.isArray(rows) ? rows.map(normalizeStockListRow).filter(Boolean) : [];
    }));
    const items = dedupeStocks(lists.flat());
    stockListCache = { items, fetchedAt: now };
    return items;
  }

  async getAccountDeposit() {
    const data = await this.requestJson('/api/dostk/acnt', 'kt00001', {
      qry_tp: '3'
    });
    const deposit = normalizeNumber(
      data.d2_entra ??
      data.deposit ??
      data.entr ??
      data.dps_amt ??
      data.output?.d2_entra ??
      data.output?.deposit
    );
    const availableOrderAmount = normalizeNumber(
      data.ord_psbl_cash ??
      data.orderable_amount ??
      data.use_amt ??
      data.output?.ord_psbl_cash ??
      data.output?.orderable_amount
    ) || deposit;
    return {
      deposit,
      availableOrderAmount,
      source: 'KIWOOM',
      fetchedAt: new Date().toISOString()
    };
  }

  async requestJson(path, apiId, body) {
    const token = await this.tokenSupplier();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json;charset=UTF-8',
          Authorization: `Bearer ${token}`,
          'api-id': apiId,
          'cont-yn': 'N',
          'next-key': ''
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

}

const KOREA_MARKET_TYPES = ['0', '10', '8'];
const STOCK_LIST_TTL_MS = 24 * 60 * 60 * 1000;
let stockListCache = { items: null, fetchedAt: 0 };

function normalizeStockListRow(row) {
  const stockCode = normalizeStockCode(row.code ?? row.stk_cd ?? row.stock_code);
  const stockName = String(row.name ?? row.stk_nm ?? row.stock_name ?? '').trim();
  if (!stockCode || !stockName) return null;
  return {
    stockCode,
    stockName,
    marketName: row.marketName ?? row.mrkt_nm ?? row.market_name,
    source: 'KIWOOM'
  };
}

function dedupeStocks(items) {
  const byCode = new Map();
  for (const item of items) {
    if (!byCode.has(item.stockCode)) byCode.set(item.stockCode, item);
  }
  return Array.from(byCode.values());
}

function normalizeStockCode(value) {
  return String(value || '').replace(/^A/i, '').trim();
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
