## ADDED Requirements

### Requirement: bigBuyPremiumRate 기본 산식

전략의 `bigBuyPremiumRate`는 사용자가 명시적으로 값을 제공하지 않은 경우 `0.1 / splitCount`로 계산되어야 한다. 사용자가 값을 명시한 경우 그 값을 그대로 사용한다(override).

#### Scenario: 분할 회차 40인 신규 전략에서 사용자가 여유율을 비워둠
- **WHEN** 사용자가 전략 생성 시 `splitCount=40`을 입력하고 `bigBuyPremiumRate`는 입력하지 않음
- **THEN** 시스템은 해당 전략의 `bigBuyPremiumRate`로 `0.1 / 40 = 0.0025`를 적용해야 한다

#### Scenario: 사용자가 여유율을 직접 입력
- **WHEN** 사용자가 `splitCount=40`, `bigBuyPremiumRate=0.05`를 입력
- **THEN** 시스템은 산식이 아닌 사용자가 입력한 0.05를 그대로 사용해야 한다

#### Scenario: 기존 전략의 기존 값 보존
- **WHEN** 본 change 배포 전부터 `bigBuyPremiumRate=0.1`로 저장된 전략이 RUNNING 상태로 존재
- **THEN** 시스템은 해당 값을 명시적 override로 간주하고 0.1을 그대로 적용해야 한다

### Requirement: 매수 결정의 절반 분리 (intents)

자동매매 평가 엔진은 매수 결정(`decision: 'BUY'`)을 다음 절반 종류로 분해해 `intents` 배열로 반환해야 한다.
- `FIRST`: 첫 매수(보유 0). 1건만 생성.
- `AVG`: 평단가 매수. 현재가 ≤ 평단가일 때 생성.
- `BIG`: 큰수 매수. 현재가 ≤ 전일종가 × (1 + bigBuyPremiumRate)일 때 생성.

`AVG`와 `BIG`은 같은 평가에서 독립적으로 생성 가능하다.

#### Scenario: 평단가 매수와 큰수 매수 모두 발동
- **WHEN** 현재가가 평단가 이하 + 전일종가 × (1 + bigBuyPremiumRate) 이하
- **THEN** intents 배열은 길이 2 (`AVG`, `BIG`)를 가져야 한다
- **AND** 각 intent의 `orderPrice`는 각각 평단가, 전일종가 × (1 + bigBuyPremiumRate)로 설정되어야 한다

#### Scenario: 큰수 매수만 발동
- **WHEN** 현재가가 평단가 위 + 전일종가 × (1 + bigBuyPremiumRate) 이하
- **THEN** intents 배열은 `BIG` 1건만 포함해야 한다

#### Scenario: 둘 다 미발동
- **WHEN** 현재가가 평단가 위 + 전일종가 × (1 + bigBuyPremiumRate) 초과
- **THEN** `decision: 'HOLD'`로 반환하고 intents는 빈 배열이어야 한다

#### Scenario: 첫 매수
- **WHEN** 보유 수량이 0이고 분할 회차가 남아 있음
- **THEN** intents 배열은 `FIRST` 1건만 포함하고 `orderPrice`는 평가 시점의 현재가여야 한다

### Requirement: 회차 예산 carryover

자동매매 전략은 `strategies.pending_avg_budget`, `strategies.pending_big_budget` 컬럼에 절반별 누적 예산을 보관해야 한다.

각 평가에서 사용 가능한 절반 예산은:
```
availableAvgBudget = (cycleBudget / splitCount) / 2 + pending_avg_budget
availableBigBudget = (cycleBudget / splitCount) / 2 + pending_big_budget
```

매수 후 갱신:
- 절반에서 정수 1주 이상 매수가 성사: 해당 절반의 잔액(`availableBudget − 매수금액`)을 같은 절반의 `pending` 컬럼에 저장
- 절반에서 1주를 못 만듦: `availableBudget` 전액을 같은 절반의 `pending`에 보존

새 사이클 시작(목표 매도 후 새 사이클, 또는 분할회차 소진 후 1/4 매도) 시 `pending_avg_budget = pending_big_budget = 0`.

#### Scenario: 평단가 매수에서 1주를 못 사 carryover 발생
- **WHEN** `availableAvgBudget = $50`, 평단가 $80
- **THEN** AVG intent는 생성되지 않고 `pending_avg_budget`이 $50으로 갱신되어야 한다
- **AND** 다음 평가에서 회차 절반 예산 + $50을 합산해 평가해야 한다

