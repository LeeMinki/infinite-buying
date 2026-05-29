# app-branding Specification

## Purpose
TBD - created by archiving change improve-dashboard-branding-and-backtest-direction. Update Purpose after archive.
## Requirements
### Requirement: App branding shall describe a strategy operating tool
The app MUST present itself as a strategy operating tool rather than a single-strategy 라오어-only app. The visible subtitle MUST communicate that the app supports strategy monitoring, backtesting, and auto-trading.

#### Scenario: User sees the app header
- **WHEN** the user views the header or login branding
- **THEN** the service name and subtitle do not imply that only 라오어 무한매수법 is supported
- **AND** the subtitle describes the broader strategy operating scope

### Requirement: App shall provide a recognizable favicon
The app MUST include a favicon. The favicon MUST be recognizable in a browser tab and SHOULD visually suggest automated trading, strategy operation, price movement, or infinite-buying in a simple form.

#### Scenario: Browser tab is shown
- **WHEN** the app is loaded in a browser
- **THEN** the browser tab shows the app favicon
- **AND** the favicon is not the default Vite/browser icon

### Requirement: Branding text shall remain natural Korean
Branding and dashboard copy MUST use natural Korean suitable for a financial strategy tool. Copy MUST avoid awkward tool-generated phrasing and MUST avoid overemphasizing speculative profit claims.

#### Scenario: User reads dashboard branding text
- **WHEN** the user reads the header, subtitle, or dashboard summary text
- **THEN** the text is concise and natural
- **AND** it does not promise investment returns

