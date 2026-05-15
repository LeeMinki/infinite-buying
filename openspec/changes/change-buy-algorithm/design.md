## Context

`LAOR_INFINITE_V2`는 라오어 무한매수법 V2를 표방하는 자체 변형이다. 변형 지점이 두 곳이었고, 본 change 검토 중 추가 사실들이 확인됐다.

1. 큰수 매수 상한 산식: 정통 V2의 `+0.1/N`이 아니라 고정 `+10%`. (`strategyEngine.js:39-49,279`, `autoTradingStrategyEngine.js:6`)
2. 주문 접수 방식: 평가 사이클마다 KIS 현재가에 지정가 1건. 사전 지정가 2건을 미리 걸어두는 V2 원형이 아님. (`autoTradingStrategyEngine.js:95`, `autoTradingService.js:247-291`)
3. **KIS Open API는 해외 소수점매수를 지원하지 않는다** (2026-05-12 공식 엑셀, 공식 GitHub `koreainvestment/open-trading-api` 의 `examples_llm/overseas_stock/order/order.py`, KIS Developers 포털 모두 일치). 표준 주문 endpoint `TTTT1002U`/`TTTS1001U` 등 모든 해외 endpoint의 `ORD_QTY`는 정수 가정. `mint_dcpt_trad_psbl_yn` 필드는 MTS 앱 메타데이터일 뿐.
4. 본 change 도입 후에는 회차 예산이 두 절반으로 쪼개져 한 절반이 1주 가격보다 작아지는 케이스가 더 자주 발생한다. 사용자가 매번 SafetyGuard SKIP을 보면 UX가 나빠진다.

신규 기능을 추가하는 게 아니라 **기존 동작의 행위가 바뀐다**. 모든 RUNNING 전략에 영향. 마이그레이션·공지 필요.

## Goals / Non-Goals

**Goals:**
- 큰수 매수 상한가 산식을 `0.1 / splitCount`로 변경. 사용자가 명시적으로 값을 넣은 경우만 override.
- 매수 평가 결과로 한 사이클에 두 절반의 매수 의도 2건을 만들고, KIS에 지정가 주문 2건을 동시 접수.
- 백테스트의 일봉 시뮬레이션도 두 절반의 지정가 체결 메커니즘으로 갱신(저가 ≤ 지정가일 때 체결, 체결가는 `min(open, 지정가)`).
- 회차 예산 **carryover**: 절반 예산이 1주 가격 미만이면 다음 사이클로 누적해 합산 후 매수. 자동매매·백테스트 동일 정책.
- **분할회차 자동 cap UI**: `floor(totalBudget / (referencePrice × 2))`로 최대 분할회차를 계산해 그 이상 입력을 차단. 백엔드도 동일 검증.
- 자동매매 화면에 "이 종목은 1주 단위 매수만 가능합니다" 안내. KIS Open API 정수 제약 명시.
- 결정 로그 1건 ↔ 주문 1:N 연결을 위해 `auto_trading_orders.decision_log_id` 추가.
- 사용자가 화면에서 변경 사항을 이해할 수 있도록 알고리즘 가이드/주문 목록 칩/안내 문구 노출.

**Non-Goals:**
- KIS 해외 소수점매수 endpoint 호출. **KIS Open API가 지원하지 않으므로 우리가 구현할 길이 없음**.
- KIS 스마트 주문(예약/조건부) 도입.
- 첫 매수(보유 0) 흐름 변경. 시가/현재가 단건 그대로.
- 매수 외 결정(SELL, HOLD, COMPLETED) 동작 변경.
- KRW→USD 자동 환전.
- 기존 알고리즘 결과와의 비교 도구.

## Decisions

### D1. 산식 기본값을 `0.1 / splitCount`로, 사용자 입력은 override

**채택 이유**: 정통 V2의 의도를 살리면서, 큰수 매수 여유율을 의도적으로 조정하려는 사용자의 손길도 막지 않는다. 현재 UI에 입력 박스가 이미 노출되어 있으므로 제거하지 않는 게 학습 비용이 낮다.

