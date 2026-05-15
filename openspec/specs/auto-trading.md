# 자동매매

## 책임

사용자별 KIS 자격증명을 사용해 단일 종목 자동매매 전략(`LAOR_INFINITE_V2`)을 RUNNING 상태로 운용한다. 스케줄러가 주기 평가, 안전 검증, 모의 또는 실주문 전송, 미체결 자동 취소, 판단 로그·포지션 스냅샷 기록을 담당한다.

## 주요 파일

- `backend/src/routes/autoTradingRoutes.js`
- `backend/src/services/autoTradingService.js` — 전략 CRUD, evaluate, dashboard, account summary, buying-power preview
- `backend/src/services/autoTradingStrategyEngine.js` — 자동매매용 의사결정 wrapper (백테스트와 동일 규칙을 현재가/평단가/기준가에 적용)
- `backend/src/services/strategyCalculator.js` — 실시간 LAOR 판단 (평단가 매수 / 큰수 매수 두 절반)
- `backend/src/services/autoTradingSafetyGuard.js` — 안전 검증
- `backend/src/services/autoTradingScheduler.js` — 주기 평가 tick
- `backend/src/services/kisTradingService.js` — KIS 잔고, 매수가능금액, 미체결, 주문, 정정취소
- `backend/src/repositories/autoTradingRepository.js`
- `backend/tests/autoTrading.test.js`

## 상태 머신 (`auto_trading_strategies.status`)

`CREATED` → (`start`) → `RUNNING` → (`stop`) → `STOPPED`. 평가 중 예외 발생 시 `ERROR` + `last_error_message`.

## 평가 사이클 (한 tick)

1. 사용자별 `kisAuthService.getAuthContext`로 토큰 확보 (만료 시 자동 재발급).
2. KIS에서 다음 데이터 조회: 현재가, 전일 종가/기준가, 잔고(보유 수량·평단·평가금), 매수가능금액, 미체결 주문 목록.
3. `autoTradingStrategyEngine.evaluateAutoTrading`으로 판단 도출. 매수 결정은 `intents` 배열로 분해된다: `FIRST`(첫 매수) 또는 `AVG`(평단가 매수)·`BIG`(큰수 매수) 두 절반. 각 절반은 1주 단위 정수 수량만 만들고, 절반 예산이 1주 가격에 못 미치면 intent를 만들지 않고 carryover로 누적한다.
4. **자동 취소** (실주문 모드 + 미체결 존재 시): `auto_trading_orders`에서 본 시스템이 이전에 접수한 상태(`REQUESTED` / `ACCEPTED` / `PARTIALLY_FILLED` / `UNKNOWN`)이고 `kis_order_no`가 있는 행만 KIS 정정취소(국내 `TTTC0013U`, 해외 `TTTT1004U`)로 취소, 로컬은 `CANCELED`로 마킹. 사용자가 HTS/MTS로 직접 만든 주문은 절대 건드리지 않는다. DRY_RUN 모드는 자동 취소를 수행하지 않는다.
5. 자동 취소 후 미체결을 재조회.
6. `autoTradingSafetyGuard.validateOrderSafety`로 안전 검증:
   - 전략이 RUNNING 상태인가
   - 결정이 BUY 또는 SELL인가 (HOLD/SKIP은 통과 없이 noOrder)
   - `expectedQuantity > 0`
   - 미체결 주문이 없음
   - 동일 `idempotency_key` 중복 없음 (`auto_trading_orders.idempotency_key` UNIQUE)
   - BUY: 매수가능금액 ≥ 예상 금액
   - SELL: 보유 수량 ≥ 예상 수량
   - 실주문 + 해외 BUY + `expectedQuantity < 1` → 차단 (KIS 표준 해외주문은 정수 주만 지원; 이상치 방어용. 평가 엔진이 1주 미만을 carryover로 흡수하므로 실제로는 거의 발동하지 않음)
   - SafetyGuard는 `intents` 배열의 각 intent를 독립 평가한다. 한 intent의 SKIP이 다른 intent를 차단하지 않는다.
7. 분기:
   - `liveOrderEnabled = false` → 각 intent를 `auto_trading_orders` row로 `DRY_RUN` 상태 저장.
   - `liveOrderEnabled = true` → intent를 평단가(`AVG`) → 큰수(`BIG`) 순으로 직렬 접수. KIS 매수/매도 주문 API 호출, 응답에 따라 `REQUESTED` → `ACCEPTED` / `PARTIALLY_FILLED` / `FILLED` / `REJECTED` / `FAILED` / `UNKNOWN`. 같은 평가의 모든 주문은 동일 `decision_log_id`로 묶인다.
