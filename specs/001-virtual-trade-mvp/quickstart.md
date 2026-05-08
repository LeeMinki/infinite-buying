# Quickstart: Infinite Buying Strategy Assistant MVP

## Prerequisites

- Node.js 22 or newer
- npm 11 or newer
- Linux line endings (`LF`) only

## Backend Setup

```bash
cd backend
npm install
cp .env.example .env
npm run migrate
npm test
npm run dev
```

Backend default URL: `http://localhost:4000`

## Frontend Setup

```bash
cd frontend
npm install
npm run dev
```

Frontend default URL: `http://localhost:5173`

## Environment

Use backend-only Kiwoom market data:

```text
MARKET_DATA_PROVIDER=kiwoom
KIWOOM_BASE_URL=https://api.kiwoom.com
KIWOOM_APP_KEY=
KIWOOM_SECRET_KEY=
KIWOOM_TIMEOUT_MS=5000
ENABLE_LIVE_ORDER=false
```

Current deployments use Kiwoom only:

```text
MARKET_DATA_PROVIDER=kiwoom
KIWOOM_APP_KEY=<issued app key>
KIWOOM_SECRET_KEY=<issued secret key>
```

## Smoke Test Flow

1. Open the frontend.
2. Create a strategy with stock code `005930`, total budget `4000000`, split count `40`, target profit rate `0.10`.
3. Open the strategy detail screen.
4. Request current price. If provider lookup fails, enter a manual current price.
5. Run evaluation and confirm a decision log is created.
6. If a virtual order is created, mark it filled and confirm holding values update.
7. Open the chart area and confirm daily price data renders when provider data is available.
8. Confirm there is no real-order or live-trading action.

## PR Workflow

Do not push directly to `main`. Work on the feature branch, push the branch, open a pull request with a detailed description, review it, then merge after review.
