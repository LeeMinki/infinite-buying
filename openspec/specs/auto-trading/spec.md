# auto-trading Specification

## Purpose
TBD - created by archiving change add-kr-rank-auto-trading. Update Purpose after archive.
## Requirements
### Requirement: 자동매매 도메인은 복수 전략 종류를 독립 운용한다

자동매매 도메인은 라오어 무한매수법 전략(`LAOR_INFINITE_V2`)과 한국 국장 상승률 랭킹 전략(`KR_RANK_MOMENTUM`)을 서로 독립된 전략 종류로 함께 운용해야 한다(MUST). 두 전략 종류는 각자의 테이블·엔진·평가 경로를 가지며, 한 종류의 추가·평가·상태 변경이 다른 종류의 알고리즘·기록·상태에 영향을 주어서는 안 된다.

실주문 실행 설정(`user_trading_settings.live_order_enabled`, 사용자당 1행), KIS 토큰·잔고·주문 연동(`kisAuthService`/`kisTradingService`), 동시 평가 락·멱등키 패턴은 두 전략 종류가 공유한다. 스케줄러 모듈(`autoTradingScheduler`)은 라오어용 타이머(기본 10분)와 한국 랭킹용 타이머(기본 30초)를 각자 다른 주기로 운용하며, 두 타이머는 독립 동작한다. 라오어 전략의 평가 사이클·상태 머신·기록은 본 요구사항으로 변경되지 않는다.

#### Scenario: 두 전략 종류를 각자의 주기로 평가
- **WHEN** 스케줄러 모듈이 동작 중
- **THEN** RUNNING 상태의 라오어 전략과 한국 랭킹 전략이 각자의 타이머 주기와 엔진으로 평가되어야 한다
- **AND** 한 종류의 평가 실패가 다른 종류의 평가를 막지 않아야 한다

#### Scenario: 실주문 설정 공유
- **WHEN** 사용자가 실주문 실행 설정을 변경
- **THEN** 라오어 전략과 한국 랭킹 전략 모두 같은 설정 값을 따라야 한다

#### Scenario: 라오어 전략 동작 불변
- **WHEN** 한국 랭킹 전략이 추가되어 운용됨
- **THEN** 라오어 전략의 회차·이월 예산·사이클 재시작·판단 로그 동작은 종전과 동일해야 한다
