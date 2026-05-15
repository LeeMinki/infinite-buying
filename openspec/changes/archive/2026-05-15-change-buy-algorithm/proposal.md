## Why

현재 매수 알고리즘은 라오어 무한매수법 V2를 표방하지만 두 가지 핵심 디자인이 정통 V2와 다르다.

1. **산식**: 큰수 매수 상한가가 고정 `+10%` (전일종가 × 1.1) 이다. 정통 V2는 `+0.1/N` (분할회차 N에 반비례)으로, 회차당 예산이 작을수록 매수 가격도 보수적으로 잡는 디자인이다. 지금 구조는 40분할이든 10분할이든 상한이 똑같이 +10%라서 회차 분할의 의미가 매수 가격 측면에서는 사라진다.
2. **주문 방식**: 평가 시점에 KIS 현재가를 받아 그 가격에 지정가 1건을 접수한다. 정통 V2의 핵심은 "평단가에 절반 지정가 + 상한가에 절반 지정가 두 건을 미리 걸어두고 시장이 더 싸게 가져가도록 두는 것"인데, 현재 코드는 폴링 시점의 현재가에 지정가를 거니까 그 메커니즘이 작동하지 않는다.

추가로 본 change 검토 과정에서 다음 사실들이 확인됐다.

3. **KIS Open API는 해외 소수점매수를 지원하지 않는다** (2026-05-12 자 KIS 공식 엑셀, 공식 GitHub 샘플코드, KIS Developers 포털 모두 일치). 해외 주문 endpoint(`TTTT1002U` 등)는 정수 주만 받는다. `mint_dcpt_trad_psbl_yn` 필드는 KIS MTS 앱의 소수점 거래 가능 여부 메타데이터이며, OpenAPI에서 사용 가능한 보장이 아니다.
4. 따라서 현재 SafetyGuard의 "1주 미만 차단" 가드는 KIS 정수 제약 때문에 그대로 유지되어야 하지만, 사용자가 "1주 미만이라 매수 못 함"이라는 메시지를 자주 보는 건 UX 문제다. 이를 두 가지로 보완한다.
   - **분할회차 자동 cap UI**: 전략 생성 시 총예산·1주 가격을 기준으로 매수가 보장되는 최대 분할회차를 자동 계산해 사용자가 그 이상 입력하지 못하게 한다.
   - **회차 예산 carryover**: 가격 변동으로 절반 예산이 1주 값보다 작아진 경우, 그 절반을 다음 사이클로 누적해 합산 후 매수할 수 있도록 한다.

본 change는 위 4가지를 모두 반영해 정통 라오어 V2를 KIS Open API의 제약 안에서 가장 가깝게 구현한다.

## What Changes

- **BREAKING**: `bigBuyPremiumRate`의 기본 산식을 고정 `0.1`에서 `0.1 / splitCount`로 변경. 사용자가 명시적으로 값을 넘기면 그 값을 그대로 쓴다(override). 기존 데이터 중 `big_buy_premium_rate` 컬럼에 `0.1`이 저장된 행은 사용자가 명시한 값으로 간주하되, 신규 전략은 NULL/미설정일 때 산식 기반 값을 적용.
- **BREAKING**: 자동매매 평가 사이클의 매수 주문 흐름 변경.
  - 기존: 평가 시점 현재가에 지정가 1건 (`ORD_DVSN=00`, `ORD_UNPR=current_price`).
  - 신규: 한 평가 사이클에서 매수 조건이 발동하면 평단가/큰수 매수 두 절반에 대해 각각 별도 지정가 주문 2건을 접수. 평단가 매수는 `ORD_UNPR=평단가`, 큰수 매수는 `ORD_UNPR=전일종가 × (1 + bigBuyPremiumRate)`. 한 절반만 조건 만족이면 1건만 접수. 첫 매수(보유 0)는 종전대로 시가/현재가에 1건만 접수.
- 백테스트도 동일하게 두 절반의 지정가 체결 메커니즘으로 시뮬레이션. 한 거래일의 `low`와 두 지정가를 비교해서 체결 여부와 체결가를 결정.
- **신규**: 백테스트 매수 단위 모드. 기존 "미국 종목이면 무조건 소수점" 동작을 제거하고, **기본은 1주 단위 매수**(자동매매와 동일), 사용자가 옵션을 켜면 소수점 매매 시뮬레이션 결과를 보여준다. `backtest_runs.allow_fractional_shares` 컬럼에 모드 저장.
- **신규**: 회차 예산 **carryover**. 평단가/큰수 각 절반 예산 중 정수 1주를 못 사는 경우 잔액을 `strategies.pending_avg_budget` / `strategies.pending_big_budget`에 누적. 다음 평가에서 신규 회차 절반 + carryover 합산으로 매수 시도. 자동매매·백테스트 동일 정책.
- **신규**: 전략 생성 폼에서 **분할회차 자동 cap**. 최대 분할회차 = `floor(totalBudget / (referencePrice × 2))` (한 회차의 절반이 최소 1주 가격 이상이 되도록). UI는 입력 시점에 cap을 계산해 그 이상 값을 받지 않으며, 종목/가격/예산이 바뀌면 cap도 재계산. 백엔드 검증도 함께 적용.
- **신규**: 자동매매 화면에 "이 종목은 **1주 단위 매수**만 가능합니다" 안내. KIS Open API의 해외 정수 주 제약을 명시.
- `auto_trading_orders.idempotency_key`에 매수 종류 식별자(`AVG` / `BIG` / `FIRST` / `SELL`)를 추가. 같은 평가에서 두 주문이 충돌하지 않도록.
- `auto_trading_orders`에 `decision_log_id` 외래키 추가. 한 결정에 2건 주문이 1:N으로 묶임.
- 자동 취소 흐름(`TTTC0013U` / `TTTT1004U`)은 그대로 두 주문 모두에 적용.
- 프론트엔드 전략 초안/생성 폼: 큰수 매수 여유율 입력 박스에 "비워두면 0.1 / 분할회차 자동 산식" 안내 + 분할회차 입력 박스에 최대값 안내.
- 알고리즘 설명 패널(`LaorStrategyGuide`): 두 절반 지정가 방식, 산식 기본값, carryover, 1주 단위 매수 제약을 반영해 본문 갱신.

