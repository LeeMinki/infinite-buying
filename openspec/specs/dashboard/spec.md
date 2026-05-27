# Dashboard Specification

## Requirements

### Requirement: Dashboard shall present primary actions in the main workspace

The dashboard MUST show the main user actions in the central workspace. The primary actions MUST include KIS settings, backtest execution, and auto-trading start or status.

#### Scenario: User opens dashboard with no configuration
- **GIVEN** the user has not configured KIS API
- **WHEN** the user opens the dashboard
- **THEN** the central workspace shows KIS settings as the highest priority action
- **AND** the user can navigate to KIS settings from the main workspace

#### Scenario: User opens dashboard after KIS configuration
- **GIVEN** the user has configured KIS API
- **WHEN** the user opens the dashboard
- **THEN** the central workspace shows backtest and auto-trading actions prominently

### Requirement: Global navigation shall be shown at the top

The app MUST use a top navigation bar instead of a left sidebar. Navigation MUST include dashboard, backtest, auto-trading, and KIS settings entries. Navigation MUST NOT include separate strategy or order/execution log entries on the dashboard shell.

#### Scenario: User views top navigation
- **GIVEN** the user is on the dashboard
- **WHEN** the top navigation is visible
- **THEN** it shows navigation menu items
- **AND** it shows lightweight account or system status
- **AND** it does not show large action cards that compete with the main workspace

### Requirement: Dashboard shall show checklist for incomplete onboarding

The dashboard MUST show a checklist when the user has not completed required setup steps. The checklist SHOULD include KIS API key registration, account connection check, strategy selection, backtest execution, and auto-trading start. The heading MUST be "체크리스트".

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

The dashboard MUST show a summary of the current trading system status, including KIS connection status, auto-trading status, selected/operating strategy, and live-order setting.

#### Scenario: Auto-trading is running
- **GIVEN** auto-trading is currently running
- **WHEN** the dashboard is rendered
- **THEN** the dashboard clearly shows that auto-trading is running
- **AND** it shows the active strategy if available

### Requirement: Legacy draft area shall be removed

The dashboard MUST NOT show the legacy "라오어 초안" area.

#### Scenario: User opens dashboard
- **GIVEN** the user opens the dashboard
- **WHEN** the top navigation and main workspace are rendered
- **THEN** no "라오어 초안" section is displayed
