## 1. Dashboard Navigation Fix

- [x] 1.1 Update `App.jsx` so dashboard menu navigation directly sets dashboard view without using browser history back.
- [x] 1.2 Preserve existing direct navigation for KIS settings, backtest, and auto-trading views.
- [x] 1.3 Add or update a frontend/static test that covers dashboard navigation from KIS settings, backtest, and auto-trading.

## 2. Dashboard Data Model and API Integration

- [x] 2.1 Identify existing APIs that can provide account balance, buyable cash, current evaluation amount, strategy overview, recent orders, recent decisions, and recent errors.
- [x] 2.2 Add a lightweight dashboard summary API or client aggregation layer using existing data sources without adding long-term account snapshot tables.
- [x] 2.3 Return data-insufficient markers for period profit/loss values that cannot be calculated from existing data.

## 3. Dashboard UI Redesign

- [x] 3.1 Replace launcher-first dashboard layout with account, profit/loss, strategy, order, error, and operation status sections.
- [x] 3.2 Display buyable cash, total evaluation amount, today profit/loss amount, and today profit/loss rate when available.
- [x] 3.3 Display period profit/loss amount/rate only when calculable, otherwise show a clear data-insufficient state.
- [x] 3.4 Move KIS settings, backtest, and auto-trading navigation to secondary actions or remove duplicated large action cards.

## 4. Checklist Behavior

- [x] 4.1 Hide or collapse the checklist when required setup is complete.
- [x] 4.2 Show warning-style checklist/setup guidance only when KIS setup, account check, strategy creation, or operation readiness needs attention.
- [x] 4.3 Keep the visible heading text as `체크리스트` when the checklist is shown.

## 5. Strategy-Specific Dashboard Status

- [x] 5.1 Add dashboard sections for 라오어 무한매수법, 한국 국장 상승률 랭킹, and 미국장 상승률 랭킹 when data exists.
- [x] 5.2 Show each strategy type’s running/stopped/error state, recent decision, recent order/execution status, and recent skipped-order or error reason.
- [x] 5.3 Ensure strategy status remains scoped to the current user and does not expose another user’s strategy/order/decision data.

## 6. Branding and Favicon

- [x] 6.1 Review current service name and subtitle, then update subtitle copy so the app reads as a strategy operating tool rather than a 라오어-only app.
- [x] 6.2 Add a simple favicon asset that is recognizable in browser tabs and is not the default Vite/browser icon.
- [x] 6.3 Update `frontend/index.html` and related assets so the favicon and title metadata are applied.
- [x] 6.4 Keep branding copy concise, natural Korean, and free of return-guarantee wording.

## 7. Backtest Direction Documentation and Copy

- [x] 7.1 Document that the current backtest is 라오어-oriented and 일봉 기반.
- [x] 7.2 Document why 한국/미국 랭킹 strategies cannot be accurately backtested from daily close data alone.
- [x] 7.3 Clarify in UI/documentation that any ranking-strategy calculation without historical ranking snapshots is an approximate simulation, not an exact backtest.
- [x] 7.4 Do not add ranking snapshot collection tables or exact ranking replay engines in this change.

## 8. Validation

- [x] 8.1 Run `npm test`.
- [x] 8.2 Run `npm run build`.
- [x] 8.3 Verify dashboard does not prominently show duplicate launcher cards after setup is complete.
- [x] 8.4 Verify favicon appears in the browser tab in local build/dev.

## 9. Auto-Trading History and Period Returns

- [x] 9.1 Add pagination to 라오어 automatic trading order history and decision log APIs.
- [x] 9.2 Update the 라오어 automatic trading detail screen to show only order history and decision logs as the primary record sections.
- [x] 9.3 Confirm 한국 국장 and 미국장 ranking order history and decision logs use paged loading.
- [x] 9.4 Add realized period return summaries for 라오어, 한국 국장 랭킹, 미국장 랭킹, and currency-separated overall totals.
- [x] 9.5 Show period returns above the strategy status section on the dashboard.
