# 자동매매

## 책임

사용자별 KIS 자격증명을 사용해 단일 종목 자동매매 전략(`LAOR_INFINITE_V2`)을 RUNNING 상태로 운용한다. 스케줄러가 주기 평가, 안전 검증, 모의 또는 실주문 전송, 미체결 자동 취소, 판단 로그·포지션 스냅샷 기록을 담당한다.

## 주요 파일

- `backend/src/routes/autoTradingRoutes.js`
- `backend/src/services/autoTradingService.js` — 전략 CRUD, evaluate, dashboard, account summary, buying-power preview
- `backend/src/services/autoTradingStrategyEngine.js` — `evaluateAutoTrading`. LAOR_INFINITE_V2_NATIVE 판단(첫 매수 / 평단가·큰수 매수 / 목표 매도 / 회차 소진 1/4 매도 / 사이클 재시작)을 현재가·평단가에 적용
- `backend/src/services/buyAlgorithm.js` — 큰수 매수 여유율·멱등키·분할회차 cap 등 공용 산식
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
3. `autoTradingStrategyEngine.evaluateAutoTrading`으로 판단 도출. **회차 모델: 1 회차 = 1 거래일.** 엔진은 그날 이미 접수/체결된 매수 슬롯(`executedHalves`)을 입력으로 받아 아직 안 산 슬롯만 의도로 만든다. 매수 결정은 `intents` 배열: 보유 0이면 `FIRST`(시작가 일괄 매수) 1건, 보유>0이면 `AVG`(평단가 매수)·`BIG`(큰수 매수) 각 회차 예산 절반 — 가격 조건을 만족할 때만. 같은 날 이미 산 슬롯은 다시 만들지 않고, 안 산 슬롯은 그날 안에 조건이 맞으면 그때 매수한다. 매도 결정은 단일 `SELL` intent(목표 수익률 도달 전량 매도 / 회차 소진+현금 부족 시 보유 1/4 매도). 미체결 예산을 다음 회차로 이월하지 않는다.
4. **주문 정리** (실주문 모드): `auto_trading_orders`에서 본 시스템이 이전에 접수한 비종결 상태(`REQUESTED` / `ACCEPTED` / `PARTIALLY_FILLED` / `UNKNOWN`)이고 `kis_order_no`가 있는 행을 처리한다. ⓐ **오늘(거래일) 접수한 주문은 건드리지 않는다** — 체결 대기 중일 수 있고, 하루 1회 매수 가드와 맞물려 "오늘 낸 주문을 취소하고 재주문도 안 함"이 되는 것을 막는다. ⓑ KIS 미체결 목록에 더 이상 없는 주문은 취소하지 않고 `refreshOrder`로 실제 체결 상태(`FILLED` 등)로 갱신한다. ⓒ 이전 거래일의 미체결 주문만 KIS 정정취소(국내 `TTTC0013U`, 해외 `TTTT1004U`)로 취소하고 로컬을 `CANCELED`로 마킹한다. 사용자가 HTS/MTS로 직접 만든 주문은 절대 건드리지 않는다. DRY_RUN 모드는 수행하지 않는다.
5. 자동 취소 후 미체결을 재조회.
6. `autoTradingSafetyGuard.validateOrderSafety`로 안전 검증:
   - 전략이 RUNNING 상태인가
   - 결정이 BUY 또는 SELL인가 (HOLD/SKIP은 통과 없이 noOrder)
   - `expectedQuantity > 0`
   - 미체결 주문이 없음
   - 동일 `idempotency_key` 중복 없음 (`auto_trading_orders.idempotency_key` UNIQUE)
   - BUY: 매수가능금액 ≥ 예상 금액
   - SELL: 보유 수량 ≥ 예상 수량
   - 실주문 + 해외 BUY + `expectedQuantity < 1` → 차단 (KIS 표준 해외주문은 정수 주만 지원; 이상치 방어용. 엔진이 정수 주만 의도로 만들어 실제로는 거의 발동하지 않음)
   - SafetyGuard는 `intents` 배열의 각 intent를 독립 평가한다. 한 intent의 SKIP이 다른 intent를 차단하지 않는다.
   - SafetyGuard가 막은 intent는 `FAILED` 주문 row로 기록하되, **같은 `idempotency_key` 주문이 이미 있으면 row를 새로 만들지 않는다**(UNIQUE 충돌 방지). 판단 로그로만 남는다.