**결정 디테일**:
- `strategies.big_buy_premium_rate` 컬럼은 그대로 둔다. 의미만 "NULL이면 산식, 값이 들어있으면 override".
- 마이그레이션 0021에서 기존 행은 그대로 보존(0.1이 명시적 override로 간주됨).
- 신규 전략 생성 API는 `bigBuyPremiumRate`가 omitted이거나 null이면 산식 사용.

### D2. 매수 평가 결과를 결정 1건 + `intents: [...]` 형태로 변경

```
{
  decision: 'BUY',
  intents: [
    { half: 'AVG', orderPrice, expectedQuantity, expectedAmount, reason },
    { half: 'BIG', orderPrice, expectedQuantity, expectedAmount, reason }
  ],
  reason
}
```

한 절반만 발동하면 `intents` 길이 1. 첫 매수는 `intents: [{ half: 'FIRST', ... }]`. 매도/HOLD/COMPLETED는 `intents` 빈 배열.

### D3. `auto_trading_orders.idempotency_key`에 절반 식별자 부착

**형식**: `${YYYYMMDD}-${strategyId}-${round}-${half}` (예: `20260513-42-3-AVG`). 같은 평가에서 두 주문이 같은 키를 갖는 걸 막는다.

### D4. KIS 주문 접수 순서: 평단가 먼저, 큰수 매수 다음

같은 매수가능금액을 두고 경쟁하므로 결정적 순서가 필요. 평단가 매수가 가격이 보통 더 낮아서 같은 예산으로 더 많은 수량을 살 수 있고, 그쪽이 우선되는 게 사용자 자산 보호에 가깝다. 큰수 매수가 늦게 들어가 매수가능금액 부족이면 그 1건만 SafetyGuard가 차단한다.

### D5. SafetyGuard는 각 intent 단위로 평가

- 매수가능금액 검사를 두 번 (평단가 절반 우선, 통과 후 큰수 절반).
- 두 intent 중 하나만 SafetyGuard 통과면 그것만 접수.
- "실주문 + 해외 + quantity < 1" 차단 가드는 **그대로 유지**. 다만 평가 엔진에서 1주 미만이 발생하면 그 절반은 intent를 만들지 않고 carryover로 처리하므로 이 가드가 실제로 발동하는 일은 거의 없어진다(이상치 방어용으로 남김).

### D6. 백테스트 일봉 체결 규칙

```
평단가 매수 체결: low <= 평단가  →  체결가 = min(open, 평단가)
큰수 매수 체결:   low <= 큰수가격 →  체결가 = min(open, 큰수가격)
```

지정가 매수는 시초가가 이미 지정가 아래면 시초가에, 장중에 지정가에 도달하면 지정가에 체결되는 게 일반적이다. `min(open, 지정가)`가 그 근사다.

### D7. 첫 매수는 단건 유지

첫 매수(보유 0)는 평단가가 없으므로 두 절반 평가가 의미 없다. 사이클 예산의 1회차 전액을 시가/현재가에 단건 매수. 결정 구조에서는 `intents: [{ half: 'FIRST', ... }]`.

### D8. 자동 취소 흐름은 그대로 적용

`auto_trading_orders`에서 우리 시스템이 만든 미체결을 평가 직전 모두 취소. 절반이 둘이든 셋이든 동일 흐름. DRY_RUN 모드 제외 정책 유지.

### D9. KIS 해외 소수점매수는 비목표

- 2026-05-12 자 KIS Open API 공식 엑셀에 해외 소수점매수 endpoint 없음
- 공식 GitHub 샘플코드 `examples_llm/overseas_stock/order/order.py`도 `ord_qty: str` 정수 가정
- KIS Developers 포털의 해외주식 카테고리에 별도 endpoint 없음
- KIS의 해외 소수점거래는 MTS 앱 전용 서비스

본 change는 KIS Open API의 정수 제약을 그대로 받아들이고 다른 방법으로 사용자 의도를 만족시킨다(D10, D11).

### D10. Carryover (회차 예산 누적)

`strategies` 테이블에 두 컬럼을 추가한다.
- `pending_avg_budget` REAL DEFAULT 0
- `pending_big_budget` REAL DEFAULT 0

