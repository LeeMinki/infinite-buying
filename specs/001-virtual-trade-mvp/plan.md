# Implementation Plan: Infinite Buying Strategy Assistant MVP

**Branch**: `001-virtual-trade-mvp` | **Date**: 2026-04-28 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/home/hyerin/speckit/infinite-buying/specs/001-virtual-trade-mvp/spec.md`

## Summary

Build a fast single-user web MVP for creating infinite-buying-style strategies, retrieving market price/chart data, evaluating BUY / SELL / HOLD / PAUSE decisions, and storing only virtual orders. The implementation uses a React frontend, Node.js + Express backend, SQLite persistence, a small pure strategy-calculation module, and a `MarketDataProvider` abstraction with `KiwoomMarketDataProvider` and `MockMarketDataProvider`.

Kiwoom integration is limited to current-price and daily-chart reads. Real orders, Kiwoom order APIs, automatic trading, login, and deployment are excluded.

## Technical Context

**Language/Version**: JavaScript on Node.js 22+; React 19-compatible frontend  
**Primary Dependencies**: Express, better-sqlite3, dotenv, cors, Vite, React, Recharts  
**Storage**: SQLite database file under `backend/data/app.db`  
**Testing**: Node built-in test runner for backend unit/integration tests; Vitest optional for frontend if needed  
**Target Platform**: Local Linux development environment  
**Project Type**: Web application with separate backend and frontend packages  
**Performance Goals**: Strategy evaluation completes within 5 seconds for 95% of valid price inputs; local CRUD operations feel immediate for single-user MVP  
**Constraints**: No real-order capability; no Kiwoom order API imports, endpoints, or calls; market-data failure must not block manual evaluation  
**Scale/Scope**: Single user, local MVP, one stock per strategy, manual evaluations only

## Constitution Check

The constitution currently contains placeholder principles only, so there are no enforceable project-specific gates. The plan still applies these feature gates:

- PASS: No real trading or broker order API calls are included.
- PASS: Market data is isolated behind `MarketDataProvider`.
- PASS: Strategy calculation is separated into a pure function for fast testing.
- PASS: SQLite schema includes uniqueness protection for duplicate BUY orders by strategy/date/round.
- PASS: MVP scope excludes login, deployment, automatic trading, and complex backtesting.

## Project Structure

### Documentation (this feature)

```text
specs/001-virtual-trade-mvp/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── openapi.yaml
└── tasks.md
```

### Source Code (repository root)

```text
backend/
├── package.json
├── .env.example
├── data/
│   └── .gitkeep
├── src/
│   ├── app.js
│   ├── server.js
│   ├── config/
│   │   └── env.js
│   ├── db/
│   │   ├── connection.js
│   │   ├── migrate.js
│   │   └── schema.sql
│   ├── market-data/
│   │   ├── MarketDataProvider.js
│   │   ├── KiwoomMarketDataProvider.js
│   │   ├── MockMarketDataProvider.js
│   │   └── index.js
│   ├── repositories/
│   │   ├── strategiesRepository.js
│   │   ├── holdingsRepository.js
│   │   ├── virtualOrdersRepository.js
│   │   ├── decisionLogsRepository.js
│   │   └── marketPriceCacheRepository.js
│   ├── services/
│   │   ├── strategyCalculator.js
│   │   ├── strategiesService.js
│   │   ├── marketDataService.js
│   │   └── virtualOrdersService.js
│   └── routes/
│       ├── strategiesRoutes.js
│       ├── marketRoutes.js
│       └── ordersRoutes.js
└── tests/
    ├── strategyCalculator.test.js
    ├── strategiesApi.test.js
    └── virtualOrdersApi.test.js