## Capabilities

### New Capabilities

(없음 — 기존 capability의 동작 변경)

### Modified Capabilities

- `auto-trading`: 매수 평가 시 두 절반에 대해 별도의 지정가 주문 2건을 접수. `bigBuyPremiumRate` 기본 산식 변경. carryover 적용.
- `backtest`: 두 절반의 지정가 체결 메커니즘으로 일봉 시뮬레이션. 산식 기본값 변경. carryover 적용.
- `orders-fills-positions`: 한 평가 사이클에서 동일 결정으로 주문 2건이 생성될 수 있음. `idempotency_key` 형식 확장. `decision_log_id` 1:N 연결.
- `frontend-screens`: 전략 초안/생성 폼의 큰수 매수 여유율 입력 의미 변경, 분할회차 자동 cap UI, "1주 단위 매수만 가능" 안내 추가.
- `current-limitations`: KIS Open API 해외 소수점매수 미지원을 명시. carryover로 1주 미만 케이스를 어떻게 흡수하는지 기술.

## Impact

- **코드**:
  - `backend/src/services/strategyEngine.js` — 백테스트 평가일의 두 지정가 체결 시뮬레이션, `bigBuyPremiumRate` 기본 산식, carryover.
  - `backend/src/services/autoTradingStrategyEngine.js` — 매수 결정을 `decision: 'BUY'` 1건이 아닌 절반별 매수 의도 2건으로 분해, carryover 계산.
  - `backend/src/services/autoTradingService.js` — 결정당 2건 주문 접수 흐름, idempotency_key 형식, decision_log_id 1:N, 미체결 사이에 carryover 갱신.
  - `backend/src/services/kisTradingService.js` — 인터페이스 검토(현행 유지 가능 추정).
  - `backend/src/services/strategyCalculator.js` — 라이브 단일가 평가에서 두 절반 의도 표현.
  - `backend/src/services/strategiesService.js` — 신규 전략 생성 시 `bigBuyPremiumRate` 기본값 산식 적용, 분할회차 cap 백엔드 검증, 추가 컬럼 처리.
  - `frontend/src/components/StrategyDraftForm.jsx`, 자동매매 폼, `LaorStrategyGuide.jsx` — 안내 문구, override 입력, 분할회차 cap UI, 1주 단위 안내.
- **DB**:
  - 마이그레이션 0021: `auto_trading_strategies`에 `pending_avg_budget`, `pending_big_budget` (REAL, default 0) 컬럼 추가. `auto_trading_orders`에 `decision_log_id` (INTEGER, NULL 허용 → references auto_trading_decision_logs.id), `half` (TEXT, NULL 허용) 컬럼 추가. `backtest_runs`에 `allow_fractional_shares` (INTEGER, default 0) 컬럼 추가.
  - `strategies.big_buy_premium_rate` 컬럼 의미만 "NULL이면 산식, 값이면 override"로 갱신.
- **API**: 새 엔드포인트는 없음. 결정 로그/주문 응답 스키마에 `half` 필드 + `decisionLogId` 노출. 전략 생성 응답에 `effectiveBigBuyPremiumRate`, `maxSplitCount` 미리보기 필드 추가.
- **테스트**:
  - 백테스트 엔진의 두 지정가 체결 케이스 + carryover 시나리오 추가.
  - 자동매매 평가 → 주문 1~2건 접수 → carryover 갱신 → 다음 사이클 흡수 통합 테스트.
  - 분할회차 cap 검증 단위/통합 테스트.
- **운영**: 기존 RUNNING 전략은 큰수 매수 상한이 좁아진다(예: 40분할 → +10% → +0.25%). 마이그레이션/공지 필요. 분할회차가 cap을 넘는 기존 전략 처리 정책 명시(기존 값 유지 + 신규 입력만 검증).
- **위험**: 신규 메커니즘이 KIS rate limit, SafetyGuard, 환율(해외 매수가능금액) 가정과 어긋날 수 있음. carryover 누적이 무한히 커지지 않도록 사이클 리셋 시 0으로 초기화 정책 필요.
