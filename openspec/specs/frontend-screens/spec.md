# frontend-screens Specification

## Purpose
TBD - created by archiving change add-kr-rank-auto-trading. Update Purpose after archive.
## Requirements
### Requirement: 자동매매 화면 전략 종류 탭

자동매매 화면(`AutoTradingPage`)은 전략 종류를 선택하는 탭을 제공해야 한다(MUST). 기존 라오어 무한매수법 전략 탭은 그대로 유지되며, "한국 국장 상승률 랭킹 전략" 탭이 추가된다. 각 탭은 해당 종류의 전략 생성·시작·종료·조회 UI만 보여주어야 하며, 한 탭의 동작이 다른 탭의 전략에 영향을 주어서는 안 된다.

#### Scenario: 라오어 탭
- **WHEN** 사용자가 라오어 전략 탭을 연다
- **THEN** 종전과 동일한 라오어 전략 생성·운용 UI가 표시되어야 한다

#### Scenario: 한국 랭킹 전략 탭
- **WHEN** 사용자가 "한국 국장 상승률 랭킹 전략" 탭을 연다
- **THEN** 한국 랭킹 전략의 생성·시작·종료와 진입 구간·선택 종목·판단·주문 상태 표시 UI가 표시되어야 한다

#### Scenario: 탭 간 독립성
- **WHEN** 한 탭에서 전략을 시작/종료
- **THEN** 다른 탭의 전략 상태는 바뀌지 않아야 한다