8. 포지션 스냅샷(`auto_trading_position_snapshots`)에 결정(`decision`)과 함께 저장.
9. 판단 로그(`auto_trading_decision_logs`)에 시간·결정·평가 출처(MANUAL/SCHEDULED)·현재가·평단가·목표가·목표가까지의 거리·예상 수량·예상 금액·미체결 수·연결된 주문 id·사유 저장.

## 스케줄러

- `autoTradingScheduler.startAutoTradingScheduler()`가 `AUTO_TRADING_SCHEDULER_ENABLED=true`일 때 `AUTO_TRADING_SCHEDULER_INTERVAL_MS`(기본 600000ms = 10분) 주기로 tick.
- 각 tick에서 RUNNING 전략들을 `evaluateRunningStrategies()`로 평가.
- 동시 평가 차단: `auto_trading_locks(strategy_id, lock_key)` UNIQUE 로 락 획득.
- 장 운영 시간이 아니거나 판단이 불확실하면 `SKIP`으로 기록하고 주문 전송 없음.

## 실주문 실행 설정

- `user_trading_settings.live_order_enabled` (사용자당 1행). 변경 시 `user_trading_setting_histories`에 이전/새 값 기록.
- 켜짐: 안전 검증을 통과한 주문이 KIS로 실제 전송된다.
- 꺼짐: 평가·판단 로그·포지션 스냅샷·DRY_RUN 주문 기록까지는 동일하게 진행하며 KIS 주문 API만 호출하지 않는다.

## 통화 / 환전

- 전략 통화 = 종목 통화 (국내 `KRW`, 미국 `USD`).
- USD 종목에 KRW → USD 자동 환전 기능 없음. KIS HTS `[0867]` 통합증거금 신청 또는 사용자가 직접 환전한 USD 잔고만 사용 가능.
- 해외 잔고 응답에는 `frcr_ord_psbl_amt1`(외화 주문가능금액) 외에 `echm_af_ord_psbl_amt`(환전 후 주문가능금액), `echm_af_ord_psbl_qty`, `exrt`(환율)도 표준 응답에 포함.
- 자산 평가는 종목 통화 기준. KRW 환산값이 필요하면 별도 계산.

## 멱등성과 중복 방지

`makeIdempotencyKey({ tradeDate, strategyId, round, half })`로 `{YYYYMMDD}-{strategyId}-{round}-{half}` 형식 키를 만든다 (`half`는 `FIRST`/`AVG`/`BIG`/`SELL`). `auto_trading_orders.idempotency_key` UNIQUE로 같은 평가의 같은 절반 중복 주문을 차단하되, `AVG`/`BIG` 두 주문은 서로 다른 키를 가지므로 한 평가에서 공존할 수 있다.

## 큰수 매수 여유율

`auto_trading_strategies.big_buy_premium_rate` (`migrations/0020`). 값이 NULL이면 산식 `0.1 / splitCount`로 자동 계산, 값이 있으면 사용자 override로 그대로 사용 (`resolveBigBuyPremiumRate`, `buyAlgorithm.js`). 큰수 매수 상한 가격 = 전일 종가 또는 KIS 기준가 × (1 + rate).

## 회차 예산 carryover

`auto_trading_strategies.pending_avg_budget` / `pending_big_budget` (`migrations/0021`, REAL default 0). 회차 절반 예산이 1주 가격보다 작으면 매수 intent를 만들지 않고 해당 절반 예산을 누적한다. 다음 평가에서 `(회차 절반) + pending`을 합산해 1주 이상이 되면 매수. 매수 후 잔액은 다시 누적. 목표 매도로 새 사이클이 시작되면 두 컬럼 모두 0으로 리셋. 자동매매·백테스트(1주 단위 모드) 공통 정책.

## 분할회차 cap

전략 생성 시 종목 현재가 기준 최대 분할회차 = `floor(totalBudget / (referencePrice × 2))` (한 회차의 절반이 최소 1주 가격 이상이 되도록). 프론트엔드 입력 박스가 이 값으로 클램프하고, 백엔드 `autoTradingService.normalizeStrategyInput`도 `referencePrice`가 전달되면 검증해 초과 시 400.