**평가 시 사용 가능 절반 예산**:
```
availableAvgBudget = perRoundBudget / 2 + pending_avg_budget
availableBigBudget = perRoundBudget / 2 + pending_big_budget
```

**매수 후 잔액 갱신**:
- AVG intent 매수가 성사: `pending_avg_budget = availableAvgBudget - (정수 주 수량 × 평단가 지정가)`
- AVG intent가 1주를 못 만듦: `pending_avg_budget = availableAvgBudget` (전액 다음으로 이월)
- BIG도 동일.

**리셋**: 목표 매도(전량 매도)로 새 사이클이 시작되거나, 시드 재확보(보유 1/4 매도)로 회차가 리셋될 때 `pending_avg_budget = pending_big_budget = 0`. 새 사이클의 사이클 예산이 재계산되니까 이전 잔액은 의미 없다.

**회차 카운터**: AVG 또는 BIG 중 하나라도 실제 매수가 성사된 사이클에만 `currentRound + 1`. 두 절반 다 carryover만 발생한 사이클은 카운터 유지.

### D11. 분할회차 자동 cap

산식: `maxSplitCount = floor(totalBudget / (referencePrice × 2))`

`referencePrice` 결정:
- 신규 전략 생성 폼: 선택한 종목의 KIS 현재가 (`/api/market/price`)
- 백엔드 검증 시점에도 같은 가격을 다시 조회해 입력값 검증

검증 위치:
- **프론트엔드**: 입력 박스의 `max` 속성 + 입력 시 실시간 cap 표시. cap을 넘으면 입력 자체가 안 되거나 자동으로 cap 값으로 클램프.
- **백엔드**: `strategiesService.createStrategy` 직전에 cap 재계산해 위반 시 400.

기존 전략은 cap을 초과해도 그대로 둔다(데이터 정합성 우선). 다만 baseline 문서에 "기존 전략의 cap 위반 시 carryover로 흡수됨"을 명시.

### D12. "1주 단위 매수" 안내

자동매매 폼·상세 화면에 다음 메시지 노출:
> 이 시스템은 KIS Open API 기준으로 **1주 단위 매수**만 지원합니다. 회차 예산이 1주 가격보다 작으면 매수가 다음 사이클로 이월됩니다.

위치:
- 전략 생성 폼 헤더 영역
- `LaorStrategyGuide` 본문
- 자동매매 상세의 주문 목록 빈 상태 안내

### D13. `decision_log_id` 1:N

`auto_trading_orders` 테이블에 `decision_log_id` (INTEGER, NULL 허용, references `decision_logs(id)`) 컬럼 추가. 한 결정 사이클에서 만들어진 모든 주문이 동일 `decision_log_id`로 묶임. 프론트엔드는 이 값으로 그룹화 표시.

### D15. 백테스트 매수 단위 모드

기존 `backtestService.js`는 `allowFractionalShares: params.market === 'US'`로 미국 종목을 무조건 소수점 매매로 시뮬레이션했다. 본 change에서 이를 사용자 옵션으로 바꾼다.

- **기본**: `allowFractionalShares = false`. 자동매매와 동일하게 1주 단위 + carryover.
- **옵션**: 사용자가 백테스트 폼에서 "소수점 매매 시뮬레이션"을 켜면 `allowFractionalShares = true`. 소수점 6자리 수량.

`backtest_runs.allow_fractional_shares` (INTEGER, default 0) 컬럼에 저장해 결과 재조회 시 어느 모드였는지 표시. 백테스트 엔진(`strategyEngine.js`)은 이미 `allowFractionalShares`와 carryover(`pendingAvgBudget`/`pendingBigBudget`)를 지원하므로 엔진 변경은 불필요. service/repository/UI만 옵션을 전달·저장·노출하면 된다.

**채택 이유**: 자동매매는 KIS Open API 제약상 1주 단위만 가능하므로, 백테스트 기본 모드도 동일해야 실거래와 일치하는 기대치를 준다. 소수점 매매는 "이 종목을 소수점으로 굴렸으면 어땠을까"를 참고용으로 보고 싶은 사용자를 위한 옵션.

### D14. 신규 전략·기존 전략 처리 영향

