## ADDED Requirements

### Requirement: Dashboard navigation shall be direct
The app MUST navigate directly to the dashboard when the user selects the dashboard menu. Dashboard navigation MUST NOT depend on browser history back behavior.

#### Scenario: User opens dashboard from KIS settings
- **WHEN** the user is on the KIS settings screen and selects the dashboard menu
- **THEN** the app shows the dashboard screen
- **AND** the app does not navigate to a previous backtest or auto-trading screen

#### Scenario: User opens dashboard from auto-trading
- **WHEN** the user is on the auto-trading screen and selects the dashboard menu
- **THEN** the app shows the dashboard screen
- **AND** normal KIS settings, backtest, and auto-trading menu navigation still works

## MODIFIED Requirements

### Requirement: Dashboard shall present primary actions in the main workspace
The dashboard MUST prioritize operating status over duplicated navigation actions. The central workspace MUST focus on account status, trading status, strategy status, recent order/execution status, and operational health. KIS settings, backtest execution, and auto-trading navigation MAY remain as secondary actions, but they MUST NOT be the most prominent dashboard content after the user has completed required setup.

#### Scenario: User opens dashboard with no configuration
- **GIVEN** the user has not configured KIS API
- **WHEN** the user opens the dashboard
- **THEN** the central workspace shows KIS setup as a required action
- **AND** the dashboard explains that account and trading status require KIS setup

#### Scenario: User opens dashboard after KIS configuration
- **GIVEN** the user has configured KIS API
- **WHEN** the user opens the dashboard
- **THEN** the central workspace shows account, profit/loss, strategy, order, and operational status before simple navigation actions

### Requirement: Global navigation shall be shown at the top
The app MUST use a top navigation bar instead of a left sidebar. Navigation MUST include dashboard, backtest, auto-trading, and KIS settings entries. Navigation MUST NOT include separate strategy or order/execution log entries on the dashboard shell. Selecting the dashboard entry MUST directly show the dashboard.

#### Scenario: User views top navigation
- **GIVEN** the user is on the dashboard
- **WHEN** the top navigation is visible
- **THEN** it shows dashboard, backtest, auto-trading, and KIS settings menu items
- **AND** it shows lightweight account or system status
- **AND** it does not show strategy or order/execution log as separate top-level menu items

### Requirement: Dashboard shall show checklist for incomplete onboarding
The dashboard MUST show a checklist only when required setup is incomplete or needs user attention. The checklist MUST NOT be prominently displayed for users who have completed KIS setup, account connection checks, strategy creation, and at least one operational path. When shown, the heading MUST be "체크리스트".

#### Scenario: KIS API is not configured
- **GIVEN** the user has not registered KIS API credentials
- **WHEN** the dashboard is rendered
- **THEN** the dashboard shows a warning-style checklist or setup prompt
- **AND** the checklist marks KIS API registration as incomplete
- **AND** the checklist provides a way to navigate to KIS settings

#### Scenario: Setup is complete
- **GIVEN** the user has completed required setup
- **WHEN** the dashboard is rendered
- **THEN** the checklist is hidden or collapsed
- **AND** account and strategy status are shown instead

### Requirement: Dashboard shall show current system status
The dashboard MUST show a summary of the current trading system status, including KIS connection status, account lookup status, market session status, live-order setting, auto-trading status, selected/operating strategy, recent order/execution status, recent error, and recent reason for not placing an order.

The dashboard MUST show account values when available:
- buyable cash amount
- total evaluation amount
- today profit/loss amount
- today profit/loss rate
- period profit/loss amount and rate when calculable from existing data

If data is insufficient for a profit/loss value, the dashboard MUST show a data-insufficient state instead of inventing a value.

#### Scenario: Account data is available
- **WHEN** the dashboard can read current account and trading data
- **THEN** it shows buyable cash, total evaluation amount, today profit/loss, and today profit/loss rate
- **AND** it shows period profit/loss only for periods that can be calculated from available data

#### Scenario: Account data is insufficient
- **WHEN** the dashboard cannot calculate a period profit/loss value from available data
- **THEN** it shows a data-insufficient state for that value
- **AND** it does not show a misleading calculated value

#### Scenario: Auto-trading is running
- **GIVEN** auto-trading is currently running
- **WHEN** the dashboard is rendered
- **THEN** the dashboard clearly shows that auto-trading is running
- **AND** it shows active strategy status by strategy type if available

#### Scenario: Period returns are available from completed orders
- **WHEN** 라오어, 한국 국장 랭킹, or 미국장 랭킹 strategies have matched buy/sell order history
- **THEN** the dashboard shows period profit/loss amount and return rate before the strategy status section
- **AND** the calculation is based on actual order history, using the order price to approximate when a confirmed fill price is unavailable
- **AND** the dashboard separates 라오어, 한국 국장 랭킹, 미국장 랭킹, and overall totals
- **AND** KRW and USD totals are not mixed into one currency value

#### Scenario: Period returns exclude simulated and non-traded orders
- **WHEN** order history includes DRY_RUN (live-order OFF) or FAILED/REJECTED/CANCELED orders
- **THEN** those orders are excluded from the period profit/loss calculation
- **AND** simulated DRY_RUN records are never presented as real profit/loss

#### Scenario: Period returns cannot be calculated
- **WHEN** no matched sell-side order history exists for a strategy type and period
- **THEN** the period return area shows a data-insufficient state for that strategy type
- **AND** it does not infer returns from open positions or unsupported currency conversion

### Requirement: Dashboard shall separate strategy type status
The dashboard MUST distinguish 라오어 무한매수법, 한국 국장 상승률 랭킹, and 미국장 상승률 랭킹 strategy states when such strategies exist.

For each strategy type, the dashboard MUST show available execution status, recent decision, recent order/execution status, and recent error or skipped-order reason.

#### Scenario: Multiple strategy types exist
- **WHEN** the user has strategies in more than one strategy type
- **THEN** the dashboard groups or labels status by strategy type
- **AND** the user can tell which strategy type is running, stopped, or in error

#### Scenario: Recent skip reason exists
- **WHEN** a strategy recently skipped an order
- **THEN** the dashboard shows the skip reason in the matching strategy type status

### Requirement: Legacy draft area shall be removed
The dashboard MUST NOT show the legacy "라오어 초안" area.

#### Scenario: User opens dashboard
- **GIVEN** the user opens the dashboard
- **WHEN** the top navigation and main workspace are rendered
- **THEN** no "라오어 초안" section is displayed
