# Tasks: Infinite Buying Strategy Assistant MVP

**Input**: `/home/hyerin/speckit/infinite-buying/specs/001-virtual-trade-mvp/plan.md`
**Scope**: Fast MVP, 9 implementation tasks maximum
**Rules**: No real orders, no Kiwoom order API, no automatic trading, no login, no deployment. Use `LF` line endings only.

## Tasks

- [X] T001 Create the React/Node project skeleton in `/home/hyerin/speckit/infinite-buying/backend/package.json`, `/home/hyerin/speckit/infinite-buying/backend/src/app.js`, `/home/hyerin/speckit/infinite-buying/backend/src/server.js`, `/home/hyerin/speckit/infinite-buying/frontend/package.json`, `/home/hyerin/speckit/infinite-buying/frontend/index.html`, and `/home/hyerin/speckit/infinite-buying/frontend/src/main.jsx`
  - 목적: Backend/Frontend를 즉시 실행 가능한 최소 구조로 만든다.
  - 수정 파일: `backend/package.json`, `backend/src/app.js`, `backend/src/server.js`, `frontend/package.json`, `frontend/index.html`, `frontend/src/main.jsx`, `frontend/src/App.jsx`, `frontend/src/styles.css`
  - 완료 조건: `backend`와 `frontend`가 각각 npm scripts를 가지고, 빈 화면/헬스체크 수준으로 로컬 실행 가능하다.

- [X] T002 Add SQLite schema and initialization in `/home/hyerin/speckit/infinite-buying/backend/src/db/schema.sql`, `/home/hyerin/speckit/infinite-buying/backend/src/db/connection.js`, and `/home/hyerin/speckit/infinite-buying/backend/src/db/migrate.js`
  - 목적: Strategy, Holding, VirtualOrder, DecisionLog, MarketPriceCache 저장 기반을 만든다.
  - 수정 파일: `backend/src/db/schema.sql`, `backend/src/db/connection.js`, `backend/src/db/migrate.js`, `backend/data/.gitkeep`, `backend/.env.example`
  - 완료 조건: `npm run migrate`가 SQLite DB를 만들고, 같은 전략/날짜/회차 BUY 중복 방지 인덱스가 생성된다.

- [X] T003 [P] Add `MarketDataProvider` interface and provider selection in `/home/hyerin/speckit/infinite-buying/backend/src/market-data/MarketDataProvider.js` and `/home/hyerin/speckit/infinite-buying/backend/src/market-data/index.js`
  - 목적: 키움 연동을 같은 인터페이스 뒤로 숨긴다.
  - 수정 파일: `backend/src/market-data/MarketDataProvider.js`, `backend/src/market-data/index.js`, `backend/src/config/env.js`, `backend/src/services/marketDataService.js`
  - 완료 조건: `MARKET_DATA_PROVIDER=kiwoom` 설정으로 provider가 선택되고, 키움 인증정보가 없으면 시장 데이터 조회는 실패하되 수동 현재가 입력 fallback은 유지된다.

- [X] T004 [P] Implement read-only market data provider in `/home/hyerin/speckit/infinite-buying/backend/src/market-data/KiwoomMarketDataProvider.js`
  - 목적: 키움 REST API는 현재가/일봉 조회까지만 연결한다.
  - 수정 파일: `backend/src/market-data/KiwoomMarketDataProvider.js`, `backend/src/routes/marketRoutes.js`, `backend/src/app.js`
  - 완료 조건: `GET /api/market/:stockCode/price`와 `GET /api/market/:stockCode/daily`가 키움 read-only 데이터로 동작하며, Kiwoom provider에는 주문 TR/주문 API 호출 코드가 없다.

- [X] T005 [P] Implement strategy calculation and tests in `/home/hyerin/speckit/infinite-buying/backend/src/services/strategyCalculator.js` and `/home/hyerin/speckit/infinite-buying/backend/tests/strategyCalculator.test.js`
  - 목적: BUY / SELL / HOLD / PAUSE 판단 규칙을 HTTP/DB와 분리해 검증한다.
  - 수정 파일: `backend/src/services/strategyCalculator.js`, `backend/tests/strategyCalculator.test.js`
  - 완료 조건: BUY, SELL, HOLD, PAUSE, 매수수량 0, 예산/회차 소진 케이스 테스트가 통과한다.

