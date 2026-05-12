# Tasks: Migrate Kiwoom to KIS

**Input**: Design documents from `specs/004-migrate-kiwoom-to-kis/`
**Goal**: Replace the Kiwoom-centered implementation with a KIS Open API flow for domestic/overseas symbol lookup, price lookup, daily candle caching, and currency-aware OHLC backtesting.

## Phase 1: Foundation

- [X] T001 Configure KIS environment and safety flags
  - 목적: KIS API base URL, token timeout, encryption key, session secret, live/reserved order disable flags를 설정한다.
  - 수정 파일: `backend/src/config/env.js`, `backend/.env.example`, `infra/kubernetes/infinite-buying/base/configmap.yaml`
  - 완료 조건: `KIS_API_BASE_URL`, `KIS_TIMEOUT_MS`, `ENABLE_LIVE_ORDER=false`, `ENABLE_RESERVED_ORDER=false`가 사용된다.

- [X] T002 Add KIS database schema
  - 목적: 사용자별 KIS credential, market/currency-aware daily candle cache, backtest run/trade 저장 구조를 추가한다.
  - 수정 파일: `backend/src/db/schema.sql`, `backend/src/db/migrations/0012_kis_credentials.sql`, `backend/src/db/migrations/0013_market_cache_us_symbol.sql`, `backend/src/db/migrations/0014_backtest_us_symbol.sql`
  - 완료 조건: cache unique key는 `(user_id, market, symbol, date)`이고 모든 테이블은 `user_id`를 포함한다.

## Phase 2: KIS Credentials

- [X] T003 Implement KIS settings API
  - 목적: 로그인한 사용자의 KIS App Key/App Secret을 암호화 저장하고 안전하게 조회/삭제한다.
  - 수정 파일: `backend/src/repositories/kisCredentialsRepository.js`, `backend/src/services/kisCredentialService.js`, `backend/src/routes/kisSettingsRoutes.js`, `backend/src/app.js`
  - 완료 조건: `/api/settings/kis` GET/POST/DELETE가 동작하고 secret/token 원문은 응답하지 않는다.

- [X] T004 Implement KIS access token service
  - 목적: 저장된 KIS credential로 access token을 발급, 암호화 저장, 재사용하고 연결 테스트를 제공한다.
  - 수정 파일: `backend/src/services/kisAuthService.js`, `backend/src/routes/kisSettingsRoutes.js`
  - 완료 조건: `/api/settings/kis/test`가 safe success/failure response를 반환한다.

## Phase 3: KIS Market Data

- [X] T005 Implement KIS market data provider
  - 목적: KIS 국내/해외 현재가, 일봉, 종목 기본정보 응답을 앱 표준 형식으로 변환한다.
  - 수정 파일: `backend/src/market-data/KisMarketDataProvider.js`, `backend/src/services/marketDataService.js`
  - 완료 조건: current price와 daily candle 응답에 `symbol`, `market`, `currency`, `source='KIS_API'`가 포함된다.

- [X] T006 Implement market API and cache upsert
  - 목적: `/api/market/stocks/search`, `/api/market/:market/:symbol/price`, `/api/market/:market/:symbol/daily`를 제공하고 daily rows를 user-scoped cache에 저장한다.
  - 수정 파일: `backend/src/routes/marketRoutes.js`, `backend/src/repositories/marketPriceCacheRepository.js`
  - 완료 조건: 다른 사용자의 cache row를 반환하지 않는다.

## Phase 4: Backtest

- [X] T007 Convert backtest to symbol/market/currency flow
  - 목적: 백테스트 실행 시 KIS daily candles를 확보하고 `LAOR_INFINITE_V2` 규칙으로 open/high/close 기준 계산한다.
  - 수정 파일: `backend/src/services/backtestService.js`, `backend/src/repositories/backtestRunsRepository.js`, `backend/src/repositories/backtestTradesRepository.js`, `backend/src/execution/BacktestExecutionProvider.js`
  - 완료 조건: `POST /api/backtests`가 `symbol=TQQQ`와 `symbol=005930` 입력을 처리하고 currency-aware summary/trades를 저장한다.

## Phase 5: Frontend

- [X] T008 Build KIS setup and backtest UI
  - 목적: KIS 설정 화면과 종목 검색 기반 백테스트 화면을 제공한다.
  - 수정 파일: `frontend/src/pages/KisSetupPage.jsx`, `frontend/src/pages/BacktestPage.jsx`, `frontend/src/pages/StrategiesPage.jsx`, `frontend/src/api/client.js`, `frontend/src/components/*.jsx`
  - 완료 조건: KIS App Key/App Secret 저장, 연결 테스트, 종목 검색, TQQQ/USD와 국내/KRW display가 가능하다.

## Final Phase: Validation & Documentation

- [X] T009 Add tests and documentation
  - 목적: KIS credential/auth/market/backtest/user isolation을 검증하고 README를 KIS 기준으로 작성한다.
  - 수정 파일: `backend/tests/*.test.js`, `README.md`, `AGENTS.md`, `specs/004-migrate-kiwoom-to-kis/*.md`
  - 완료 조건: `npm test`, `npm run build`, `npm run dev`가 실행 가능하고 실주문/예약주문 API가 없다.
