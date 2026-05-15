## ADDED Requirements

### Requirement: 백테스트 큰수 매수 산식 일치

백테스트 엔진(`strategyEngine.js`)은 자동매매와 동일한 `bigBuyPremiumRate` 정책을 사용해야 한다. 사용자 입력이 없으면 `0.1 / splitCount`, 있으면 그 값을 사용.

#### Scenario: 사용자 입력 없이 백테스트 실행
- **WHEN** 사용자가 `splitCount=40`, `bigBuyPremiumRate`는 미입력으로 백테스트 실행
- **THEN** 큰수 매수 상한가는 `전일종가 × (1 + 0.0025)`로 계산되어야 한다

### Requirement: 일봉 두 지정가 체결 시뮬레이션

매수 결정이 평단가 절반(`AVG`)과 큰수 절반(`BIG`) 두 intent로 분해되었을 때, 백테스트는 일봉의 `low`와 각 지정가를 비교해 체결 여부를 결정한다. 체결가는 `min(open, 지정가)`로 산정한다.

#### Scenario: 시초가가 두 지정가 모두 아래
- **WHEN** 일봉이 `open=8000`, `low=7800`, 평단가 지정가 9500, 큰수 지정가 10025
- **THEN** `AVG`는 8000원에 체결, `BIG`은 8000원에 체결되어야 한다 (둘 다 `min(open, 지정가)`)

#### Scenario: 시초가가 큰수 지정가 위
- **WHEN** 일봉이 `open=10100`, `low=9400`, 평단가 지정가 9500, 큰수 지정가 10025
- **THEN** `AVG`는 9500원, `BIG`은 10025원에 체결되어야 한다

#### Scenario: 일봉 저가가 두 지정가 모두 위
- **WHEN** 일봉이 `low=11000`, 평단가 지정가 9500, 큰수 지정가 10025
- **THEN** 둘 다 미체결로 HOLD 처리되어야 한다

### Requirement: 백테스트 매수 단위 모드

백테스트는 두 가지 매수 단위 모드를 지원해야 한다.

- **기본 (1주 단위)**: `allowFractionalShares = false`. 자동매매와 동일하게 정수 주만 매수한다. 국내/해외 무관.
- **소수점 매매 (옵션)**: `allowFractionalShares = true`. 사용자가 명시적으로 켤 때만 소수점 수량으로 매수하는 시뮬레이션 결과를 만든다.

이전 동작("미국 종목이면 무조건 소수점")은 제거된다. `backtest_runs.allow_fractional_shares` 컬럼에 모드를 저장하고, 결과 조회 시 어느 모드였는지 노출한다.

#### Scenario: 기본 모드 (옵션 미선택)
- **WHEN** 사용자가 미국 종목 백테스트를 소수점 옵션 없이 실행
- **THEN** 매수 수량은 모두 정수 주여야 한다
- **AND** 회차 절반 예산이 1주 가격보다 작으면 carryover로 이월되어야 한다

#### Scenario: 소수점 매매 옵션 선택
- **WHEN** 사용자가 `allowFractionalShares = true`로 백테스트를 실행
- **THEN** 매수 수량은 소수점(6자리)으로 계산되어야 한다

#### Scenario: 결과에 모드 노출
- **WHEN** 백테스트 결과를 조회
- **THEN** 응답에 `allowFractionalShares` 필드가 포함되어 어느 모드로 계산되었는지 알 수 있어야 한다

### Requirement: 백테스트 carryover

백테스트는 1주 단위 모드일 때 자동매매와 동일한 carryover 정책을 따라야 한다. 거래일의 절반 예산이 1주 가격보다 작거나 체결 후 잔액이 남으면 다음 거래일로 누적. 소수점 매매 모드에서는 항상 절반 예산 전액을 소수점 수량으로 소진하므로 carryover 잔액이 0에 수렴한다.

#### Scenario: 첫 거래일에 시가가 회차 예산보다 큼 (1주 단위 모드)
- **WHEN** 회차 예산 $50, 시가 $80, `allowFractionalShares = false`
- **THEN** 첫 매수는 발생하지 않고 carryover로 $50이 다음 거래일로 이월되어야 한다

#### Scenario: 누적 후 매수 (1주 단위 모드)
- **WHEN** 평단가 절반 누적 $50 + 이번 거래일 절반 $50 = $100, 평단가 $80
- **THEN** 1주 매수, 잔액 $20은 다시 carryover로 보존되어야 한다

### Requirement: 첫 매수는 시가 단건

보유 0 상태의 첫 매수는 시가에 회차 예산만큼 매수한다. 1주 단위 모드에서 시가가 회차 예산보다 크면 carryover로 이월.

#### Scenario: 정상 첫 거래일 (1주 단위 모드)
- **WHEN** 첫 거래일이고 보유 0, 시가 매수 가능, `allowFractionalShares = false`
- **THEN** 시가에 정수 주만 매수해야 한다

#### Scenario: 첫 거래일 (소수점 모드)
- **WHEN** 첫 거래일이고 보유 0, `allowFractionalShares = true`
- **THEN** 시가에 소수점 수량으로 회차 예산만큼 매수해야 한다

### Requirement: 회차 카운터는 매수 발생 시 1회만 증가

한 거래일에 `AVG`와 `BIG` 두 매수가 모두 체결돼도 `currentRound`는 1만 증가. 둘 다 carryover만 발생한 거래일은 카운터 유지.

#### Scenario: 두 매수 동시 체결
- **WHEN** 한 거래일에 `AVG`, `BIG` 두 intent 모두 체결
- **THEN** `currentRound`는 1만 증가해야 한다

#### Scenario: 둘 다 carryover만 발생
- **WHEN** 두 절반 모두 1주를 못 사는 거래일
- **THEN** `currentRound`는 변하지 않고 `pending_*_budget`만 갱신되어야 한다

### Requirement: 백테스트 결과의 알고리즘 버전 표기

`backtest_runs` 결과 응답은 본 change의 산식·체결 모델로 계산되었음을 식별할 수 있는 메타정보를 포함해야 한다(예: `algorithmVersion: 'LAOR_INFINITE_V2_NATIVE'`). 컬럼 추가는 후속 change에서 결정.

#### Scenario: 결과 응답
- **WHEN** 백테스트 결과를 조회
- **THEN** 응답에 `algorithmVersion` 또는 동등 필드가 포함되어야 한다
