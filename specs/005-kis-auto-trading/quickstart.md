# Quickstart: KIS Auto Trading

## Prerequisites

1. Install dependencies:

   ```bash
   npm install
   ```

2. Configure backend environment:

   ```text
   KIS_API_BASE_URL=https://openapi.koreainvestment.com:9443
   SECRET_ENCRYPTION_KEY=<base64 32-byte key>
   SESSION_SECRET=<long random string>
   ENABLE_LIVE_ORDER=false
   ENABLE_RESERVED_ORDER=false
   ```

3. Run migrations:

   ```bash
   npm run migrate
   ```

4. Run tests and build:

   ```bash
   npm test
   npm run build
   ```

5. Start local development:

   ```bash
   npm run dev
   ```

## Manual Smoke Flow

1. Open the app and sign in.
2. Open `KIS 설정`.
3. Save KIS App Key / App Secret / account fields.
4. Run connection test.
5. Open `자동매매`.
6. Confirm live-order setting defaults to OFF.
7. Search and select a symbol such as `TQQQ` or `005930`.
8. Create an automatic trading strategy:
   - total budget
   - split count 40
   - target profit rate 10%
   - max order amount
   - max daily order amount
9. Start the strategy.
10. Run manual evaluate.
11. With live-order setting OFF, confirm:
    - decision log is saved
    - position snapshot is saved
    - BUY/SELL creates `DRY_RUN`
    - no real KIS order request is sent
12. Toggle live-order setting ON only with a valid KIS trading account and intentional test conditions.
13. Run manual evaluate and confirm safety guard behavior:
    - open orders block new orders
    - insufficient buying power blocks BUY
    - insufficient sellable quantity blocks SELL
    - max order and daily order limits block excessive orders
14. Refresh an order and confirm fill status fields update.
15. Stop the strategy and confirm scheduled evaluation excludes it.

## Safety Verification

- New users must start with live-order setting OFF.
- App Secret, access token, and account number must not appear in browser responses or logs.
- DRY_RUN mode must never call KIS order endpoints.
- Stopping a strategy must not cancel already submitted orders.
- Unknown market-session status must result in SKIP, not an order.

## Expected Commands

```bash
npm test
npm run build
npm run dev
```

## KIS Reference

Use local KIS documentation first:

```text
KIS/한국투자증권_오픈API_전체문서_20260512_030000.xlsx
```

Relevant document sheets include domestic balance/order/buying-power/sellable quantity and overseas balance/order/buying-power/open-order/order-history sections.