frontend/
├── package.json
├── index.html
├── src/
│   ├── main.jsx
│   ├── App.jsx
│   ├── api/
│   │   └── client.js
│   ├── components/
│   │   ├── StrategyForm.jsx
│   │   ├── HoldingPanel.jsx
│   │   ├── EvaluationPanel.jsx
│   │   ├── DailyChart.jsx
│   │   └── OrdersTable.jsx
│   ├── pages/
│   │   ├── StrategiesPage.jsx
│   │   └── StrategyDetailPage.jsx
│   └── styles.css
```

**Structure Decision**: Use two small packages, `backend/` and `frontend/`, because the MVP needs both a browser UI and HTTP API. Keep the backend layered but thin: routes call services, services call repositories, and strategy math stays in `strategyCalculator.js`.

## Database Plan

SQLite will be initialized from `backend/src/db/schema.sql`.

```sql
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS strategies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  stock_code TEXT NOT NULL,
  stock_name TEXT NOT NULL,
  total_budget INTEGER NOT NULL CHECK (total_budget > 0),
  split_count INTEGER NOT NULL DEFAULT 40 CHECK (split_count > 0),
  buy_amount_per_round INTEGER NOT NULL CHECK (buy_amount_per_round >= 0),
  target_profit_rate REAL NOT NULL DEFAULT 0.10 CHECK (target_profit_rate > 0),
  current_round INTEGER NOT NULL DEFAULT 1 CHECK (current_round > 0),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'PAUSED')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS holdings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  strategy_id INTEGER NOT NULL UNIQUE,
  quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  average_price REAL NOT NULL DEFAULT 0 CHECK (average_price >= 0),
  invested_amount INTEGER NOT NULL DEFAULT 0 CHECK (invested_amount >= 0),
  remaining_budget INTEGER NOT NULL CHECK (remaining_budget >= 0),
  realized_profit INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (strategy_id) REFERENCES strategies(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS virtual_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  strategy_id INTEGER NOT NULL,
  order_date TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
  price REAL NOT NULL CHECK (price > 0),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  amount INTEGER NOT NULL CHECK (amount > 0),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'FILLED', 'CANCELED')),
  round_no INTEGER NOT NULL CHECK (round_no > 0),
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  filled_at TEXT,
  FOREIGN KEY (strategy_id) REFERENCES strategies(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_virtual_orders_buy_strategy_date_round
ON virtual_orders(strategy_id, order_date, round_no)
WHERE side = 'BUY';

CREATE TABLE IF NOT EXISTS decision_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  strategy_id INTEGER NOT NULL,
  input_price REAL NOT NULL CHECK (input_price > 0),
  average_price REAL NOT NULL DEFAULT 0 CHECK (average_price >= 0),
  quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  decision TEXT NOT NULL CHECK (decision IN ('BUY', 'SELL', 'HOLD', 'PAUSE')),
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (strategy_id) REFERENCES strategies(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS market_price_cache (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  stock_code TEXT NOT NULL,
  date TEXT NOT NULL,
  open REAL NOT NULL,
  high REAL NOT NULL,
  low REAL NOT NULL,
  close REAL NOT NULL,
  volume INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(stock_code, date)
);
```

## Kiwoom API Environment Variables

```text
MARKET_DATA_PROVIDER=mock | kiwoom
KIWOOM_BASE_URL=https://api.kiwoom.com
KIWOOM_MOCK_BASE_URL=https://mockapi.kiwoom.com
KIWOOM_APP_KEY=
KIWOOM_SECRET_KEY=
KIWOOM_TIMEOUT_MS=5000
KIWOOM_USE_MOCK=false
```

Use `MARKET_DATA_PROVIDER=mock` by default. Enable Kiwoom only when app key and secret key are present. The backend must fail closed to mock/manual fallback if credentials are missing or a Kiwoom response cannot be normalized.

## MarketDataProvider Structure

```js
class MarketDataProvider {
  async getCurrentPrice(stockCode) {
    throw new Error('not implemented');
  }

  async getDailyPrices(stockCode) {
    throw new Error('not implemented');
  }
}
```

- `KiwoomMarketDataProvider`
  - obtains OAuth token with client credentials
  - reads only stock basic/current-price and daily-chart TRs
  - normalizes provider-specific field names into app-owned shapes
  - never imports or calls Kiwoom order TRs
- `MockMarketDataProvider`
  - returns deterministic current prices and daily candles
  - supports development when credentials are unavailable
- `marketDataService`
  - selects provider by env
  - catches provider failures
  - returns an error shape the frontend can use to show manual-input fallback

App-owned return shapes:

```js
// current price
{ stockCode, price, source, fetchedAt }

// daily prices
[{ stockCode, date, open, high, low, close, volume }]
```

## Strategy Calculation Function

```js
function evaluateStrategy({ strategy, holding, currentPrice, today }) {
  if (strategy.status === 'PAUSED') {
    return { decision: 'PAUSE', quantity: 0, reason: 'Strategy is paused' };
  }

  if (holding.quantity > 0 && currentPrice >= holding.averagePrice * (1 + strategy.targetProfitRate)) {
    return {
      decision: 'SELL',
      quantity: holding.quantity,
      amount: Math.floor(currentPrice * holding.quantity),
      roundNo: strategy.currentRound,
      reason: 'Target profit reached'
    };
  }

  if (strategy.currentRound > strategy.splitCount || holding.remainingBudget < strategy.buyAmountPerRound) {
    return { decision: 'HOLD', quantity: 0, reason: 'No remaining buy capacity' };
  }

  const quantity = Math.floor(strategy.buyAmountPerRound / currentPrice);
  if (quantity <= 0) {
    return { decision: 'HOLD', quantity: 0, reason: 'Per-round amount cannot buy one share' };
  }

  return {
    decision: 'BUY',
    quantity,
    amount: Math.floor(quantity * currentPrice),
    roundNo: strategy.currentRound,
    reason: 'Buy conditions met'
  };
}
```

Duplicate BUY prevention is enforced both in service logic and by the partial unique SQLite index.

## API List

- `GET /api/strategies`
- `POST /api/strategies`
- `GET /api/strategies/:id`
- `PUT /api/strategies/:id`
- `DELETE /api/strategies/:id`
- `GET /api/strategies/:id/holding`
- `POST /api/strategies/:id/evaluate`
- `GET /api/market/:stockCode/price`
- `GET /api/market/:stockCode/daily`
- `GET /api/strategies/:id/orders`
- `POST /api/orders/:id/fill`
- `POST /api/orders/:id/cancel`
- `GET /api/strategies/:id/logs`

No `/api/orders/place`, broker order route, live-trade route, login route, or scheduler route will be created.

## React Screen List

- `StrategiesPage`: strategy list, create/edit/delete controls, status badge, selected strategy navigation.
- `StrategyDetailPage`: strategy settings summary, holding panel, price lookup/manual price input, evaluation action, latest decision.
- `DailyChart`: Recharts line/candlestick-style daily chart using normalized daily price data.
- `OrdersTable`: virtual order history with fill/cancel actions only for pending virtual orders.
- `DecisionLogTable`: recent evaluation decisions and reasons.

The UI must not include a real-order button. If any broker-order affordance appears for clarity, it must be disabled and labeled as unavailable in MVP.

## Implementation Order

1. Scaffold `backend/` and `frontend/` package files with LF line endings.
2. Add backend SQLite connection, schema migration, and repository modules.
3. Implement `strategyCalculator.js` with unit tests for BUY, SELL, HOLD, PAUSE, budget exhaustion, zero quantity, and duplicate BUY handling.
4. Implement strategy CRUD and holding initialization.
5. Implement virtual order creation, fill, cancel, and holding updates in a transaction.
6. Implement decision logging for every evaluation attempt.
7. Implement `MarketDataProvider`, `MockMarketDataProvider`, and provider selection.
8. Add `KiwoomMarketDataProvider` as read-only market-data integration guarded by env vars.
9. Implement Express routes matching the contract.
10. Build React list/detail screens, manual current-price fallback, chart, virtual orders, and decision logs.
11. Run backend tests and a local smoke test through the UI.
12. Open a PR with a detailed description; do not push directly to `main`.

## Complexity Tracking

No constitution violations or complexity exceptions are required.