- [X] T006 [US1] Implement Strategy and Holding API in `/home/hyerin/speckit/infinite-buying/backend/src/routes/strategiesRoutes.js`
  - 목적: 전략 CRUD와 전략별 Holding 조회/초기화를 제공한다.
  - 수정 파일: `backend/src/repositories/strategiesRepository.js`, `backend/src/repositories/holdingsRepository.js`, `backend/src/services/strategiesService.js`, `backend/src/routes/strategiesRoutes.js`, `backend/src/app.js`
  - 완료 조건: `GET/POST/GET by id/PUT/DELETE /api/strategies`와 `GET /api/strategies/:id/holding`이 동작하고, 전략 생성 시 Holding이 함께 생성된다.

- [X] T007 [US1] [US3] Implement evaluate, DecisionLog, and VirtualOrder APIs in `/home/hyerin/speckit/infinite-buying/backend/src/services/virtualOrdersService.js`
  - 목적: 현재가 기반 evaluate 결과를 로그로 저장하고, 필요한 경우 가상 주문만 생성/체결/취소한다.
  - 수정 파일: `backend/src/repositories/virtualOrdersRepository.js`, `backend/src/repositories/decisionLogsRepository.js`, `backend/src/services/virtualOrdersService.js`, `backend/src/routes/ordersRoutes.js`, `backend/src/routes/strategiesRoutes.js`
  - 완료 조건: `POST /api/strategies/:id/evaluate`, `GET /api/strategies/:id/orders`, `POST /api/orders/:id/fill`, `POST /api/orders/:id/cancel`, `GET /api/strategies/:id/logs`가 동작하고 실주문 관련 필드/호출이 없다.

- [X] T008 [US1] [US2] [US3] Build React screens, manual price fallback, and chart in `/home/hyerin/speckit/infinite-buying/frontend/src/App.jsx`
  - 목적: 전략 생성부터 현재가 조회/수동입력/evaluate/차트/가상 주문 이력까지 한 화면 흐름으로 제공한다.
  - 수정 파일: `frontend/src/App.jsx`, `frontend/src/api/client.js`, `frontend/src/pages/StrategiesPage.jsx`, `frontend/src/pages/StrategyDetailPage.jsx`, `frontend/src/components/StrategyForm.jsx`, `frontend/src/components/HoldingPanel.jsx`, `frontend/src/components/EvaluationPanel.jsx`, `frontend/src/components/DailyChart.jsx`, `frontend/src/components/OrdersTable.jsx`, `frontend/src/styles.css`
  - 완료 조건: 사용자가 전략을 만들고, 키움 현재가를 조회하고, 실패 시 현재가를 수동 입력하고, evaluate 결과/차트/가상 주문 이력을 확인할 수 있다.

- [X] T009 Document MVP setup and safety constraints in `/home/hyerin/speckit/infinite-buying/README.md`
  - 목적: 실행 방법, 환경변수, 키움 read-only 제약, PR 흐름을 명확히 남긴다.
  - 수정 파일: `README.md`, `backend/.env.example`
  - 완료 조건: README에 backend/frontend 실행법, DB 초기화, Kiwoom 환경변수, 수동 입력 fallback, 실주문 금지, main 직접 push 금지가 포함된다.

## Dependencies

- T001 -> T002
- T002 -> T006, T007
- T003 -> T004
- T005 -> T007
- T006 + T007 + T004 -> T008
- T009 can be updated after T001 and finalized after T008

## Independent Test Criteria

- US1: 전략 생성 후 수동 또는 provider 현재가로 evaluate를 실행하면 DecisionLog가 저장되고, 조건에 따라 BUY / SELL / HOLD / PAUSE 결과가 나온다.
- US2: provider 실패 시 UI에서 현재가 수동 입력으로 evaluate를 계속할 수 있고, 일봉 차트는 provider 데이터가 있을 때 표시된다.
- US3: pending VirtualOrder를 fill/cancel하면 주문 상태와 Holding이 규칙대로 갱신되며, 같은 전략/날짜/회차 BUY 중복은 차단된다.

## Parallel Opportunities

- T003, T004, T005는 T001 이후 병렬 가능하다.
- T006과 T007은 DB schema가 준비된 뒤 일부 병렬 가능하지만, evaluate 통합은 T005 완료 후 진행한다.
- T008은 backend API 계약이 안정된 뒤 진행한다.
