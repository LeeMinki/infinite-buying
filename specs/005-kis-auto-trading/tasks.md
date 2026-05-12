# Tasks: KIS Auto Trading

**Input**: Design documents from `/specs/005-kis-auto-trading/`
**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts), [quickstart.md](./quickstart.md)

## Tasks

- [X] T001 Auto Trading DB schema 추가 in `backend/src/db/migrations/0017_auto_trading.sql`, `backend/src/db/migrations/0018_auto_trading_decision_extras.sql`, `backend/src/db/migrations/0019_position_snapshot_decision.sql`, `backend/src/db/schema.sql`
  - 목적: 자동매매 설정, 전략, 포지션, 주문, 판단 로그, 락, 일일 한도 사용량을 저장할 SQLite 스키마를 추가한다. 0018에서 판단 로그에 `target_sell_price`, `distance_to_target_rate`, `open_order_count`, `evaluation_source`, `order_id` 컬럼을 추가해 디버깅 가능성을 높인다.
  - 수정 파일: `backend/src/db/migrations/0017_auto_trading.sql`, `backend/src/db/migrations/0018_auto_trading_decision_extras.sql`, `backend/src/db/schema.sql`
  - 완료 조건: `user_trading_settings`, `user_trading_setting_histories`, `auto_trading_strategies`, `auto_trading_position_snapshots`, `auto_trading_orders`, `auto_trading_decision_logs`, `auto_trading_locks`, `daily_order_limit_usages`가 생성되고, 모든 테이블에 `user_id`가 있으며, 전략/주문/로그에는 `symbol`, `market`, `currency`가 저장되고, `auto_trading_orders.idempotency_key` unique와 필요한 userId/index가 포함된다. `auto_trading_decision_logs`에는 익절 목표가와 현재가 차이, 평가 출처, 미체결 수, 생성된 주문 id 컬럼이 함께 저장된다.

- [X] T002 KisTokenManager 구현 in `backend/src/services/kisTokenManager.js`, `backend/src/services/kisAuthService.js`, `backend/src/repositories/kisCredentialsRepository.js`
  - 목적: 자동매매와 scheduler가 사용자 웹 접속 없이도 저장된 KIS credential로 access token을 확보하고 만료/임박 만료 시 재발급할 수 있게 한다.
  - 수정 파일: `backend/src/services/kisTokenManager.js`, `backend/src/services/kisAuthService.js`, `backend/src/repositories/kisCredentialsRepository.js`, `backend/src/crypto/secretCipher.js`
  - 완료 조건: 현재 `userId` 기준 credential 조회, App Key/App Secret 복호화, token 발급, `tokenExpiresAt` 저장, 메모리/DB token 재사용, 만료 또는 만료 임박 시 재발급, 발급 실패 시 안전한 오류 반환, token 원문 frontend/log 비노출이 동작한다.

- [X] T003 User Trading Setting API 구현 in `backend/src/routes/autoTradingRoutes.js`, `backend/src/services/autoTradingService.js`, `backend/src/repositories/autoTradingRepository.js`
  - 목적: 사용자가 웹에서 실주문 실행 설정을 조회/변경하고 변경 이력을 남길 수 있게 한다.
  - 수정 파일: `backend/src/routes/autoTradingRoutes.js`, `backend/src/services/autoTradingService.js`, `backend/src/repositories/autoTradingRepository.js`, `backend/src/app.js`
  - 완료 조건: `GET /api/auto-trading/settings`, `PUT /api/auto-trading/settings/live-order`가 현재 `userId` 기준으로 동작하고, 기본값은 `liveOrderEnabled=false`이며, 변경 시 `user_trading_setting_histories`에 previous/new 값이 저장되고, dashboard와 strategy 상세에서 재사용 가능한 safe response를 반환한다. (구현 시 별도의 `userTradingSettingsService`/`userTradingSettingsRepository` 파일을 만드는 대신 한 도메인의 모든 auto-trading 모듈을 `autoTradingService.js`와 `autoTradingRepository.js`에 통합했다.)

