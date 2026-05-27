# Dashboard Specification

## Requirements

### Requirement: Dashboard shall present primary actions in the main workspace

The dashboard MUST show the main user actions in the central workspace, not only in the sidebar. The primary actions MUST include KIS settings, backtest execution, and auto-trading start or status.

#### Scenario: User opens dashboard with no configuration
- **GIVEN** the user has not configured KIS API
- **WHEN** the user opens the dashboard
- **THEN** the central workspace shows KIS settings as the highest priority action
- **AND** the user can navigate to KIS settings from the main workspace

#### Scenario: User opens dashboard after KIS configuration
- **GIVEN** the user has configured KIS API
- **WHEN** the user opens the dashboard
- **THEN** the central workspace shows backtest and auto-trading actions prominently

### Requirement: Sidebar shall be used for navigation only

The sidebar MUST be simplified to navigation and lightweight status summary. Navigation MUST include dashboard, strategy, backtest, auto-trading, order/execution log, and KIS settings entries. The sidebar MUST NOT contain large feature explanation cards or the legacy draft list.

#### Scenario: User views sidebar
- **GIVEN** the user is on the dashboard
- **WHEN** the sidebar is visible
- **THEN** it shows navigation menu items
- **AND** it shows lightweight account or system status
- **AND** it does not show large action cards that compete with the main workspace

### Requirement: Dashboard shall show setup checklist for incomplete onboarding

The dashboard MUST show a setup checklist when the user has not completed required setup steps. The checklist SHOULD include KIS API key registration, account connection check, strategy selection, backtest execution, and auto-trading start.

#### Scenario: KIS API is not configured
- **GIVEN** the user has not registered KIS API credentials
- **WHEN** the dashboard is rendered
- **THEN** the setup checklist marks KIS API registration as incomplete
- **AND** the checklist provides a way to navigate to KIS settings

#### Scenario: Strategy is not selected
- **GIVEN** the user has configured KIS API
- **AND** the user has not created any strategy
- **WHEN** the dashboard is rendered
- **THEN** the setup checklist marks strategy selection as incomplete
- **AND** the dashboard provides a way to choose a strategy

### Requirement: Dashboard shall show current system status

The dashboard MUST show a summary of the current trading system status, including KIS connection status, auto-trading status, selected/operating strategy, latest backtest result, and live-order setting.

#### Scenario: No trading activity exists
- **GIVEN** the user has no previous trading activity
- **WHEN** the dashboard is rendered
- **THEN** the recent activity area shows an empty state
- **AND** the empty state explains what will appear after auto-trading starts

#### Scenario: Auto-trading is running
- **GIVEN** auto-trading is currently running
- **WHEN** the dashboard is rendered
- **THEN** the dashboard clearly shows that auto-trading is running
- **AND** it shows the active strategy if available

### Requirement: Empty states shall guide the next action

Empty states MUST NOT be passive placeholders. Each empty state SHOULD explain why no data is shown and provide a relevant next action.

#### Scenario: No backtest result exists
- **GIVEN** the user has not executed any backtest
- **WHEN** the dashboard is rendered
- **THEN** the backtest area explains that no result exists yet
- **AND** it provides an action to run a backtest

#### Scenario: No auto-trading log exists
- **GIVEN** the user has not started auto-trading
- **WHEN** the dashboard is rendered
- **THEN** the trading area explains that activity will appear after execution
- **AND** it provides an action to start or configure auto-trading

### Requirement: Legacy draft area shall be removed

The dashboard MUST NOT show the legacy "라오어 초안" area.

#### Scenario: User opens dashboard
- **GIVEN** the user opens the dashboard
- **WHEN** the sidebar and main workspace are rendered
- **THEN** no "라오어 초안" section is displayed