7. 분기:
   - `liveOrderEnabled = false` → 각 intent를 `auto_trading_orders` row로 `DRY_RUN` 상태 저장.
   - `liveOrderEnabled = true` → intent를 평단가(`AVG`) → 큰수(`BIG`) 순으로 직렬 접수. KIS 매수/매도 주문 API 호출, 응답에 따라 `REQUESTED` → `ACCEPTED` / `PARTIALLY_FILLED` / `FILLED` / `REJECTED` / `FAILED` / `UNKNOWN`. 같은 평가의 모든 주문은 동일 `decision_log_id`로 묶인다. 해외 주문 단가는 호가 소수 자릿수(1달러 이상 2자리, 미만 4자리)로 정규화해 전송한다.
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

## 멱등성·중복 방지·재시도

`{YYYYMMDD}-{strategyId}-{half}` 형식의 멱등키를 쓴다 (`half`는 `FIRST`/`AVG`/`BIG`/`SELL`). 날짜가 곧 회차이므로 같은 날 같은 슬롯은 하나의 키를 공유한다. `auto_trading_orders.idempotency_key`에는 UNIQUE 제약이 없고, 중복 방지는 코드에서 한다 — 같은 키로 **`FAILED`가 아닌** 주문(접수/체결 등)이 있으면 이미 처리된 것으로 보고 새 주문을 만들지 않는다(`hasNonFailedOrder`).

주문이 실패(`FAILED`)하면 그 키로는 아직 매수/매도가 안 된 것으로 보고 다음 tick에서 다시 시도한다. 같은 키의 `FAILED` 누적이 한도(`ORDER_RETRY_LIMIT`, 5회)에 이르면 더 시도하지 않는다(`countFailedOrders`). SafetyGuard가 막은 경우(미체결 대기 등)는 주문 행을 만들지 않고 다음 tick에 다시 본다.

## 큰수 매수 여유율

`auto_trading_strategies.big_buy_premium_rate` (`migrations/0020`). 값이 NULL이면 분할 회차와 무관하게 기본 `0.1`(10%), 값이 있으면 사용자 override로 그대로 사용 (`resolveBigBuyPremiumRate`, `buyAlgorithm.js`). 큰수 매수 지정가 = 평단가 × (1 + rate).

## 회차 진행 (1 회차 = 1 거래일)

`auto_trading_strategies.round_trade_date` (`migrations/0026`)에 현재 회차의 거래일을 저장한다. 매수가 접수되면, 그 거래일이 `round_trade_date`와 다를 때만 `current_round`를 +1 한다(`split_count` 상한). 즉 회차는 거래일당 한 번만 진행하고, 같은 날 두 번째 슬롯(예: 큰수 매수 후 평단가 매수) 매수는 회차를 올리지 않는다. 미체결 예산을 다음 회차로 이월하지 않는다(`pending_avg_budget`/`pending_big_budget` 컬럼은 남아 있으나 사용하지 않음).

## 사이클과 회차 소진

`auto_trading_strategies.cycle_budget` (`migrations/0022`, REAL). 현 사이클의 예산이며 회차 예산 = `cycle_budget / split_count`. 전략 생성 시 `total_budget`으로 채운다.

- **목표 매도**: 현재가 ≥ `평단가 × (1 + 목표 수익률)`이면 보유 전량 매도.
- **회차 소진 매도**: `current_round ≥ split_count`이고 매수가능금액이 회차 예산보다 적으면 보유 수량의 약 1/4(`ceil(holdingQuantity / 4)`)을 현재가에 매도.
- 두 매도 모두 접수되면 사이클을 재시작한다: `current_round`를 0으로, `round_trade_date`를 비우고, 그 시점 총자산(`매수가능금액 + 보유수량 × 현재가`)을 새 `cycle_budget`으로 저장한다(복리). 매도가 접수되지 않으면 사이클을 그대로 유지한다.