- [X] T004 KisTradingService 확장 in `backend/src/services/kisTradingService.js`, `backend/src/market-data/KisMarketDataProvider.js`
  - 목적: 자동매매 평가와 주문에 필요한 KIS 현재가, 잔고, 매수가능금액, 미체결, 주문/체결, 매수/매도 주문 기능을 표준 응답으로 제공한다.
  - 수정 파일: `backend/src/services/kisTradingService.js`, `backend/src/market-data/KisMarketDataProvider.js`, `backend/src/config/env.js`, `backend/src/lib/logger.js`
  - 완료 조건: 선택 종목 현재가, 잔고, 매수가능금액, 미체결 주문, 주문/체결 내역, 매수 주문, 매도 주문이 국내/해외 차이를 service 내부에서 처리하고, KIS 응답이 표준 position/buyingPower/openOrders/orderResult 형태로 변환되며, request/response 저장용 payload는 민감정보가 마스킹된다. 해외 `buyingPower`는 `frcr_ord_psbl_amt1` 외에 `echm_af_ord_psbl_amt`(환전 후 매수가능금액), `echm_af_ord_psbl_qty`, `exrt`(환율)도 표준 응답에 함께 노출한다.
  - 추가 안전성: 같은 사용자에 대한 KIS 호출 사이에 최소 간격(기본 220ms)을 강제하고, `EGW00201`(초당 거래건수 초과)·EGW 계열·HTTP 429/5xx 같은 일시 오류는 400ms→900ms→1800ms backoff 로 최대 3회 재시도한다. 주문(POST) API는 재시도하지 않는다. 실패 메시지에는 `msg_cd` / `msg1` / HTTP status 가 함께 포함되어 원인 파악이 가능하다.

- [X] T005 StrategyEngine과 SafetyGuard 구현 in `backend/src/services/autoTradingStrategyEngine.js`, `backend/src/services/autoTradingSafetyGuard.js`
  - 목적: DB/HTTP/KIS에 의존하지 않는 자동매매 판단 함수와 실제 주문 전 안전 검증을 구현한다.
  - 수정 파일: `backend/src/services/autoTradingStrategyEngine.js`, `backend/src/services/autoTradingSafetyGuard.js`, `backend/src/domain/tradingMode.js`
  - 완료 조건: StrategyEngine이 입력값으로 BUY / SELL / HOLD / SKIP, `expectedQuantity`, `expectedOrderPrice`, `expectedAmount`, `reason`을 반환하고, SafetyGuard가 RUNNING 상태, `liveOrderEnabled=false` DRY_RUN 처리, `liveOrderEnabled=true` 실제 주문 가능 여부, 미체결 주문, 중복 주문, 매수가능금액, 보유수량, 주문 수량 0을 검증한다. **레거시 1회/일일 주문 한도(`maxOrderAmount`, `maxDailyOrderAmount`) 검사는 제거되었고 DB 컬럼은 0으로 채워 호환만 유지한다.** **국내(KR) 종목은 정수 주, 해외 종목은 소수점 6자리까지 매수 수량을 계산해 회차 예산이 한 주 가격보다 작아도 HOLD에 막히지 않는다. 실주문 모드에서 해외 BUY 수량이 1주 미만이면 SafetyGuard가 "KIS 표준 해외주문은 정수 주만 지원, 소수점매수 서비스 별도 연계 필요" 메시지로 차단한다. DRY_RUN은 소수점 그대로 기록한다.**

- [X] T006 AutoTradingService 구현 in `backend/src/services/autoTradingService.js`, `backend/src/repositories/autoTradingRepository.js`
  - 목적: 전략 시작/종료, 수동 평가, scheduled 평가, 스냅샷/로그/주문 저장, DRY_RUN/live order 분기를 한 서비스에서 처리한다.
  - 수정 파일: `backend/src/services/autoTradingService.js`, `backend/src/repositories/autoTradingRepository.js` (전략/스냅샷/판단로그/주문/일일사용량/락을 한 repo 모듈에서 함께 다룬다)
  - 완료 조건: start/stop/manual evaluate/scheduled evaluate가 동작하고, 평가 시 KIS token 확보, 현재가/잔고/매수가능금액/미체결 조회, position snapshot 저장, decision log 저장, `liveOrderEnabled=false` DRY_RUN order 저장, `liveOrderEnabled=true` 주문 실행 및 AutoTradingOrder 저장, 주문 실패 시 FAILED 저장, 자동 재시도 없음이 보장된다.

