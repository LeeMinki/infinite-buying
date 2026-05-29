# backtest-direction Specification

## Purpose
TBD - created by archiving change improve-dashboard-branding-and-backtest-direction. Update Purpose after archive.
## Requirements
### Requirement: Backtest scope shall distinguish strategy types
The system documentation and UI copy MUST distinguish 라오어 무한매수법 backtesting from ranking-strategy simulation. Existing backtest behavior MUST be described as 라오어-oriented unless and until ranking-strategy replay data exists.

#### Scenario: User views backtest explanation
- **WHEN** the user reads backtest guidance
- **THEN** the guidance states which strategy type the current backtest supports
- **AND** it does not imply that 한국/미국 랭킹 strategies are accurately backtested by the existing 일봉-based flow

### Requirement: Ranking strategies shall document exact backtest limitations
The system MUST document that 한국 국장 상승률 랭킹 and 미국장 상승률 랭킹 strategies depend on time-specific ranking, price, volume, intraday take-profit, and stop-loss behavior that cannot be accurately reconstructed from daily close data alone.

#### Scenario: User considers ranking strategy backtest
- **WHEN** the user reads ranking strategy backtest guidance
- **THEN** the system explains that exact historical ranking snapshots are required for accurate replay
- **AND** it explains that daily price data alone is insufficient for exact ranking-strategy backtests

### Requirement: Ranking snapshot storage shall be out of scope for this change
This change MUST NOT add long-term ranking snapshot collection tables or historical ranking replay storage. Any exact ranking strategy backtest MUST be deferred to a future change.

#### Scenario: Implementation is planned
- **WHEN** tasks for this change are implemented
- **THEN** no new ranking snapshot collection table is added
- **AND** no exact 한국/미국 ranking strategy backtest engine is required

### Requirement: Approximate simulation shall be labeled separately from backtest
If the app presents a ranking-strategy calculation based only on currently available historical price data, it MUST be labeled as an approximate simulation rather than an exact backtest.

#### Scenario: Approximate ranking result is shown
- **WHEN** the app shows a ranking-strategy result that lacks historical ranking snapshots
- **THEN** the result is labeled as simulation or approximate simulation
- **AND** the UI explains the missing data limitation