## 한국 국장 상승률 랭킹 전략 (`KR_RANK_MOMENTUM`)

자동매매 도메인은 라오어 무한매수법 외에 한국 국장 상승률 랭킹 전략을 두 번째 독립 전략 종류로 함께 운용한다. 두 전략 종류는 각자의 테이블(`kr_rank_*`)·엔진(`krRankStrategyEngine`/`krRankService`)·평가 경로를 가지며, 실주문 실행 설정(`user_trading_settings.live_order_enabled`)·스케줄러(`autoTradingScheduler`)·KIS 연동(`kisAuthService`/`kisTradingService`)을 공유한다. 라오어 전략의 평가 사이클·상태 머신·기록은 이 전략 추가로 변경되지 않는다. 상세 동작은 `kr-rank-auto-trading` 스펙을 참고한다.

## 미국장 상승률 랭킹 전략 (`US_RANK_MOMENTUM`)

미국장 상승률 랭킹 전략은 세 번째 독립 전략 종류다. `us_rank_*` 테이블·`usRankStrategyEngine`·`usRankService`·`usRankRoutes`·프론트 패널을 별도로 사용하고, 실주문 실행 설정·KIS credential·스케줄러 프로세스만 공유한다.

- KIS 해외주식 상승율/하락율 API(`/uapi/overseas-stock/v1/ranking/updown-rate`, TR `HHDFS76290000`)로 NASDAQ/NYSE/AMEX 상승률 랭킹을 조회한다.
- 서버는 미국 정규장(ET 09:30~16:00) 동안 1분 간격으로 RUNNING 전략을 평가한다. 시간 판정은 `Intl.DateTimeFormat('America/New_York')` 기반이라 DST를 OS tz 데이터에 위임한다.
- 보유 종목이 없으면 상승률 랭킹의 첫 유효 종목을 선택해 한 매매 사이클을 시작한다. 미국장은 한국장처럼 가격제한폭이 없어 별도 등락률 상한을 두지 않는다.
- 자동 예산 모드는 평가 시점 미국 종목 매수가능금액 전액을, 고정 예산 모드는 사용자 입력 USD 금액과 매수가능금액 중 작은 값을 사용한다. 주문 수량은 정수 1주 단위다.
- 보유 중에는 새 종목을 사지 않고 익절(기본 +2%), 손절(기본 -5%), 강제 청산(KST 기본 04:30)을 평가한다.
- 익절 조건에 닿아도 보유 종목이 지금도 랭킹 1위이면 매도를 보류한다. 1위에서 밀린 뒤 익절 조건을 만족하면 전량 매도하고, 다음 tick에서 새 랭킹 후보로 다음 매매 사이클을 시작할 수 있다.
- 손절 또는 강제 청산 후에는 `day_locked_out`을 걸어 같은 미국 거래일 신규 매수를 중단한다.
- `cycle_target_profit_rate`가 설정되어 있고 현재 평가 자산이 시작 기준 자본(`cycle_baseline_usd`) 대비 목표 수익률에 닿으면 `CYCLE_COMPLETE` 매도로 보유분을 정리하고 전략을 `STOPPED`로 종료한다.
- 실주문 실행 설정이 꺼져 있으면 실제 KIS 주문 호출 없이 주문 예정 기록만 `DRY_RUN`으로 저장한다. 켜져 있으면 현재가 지정가 주문으로 KIS 해외 주문 경로를 호출한다.

## 분할회차 cap

전략 생성 시 종목 현재가 기준 최대 분할회차 = `floor(totalBudget / (referencePrice × 2))` (한 회차의 절반이 최소 1주 가격 이상이 되도록). 프론트엔드 입력 박스가 이 값으로 클램프하고, 백엔드 `autoTradingService.normalizeStrategyInput`도 `referencePrice`가 전달되면 검증해 초과 시 400.
