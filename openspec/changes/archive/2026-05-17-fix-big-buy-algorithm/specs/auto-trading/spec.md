## ADDED Requirements

### Requirement: 자동매매 큰수 매수 지정가는 평단가 기준

자동매매 엔진(`autoTradingStrategyEngine.js`)은 큰수 매수(`BIG` intent)의 지정가를 `평단가 × (1 + bigBuyPremiumRate)`로 계산해야 한다(MUST). 전일 종가 또는 KIS 기준가는 큰수 매수 지정가 계산에 사용하지 않는다. 큰수 매수 발동 여부도 현재가가 이 평단가 기준 지정가 이하인지로 판단한다.

첫 매수(`FIRST` intent, 보유 0)는 종전대로 현재가 단건 매수로, 본 요구사항의 영향을 받지 않는다.

#### Scenario: 보유 중 큰수 매수 지정가 계산
- **WHEN** 평단가 55, `bigBuyPremiumRate` 0.1로 보유 중인 전략을 평가
- **THEN** 큰수 매수 지정가는 `55 × 1.1 = 60.5`이어야 한다
- **AND** 전일 종가·기준가 값과 무관해야 한다

#### Scenario: 현재가가 큰수 매수 지정가 이하 → 큰수 매수 발동
- **WHEN** 평단가 55, 큰수 매수 지정가 60.5, 현재가 57(평단가 초과, 큰수 지정가 이하)
- **THEN** 평단가 매수는 발동하지 않고 큰수 매수(`BIG`)가 발동해 그 지정가에 매수 intent를 만들어야 한다

#### Scenario: 현재가가 큰수 매수 지정가 초과 → 큰수 매수 미발동
- **WHEN** 평단가 55, 큰수 매수 지정가 60.5, 현재가 62
- **THEN** 큰수 매수는 발동하지 않아야 한다

### Requirement: 자동매매 큰수 매수 여유율 기본값은 고정 10%

`big_buy_premium_rate`가 NULL이면 자동매매는 분할 회차와 무관한 고정 `0.1`(10%)을 사용해야 한다(MUST). 값이 있으면 사용자 override로 그대로 사용한다. 분할 회차는 큰수 매수 여유율에 영향을 주지 않는다.

#### Scenario: 여유율 미설정 전략
- **WHEN** `split_count=40`, `big_buy_premium_rate`가 NULL인 전략을 평가
- **THEN** 큰수 매수 여유율은 `0.1`로 적용되어야 한다

#### Scenario: 분할 회차가 달라도 기본값 동일
- **WHEN** `split_count=10`, `big_buy_premium_rate`가 NULL인 전략을 평가
- **THEN** 큰수 매수 여유율은 여전히 `0.1`이어야 한다

#### Scenario: 사용자 override
- **WHEN** 전략의 `big_buy_premium_rate`가 `0.05`로 저장됨
- **THEN** 큰수 매수 여유율은 `0.05`로 적용되어야 한다