- 신규 전략: 모든 신규 결정 동작 + cap 검증
- 기존 RUNNING 전략: 큰수 매수 상한이 자동으로 좁아짐(`big_buy_premium_rate`가 0.1로 명시되어 있으면 그대로). 회차 cap 초과 상태는 그대로 두되 carryover로 흡수.
- 마이그레이션 0021 적용 시점에 RUNNING 전략의 `pending_*_budget` 컬럼은 0으로 초기화(이전 미체결 잔액 추정은 불가).

## Risks / Trade-offs

- **[KIS rate limit]** → 평가 1회당 주문 2건 직렬 접수 + 기존 220ms 간격 유지로 완화. 10분 주기 평가에는 여유.
- **[기존 사용자 동작 변경]** → RUNNING 전략의 매수 빈도/체결가가 달라진다. 운영 공지 필수.
- **[부분 체결 / carryover 누적]** → 자주 발생할 수 있음. `pending_avg_budget`/`pending_big_budget`이 사이클 리셋 없이 무한 누적되면 한 회차에 많은 수량을 사들이는 경우 발생 가능. 사이클 리셋 정책(D10)으로 완화.
- **[멱등성 충돌]** → 마이그레이션 직후에 같은 사이클의 기존 `BUY` row와 신규 `BUY-AVG/BIG` row가 공존할 가능성. 마이그레이션 0021에서 NULL 허용 컬럼 추가만 하므로 기존 row는 그대로 유효.
- **[백테스트 결과 변화]** → 기존 `backtest_runs.final_*`는 신규 알고리즘 결과와 직접 비교 불가. 결과 화면에 알고리즘 버전 표시.
- **[cap UI 사용자 혼란]** → 사용자가 40분할을 원했는데 5분할로 cap되면 당황. 도움말로 산식·이유를 명시.
- **[프론트엔드 학습 곡선]** → 한 회차에 2건 주문 + carryover까지 등장하면 사용자에게 헷갈림. 주문 목록 칩, 알고리즘 가이드 본문 갱신으로 보완.

## Migration Plan

1. 마이그레이션 0021:
   - `strategies` 테이블에 `pending_avg_budget`, `pending_big_budget` (REAL DEFAULT 0) 컬럼 추가.
   - `auto_trading_orders`에 `decision_log_id` (INTEGER, NULL 허용), `half` (TEXT, NULL 허용) 컬럼 추가.
2. 백엔드 PR 1: 공통 유틸(`resolveBigBuyPremiumRate`, `computeMaxSplitCount`) + 단위 테스트.
3. 백엔드 PR 2: 백테스트 엔진(`strategyEngine.js`) 두 지정가 + carryover + 산식 변경 + 테스트.
4. 백엔드 PR 3: 자동매매 평가 엔진(`autoTradingStrategyEngine.js`) intents 반환 + carryover + 테스트.
5. 백엔드 PR 4: `autoTradingService.js` 주문 흐름 + idempotency_key + decision_log_id + 통합 테스트.
6. 백엔드 PR 5: `strategiesService.js` cap 검증 + effective 값 응답.
7. 프론트엔드 PR: 입력 폼 cap UI, 안내 문구, 알고리즘 가이드, 주문 목록 칩.
8. 운영 공지: README + 자동매매 화면 배너.

(본 apply 세션은 PR 단위로 쪼개지 않고 한 묶음으로 진행. CI/QA 후 단일 PR 또는 합쳐서 머지.)

## Open Questions

- 평단가 매수 1주 미만 발생 시 동작 → **해결**: D10 carryover로 흡수.
- KIS 해외 소수점매수 가능 여부 → **해결**: D9, 비목표.
- decision_log 연결 방식 → **해결**: D13, 1:N.
- Carryover 저장 위치 → **해결**: D10, strategies 테이블에 컬럼 추가.
- 백테스트 결과 화면 알고리즘 버전 표기 → 결과 화면에 라벨(`LAOR_INFINITE_V2_NATIVE`). 저장은 `backtest_runs.algorithm_version` 컬럼이면 깔끔하지만, 본 change에서는 응답 메타로만 노출하고 컬럼 추가는 후속 change.
