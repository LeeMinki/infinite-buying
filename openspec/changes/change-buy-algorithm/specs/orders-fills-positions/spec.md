## ADDED Requirements

### Requirement: idempotency_key에 절반 식별자 포함

`auto_trading_orders.idempotency_key`는 다음 형식을 따라야 한다:
```
{YYYYMMDD}-{strategyId}-{round}-{half}
```
여기서 `half`는 `FIRST` / `AVG` / `BIG` / `SELL` 중 하나.

같은 사이클에서 같은 `half`로 두 주문이 생성될 수 없다.

#### Scenario: 평단가/큰수 두 주문이 같은 평가에서 생성
- **WHEN** 한 평가 사이클이 `AVG`와 `BIG` 두 intent를 만든다
- **THEN** 두 주문의 `idempotency_key`는 서로 다른 값(`...-AVG`, `...-BIG`)을 가져야 한다

#### Scenario: 첫 매수
- **WHEN** 보유 0에서 첫 매수가 발생
- **THEN** `idempotency_key`는 `{YYYYMMDD}-{strategyId}-1-FIRST` 형식이어야 한다

#### Scenario: 매도
- **WHEN** 목표 수익률 도달로 SELL 결정
- **THEN** `idempotency_key`는 `{YYYYMMDD}-{strategyId}-{round}-SELL` 형식이어야 한다

### Requirement: half 컬럼 노출

`auto_trading_orders.half` (TEXT) 컬럼이 존재하고 각 주문은 자신이 어느 절반(`FIRST`/`AVG`/`BIG`/`SELL`)인지 명시적으로 저장해야 한다. API 응답에도 포함.

#### Scenario: 자동매매 상세 응답
- **WHEN** 자동매매 상세 API가 주문 목록을 반환
- **THEN** 각 주문 객체에 `half` 필드가 포함되어야 한다

### Requirement: decision_log_id 1:N 연결

`auto_trading_orders.decision_log_id` (INTEGER, NULL 허용) 외래키로 한 결정과 그 결정이 만든 주문(들)을 1:N으로 연결한다. 같은 평가에서 만들어진 `AVG` + `BIG` 주문은 동일한 `decision_log_id`를 가진다.

#### Scenario: 한 평가에서 두 주문 생성
- **WHEN** 한 평가 사이클이 AVG와 BIG 두 주문을 생성
- **THEN** 두 주문은 동일한 `decision_log_id`를 가져야 한다

#### Scenario: 매도 결정의 단일 주문
- **WHEN** SELL 결정이 한 주문을 생성
- **THEN** 해당 주문의 `decision_log_id`는 그 결정 로그의 id를 가리켜야 한다

### Requirement: 자동 취소 흐름의 절반 무관 처리

평가 시작 시 자동 취소는 절반 종류(`FIRST`/`AVG`/`BIG`/`SELL`)와 무관하게 우리 시스템이 만든 모든 미체결을 대상으로 한다.

#### Scenario: 이전 사이클의 두 미체결
- **WHEN** 이전 평가의 `AVG` 미체결과 `BIG` 미체결이 둘 다 KIS에 남아 있음
- **THEN** 새 평가 시작 시 두 주문 모두 KIS 정정취소 API로 취소되고 `CANCELED`로 마킹되어야 한다

### Requirement: 마이그레이션 0021

다음 컬럼이 추가되어야 한다(NULL 허용으로 기존 데이터 호환):
- `auto_trading_orders.decision_log_id` INTEGER REFERENCES `decision_logs(id)`
- `auto_trading_orders.half` TEXT
- `strategies.pending_avg_budget` REAL DEFAULT 0
- `strategies.pending_big_budget` REAL DEFAULT 0

#### Scenario: 기존 데이터 보존
- **WHEN** 마이그레이션 0021이 적용됨
- **THEN** 기존 `auto_trading_orders`, `strategies` 행은 모두 그대로 유지되고 신규 컬럼은 NULL/0으로 초기화되어야 한다
