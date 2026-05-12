# Research: KIS Market Data Backtest

## Decision: KIS Is the Only Broker API

**Decision**: Implement KIS Open API directly without a broker provider abstraction.

**Rationale**: The target is KIS market data and infinite-buying backtesting. A single direct KIS integration keeps the implementation small and testable.

## Decision: Backend-Only Broker Calls

**Decision**: The browser never calls KIS directly.

**Rationale**: App Secret and access token must stay server-side. Backend APIs normalize KIS responses and enforce user scoping.

## Decision: Store Credentials Per User

**Decision**: Store KIS settings in `kis_credentials` with encrypted App Key/App Secret/token fields.

**Rationale**: Each user owns their own KIS API keys and market data access. Per-user storage is required for data separation.

## Decision: Market and Currency Semantics

**Decision**: Market and backtest flows use `symbol`, `market`, and `currency`.

**Rationale**: KIS can return domestic and overseas instruments. Explicit market/currency fields let the UI display KRW for domestic symbols and USD for US symbols without ambiguity.

## Decision: Backtest Fetches Daily Candles

**Decision**: Backtest execution fetches KIS daily candles for the requested range, upserts cache rows, then runs `LAOR_INFINITE_V2` from daily `open`, `high`, and `close`.

**Rationale**: The user expects actual historical prices to drive the result. Cache is an implementation detail for reuse and auditability.

## Decision: No Order Features

**Decision**: The current scope does not implement real-order or reserved-order APIs.

**Rationale**: Backtesting and market data are the current scope. Trading execution needs a separate safety spec.