#### Scenario: 누적 후 1주 매수
- **WHEN** 이번 회차 절반 $50 + `pending_avg_budget = $50` = $100, 평단가 $80
- **THEN** AVG intent는 `expectedQuantity = 1`로 생성되고 매수 후 `pending_avg_budget = 100 - 80 = 20`이 되어야 한다

#### Scenario: 사이클 리셋
- **WHEN** 목표 매도가 발생해 새 사이클이 시작됨
- **THEN** `pending_avg_budget`과 `pending_big_budget`은 0으로 초기화되어야 한다

### Requirement: 매수 주문 접수 순서

각 intent는 평단가(`AVG`) → 큰수(`BIG`) 순으로 직렬 접수되어야 한다. 첫 매수(`FIRST`)는 단독 접수.

#### Scenario: 두 intent가 모두 SafetyGuard를 통과
- **WHEN** `AVG`와 `BIG` 두 intent 모두 매수가능금액·수량 조건을 만족
- **THEN** 시스템은 `AVG`를 먼저 KIS에 접수해 응답을 기다린 후 `BIG`을 접수해야 한다

#### Scenario: AVG 통과 후 BIG의 매수가능금액 부족
- **WHEN** `AVG` 주문이 매수가능금액을 소진하여 `BIG`의 SafetyGuard가 차단
- **THEN** `AVG`만 접수되고 `BIG`은 SKIP으로 결정 로그에 기록되어야 한다

### Requirement: SafetyGuard의 intent 단위 평가

SafetyGuard는 각 intent에 대해 독립적으로 매수가능금액·수량·중복 idempotency_key를 검사해야 한다. 한 intent의 실패가 다른 intent를 차단하지 않는다.

KIS Open API의 해외 정수 주 제약 때문에 "실주문 + 해외 + quantity < 1" 차단 가드는 유지되지만, 평가 엔진이 carryover로 1주 미만을 사전에 흡수하므로 이 가드가 실제 발동하는 경우는 거의 없어야 한다(이상치 방어용으로 보존).

#### Scenario: 1주 미만이 intent로 만들어지지 않음
- **WHEN** `availableAvgBudget / 평단가 < 1`
- **THEN** AVG intent는 생성되지 않고 carryover로 흡수되어야 한다 (SafetyGuard 발동 X)

### Requirement: 미체결 자동 취소가 모든 intent 출처 주문을 포함

평가 사이클 시작 시 수행되는 자동 취소(`TTTC0013U`/`TTTT1004U`)는 우리 시스템이 이전 사이클에서 생성한 `AVG`/`BIG`/`FIRST` 모든 종류의 미체결 주문을 포함해야 한다. 사용자가 외부(KIS HTS/MTS)에서 만든 주문은 절대 취소하지 않는다.

#### Scenario: 이전 사이클에서 AVG, BIG 두 주문이 미체결로 남음
- **WHEN** 새 평가 사이클이 시작되고 두 미체결 주문이 `auto_trading_orders`에 존재
- **THEN** 두 주문 모두 KIS 정정취소 API로 취소되고 `CANCELED`로 마킹되어야 한다
- **AND** 자동 취소 후 KIS에서 미체결을 재조회해 SafetyGuard에 전달해야 한다

#### Scenario: DRY_RUN 모드
- **WHEN** `liveOrderEnabled=false`
- **THEN** 자동 취소는 호출되지 않아야 한다

### Requirement: 회차 카운터 정책

`currentRound`는 한 평가 사이클에서 어떤 절반이라도 실제 매수가 성사된 경우에만 +1 한다. 두 절반 모두 carryover만 발생한 사이클은 카운터 유지.

#### Scenario: 두 절반 모두 carryover
- **WHEN** AVG와 BIG 모두 1주 미만이라 매수 미발생
- **THEN** `currentRound`는 그대로이고 `pending_avg_budget`, `pending_big_budget`만 갱신되어야 한다

#### Scenario: 한 절반만 매수 성사
- **WHEN** AVG는 매수 성사, BIG는 carryover
- **THEN** `currentRound`는 +1이고 두 `pending` 컬럼은 정상 갱신되어야 한다