- [X] T007 Auto Trading Strategy API 구현 in `backend/src/routes/autoTradingRoutes.js`
  - 목적: 자동매매 전략 생성, 목록, 상세, 수정, 시작, 종료, 수동 평가 API를 제공한다.
  - 수정 파일: `backend/src/routes/autoTradingRoutes.js`, `backend/src/services/autoTradingService.js`, `backend/src/repositories/autoTradingStrategiesRepository.js`, `backend/src/app.js`
  - 완료 조건: `POST /api/auto-trading/strategies`, `GET /api/auto-trading/strategies`, `GET /api/auto-trading/strategies/:id`, `PUT /api/auto-trading/strategies/:id`, `POST /api/auto-trading/strategies/:id/start`, `POST /api/auto-trading/strategies/:id/stop`, `POST /api/auto-trading/strategies/:id/evaluate`가 현재 `userId` 기준으로만 접근 가능하고 다른 사용자 데이터 직접 요청은 404 또는 동등한 safe response를 반환한다.

- [X] T008 Orders / Decisions / Positions / Dashboard / AccountSummary API와 Scheduler 구현 in `backend/src/routes/autoTradingRoutes.js`, `backend/src/services/autoTradingScheduler.js`
  - 목적: 주문 조회/refresh, 전략별 주문·판단·포지션 조회, dashboard, 선택 전략 계좌 요약, RUNNING 전략 주기 평가를 제공한다.
  - 수정 파일: `backend/src/routes/autoTradingRoutes.js`, `backend/src/services/autoTradingScheduler.js`, `backend/src/repositories/autoTradingRepository.js`, `backend/src/server.js`
  - 완료 조건: `GET /api/auto-trading/orders`, `GET /api/auto-trading/orders/:id`, `POST /api/auto-trading/orders/:id/refresh`, `GET /api/auto-trading/strategies/:id/orders`, `GET /api/auto-trading/strategies/:id/decisions`, `GET /api/auto-trading/strategies/:id/positions`, `GET /api/auto-trading/dashboard`, `GET /api/auto-trading/account-summary?strategyId=:id`, `GET /api/auto-trading/buying-power-preview?market=:market&symbol=:symbol[&exchange=:exchange]`가 동작하고, scheduler가 RUNNING strategy만 strategy별 lock으로 평가하며, 장 운영 시간이 아니거나 불확실하면 SKIP을 기록하고, scheduler 오류는 격리된다. `getAccountSummary` 같이 한 화면에 여러 KIS 호출이 필요한 경우 `Promise.all` 대신 순차 await으로 호출해 rate limit burst를 줄인다.

- [X] T009 React Auto Trading UI 구현 in `frontend/src/pages/AutoTradingPage.jsx`, `frontend/src/api/client.js`
  - 목적: 사용자가 자동매매 상태를 보고 실주문 설정, 전략 생성/시작/종료/평가, 주문/판단/포지션 확인을 웹에서 수행할 수 있게 한다.
  - 수정 파일: `frontend/src/App.jsx`, `frontend/src/api/client.js`, `frontend/src/pages/AutoTradingPage.jsx`, `frontend/src/pages/StrategiesPage.jsx`, `frontend/src/styles.css`
  - 구현 메모: dashboard / 전략 폼 / 전략 상세를 별도 페이지로 분리하지 않고 단일 `AutoTradingPage.jsx`에 사이드 패널과 인라인 보조 컴포넌트(`Metric`, `AccountSummaryPanel`, `ForeignCurrencyGuide`, `BudgetHint`, `LatestPosition`, `DecisionLogTable`, `OrdersTable` 등)로 통합했다. `LiveOrderToggle`, `OrderHistoryTable`, `PositionSnapshotPanel`, `TradingDecisionLogTable`, `AutoTradingStatusBadge` 같은 별도 컴포넌트 파일은 만들지 않는다.
  - 완료 조건: 자동매매 dashboard, 실주문 실행 설정 토글, 전략 생성 화면, 기존 종목 검색/선택 UI 재사용, 전략 목록/상세, 시작/종료/수동 evaluate 버튼, **전략 삭제(목록 행마다 삭제 버튼, RUNNING 전략은 추가 확인)**, 실주문 설정 상태, 현재가/보유수량/평균단가/현금/평가금액, 주문 이력, **판단 로그(시간·판단·평가 출처·현재가·평단가·목표가·목표가까지의 거리·예상 수량·예상 금액·미체결 수·연결된 주문 ID·사유 컬럼을 모두 노출하고, 위에 `SCHEDULED`/`MANUAL` 의미와 "목표가까지" 컬럼 해석법을 한 줄로 설명)**, **최근 포지션 스냅샷(섹션 제목을 "최근 포지션 스냅샷"으로 변경하고, 그 시점의 자동매매 판단을 BUY/SELL/HOLD/SKIP/ERROR/COMPLETED 배지로 헤더에 표시, "실시간 KIS 잔고가 아니라 마지막 평가 순간의 사진"이라는 짧은 설명도 추가)**, 위험 안내, **해외 종목(market ≠ KR) 전략에서 KRW↔외화 환전·통합증거금 안내(특정 외화명 하드코딩 없음)**가 표시된다. **계좌 요약은 실주문 모드 여부와 무관하게 항상 조회·표시**되며 표시 문구만 모드에 따라 바뀐다. 해외 계좌 요약에는 `cashAvailable` 외에 `cashAvailableAfterFx`(환전 후 매수가능금액)와 `exchangeRate`(환율)가 표시된다. **전략 생성 폼에서 종목을 선택하면 `GET /api/auto-trading/buying-power-preview`를 호출해 "현재 잔고로 가능 / 환전 후 가능" 단축 버튼으로 총 예산을 한 번에 채울 수 있고, 사용자가 직접 입력한 값은 절대 자동 덮어쓰지 않는다.** **전략 생성 폼에서 1회 주문 한도/일일 주문 한도 입력 필드는 제거되었고, 남은 필드들은 종목 검색 = 한 줄 전체, 총 예산·분할 회차·목표 수익률 = 한 줄, 제출 버튼 = 오른쪽 정렬로 깔끔하게 배치된다.** **자동매매 페이지는 전략 목록을 페이지 위에 가로 카드(칩) 그룹으로 깔고, 전략 상세는 다른 패널과 동일한 전체 가로 폭을 그대로 사용한다. 좌·우 2단 grid 는 사용하지 않는다. 좁은 뷰포트에서는 칩이 자동으로 줄바꿈된다.**

- [X] T010 테스트와 README 업데이트 in `backend/tests/autoTrading.test.js`, `README.md`
  - 목적: 자동매매의 토큰, 설정, 판단, 안전검증, DRY_RUN/live order 분기, 중복 차단, userId 격리, scheduler lock을 검증하고 사용 문서를 갱신한다.
  - 수정 파일: `backend/tests/autoTrading.test.js` (KisTokenManager / UserTradingSetting / StrategyEngine / SafetyGuard / DRY_RUN / live-order / duplicate / userId / scheduler lock 케이스를 한 파일에 통합), `backend/tests/kisCredentialAuth.test.js`, `README.md`
  - 완료 조건: KisTokenManager 만료/재발급, UserTradingSetting 토글, StrategyEngine, SafetyGuard, `liveOrderEnabled=false` DRY_RUN, `liveOrderEnabled=true` order mock, duplicate order 차단, userId scope, scheduler lock 테스트가 통과하고, README에 자동매매 사용법·실주문 실행 설정·DRY_RUN·위험 안내·secret/token/account 원문 비노출 정책이 추가된다.
