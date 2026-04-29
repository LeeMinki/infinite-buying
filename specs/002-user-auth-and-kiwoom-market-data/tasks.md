# Tasks: Multi-User Auth and Per-User Kiwoom Market Data

**Input**: Design documents from `/home/hyerin/speckit/infinite-buying/specs/002-user-auth-and-kiwoom-market-data/`
**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)
**Goal**: 빠른 MVP 구현. 보안, 사용자별 데이터 분리, Kiwoom read-only market data만 허용한다.

## Phase 1: Setup (Shared Infrastructure)

- [X] T001 환경변수/의존성/시작 검증을 추가한다 in `backend/package.json`, `backend/src/config/env.js`, `backend/src/server.js`, `backend/.env.example`, `infra/kubernetes/infinite-buying/base/configmap.yaml`
  - 목적: `EC2_ELASTIC_IP`, `KIWOOM_API_BASE_URL`, `KIWOOM_MOCK_API_BASE_URL`, `SECRET_ENCRYPTION_KEY`, `SESSION_SECRET`, `ENABLE_LIVE_ORDER=false`를 앱의 필수 설정으로 만든다.
  - 수정 파일: `backend/package.json`, `backend/package-lock.json`, `backend/src/config/env.js`, `backend/src/server.js`, `backend/.env.example`, `infra/kubernetes/infinite-buying/base/configmap.yaml`
  - 완료 조건: bcrypt/session 의존성이 설치되고, 필수 env 누락/약한 encryption key/`ENABLE_LIVE_ORDER !== false`면 backend가 시작하지 않으며, Kiwoom 주문 API 설정은 추가되지 않는다.

## Phase 2: Foundational (Blocking Prerequisites)

- [X] T002 DB 마이그레이션 기반과 auth/user/Kiwoom/cache schema를 추가한다 in `backend/src/db/migrate.js`, `backend/src/db/migrations/*.sql`
  - 목적: `users`, 필요한 session 저장소, 기존 테이블의 `user_id`, `kiwoom_credentials`, user-scoped `market_price_cache`를 생성/전환한다.
  - 수정 파일: `backend/src/db/migrate.js`, `backend/src/db/schema.sql`, `backend/src/db/migrations/0001_users.sql`, `backend/src/db/migrations/0002_userid_on_existing.sql`, `backend/src/db/migrations/0003_kiwoom_credentials.sql`, `backend/src/db/migrations/0004_market_price_cache_userid.sql`
  - 완료 조건: `users.email`은 case-insensitive unique이고 password hash만 저장되며, `strategies/holdings/virtual_orders/decision_logs`는 `user_id`로 소유자가 생기고, 기존 데이터는 `SEED_OWNER_USER_ID` 없이는 조용히 default owner로 넘어가지 않으며, `market_price_cache`는 `(user_id, stock_code, date)` unique를 가진다.

- [X] T003 암호화/마스킹/로그 redaction 유틸을 구현한다 in `backend/src/crypto/*.js`, `backend/src/lib/logger.js`
  - 목적: Secret Key/App Key/access token을 backend에서만 복호화하고, 응답/로그에는 평문 secret/token/password가 나오지 않게 한다.
  - 수정 파일: `backend/src/crypto/secretCipher.js`, `backend/src/crypto/mask.js`, `backend/src/lib/logger.js`, `backend/tests/secretCipher.test.js`
  - 완료 조건: `encryptSecret`, `decryptSecret`, `maskAppKey`가 구현되고, AES-256-GCM은 base64 32-byte `SECRET_ENCRYPTION_KEY`만 허용하며, password/Secret Key/access token/App Key 원문을 로깅하지 않는 테스트가 통과한다.

## Phase 3: User Story 1 - Sign Up, Sign In, and Keep Each User's Data Private (Priority: P1) MVP

**Independent Test**: 두 사용자를 가입/로그인시키고, 각자의 전략만 보이며 다른 사용자의 strategy/holding/order/log 직접 접근이 404로 막히는지 확인한다. 로그아웃 후 보호 API는 401이어야 한다.

- [X] T004 [US1] 회원가입/로그인/로그아웃/me API와 인증 middleware를 구현한다 in `backend/src/auth/*.js`, `backend/src/routes/authRoutes.js`, `backend/src/app.js`
  - 목적: email/password 회원가입, bcrypt hash/verify, httpOnly session cookie, 보호 API용 `requireAuth`를 제공한다.
  - 수정 파일: `backend/src/auth/passwordHasher.js`, `backend/src/auth/sessionStore.js`, `backend/src/auth/authMiddleware.js`, `backend/src/auth/authService.js`, `backend/src/repositories/usersRepository.js`, `backend/src/routes/authRoutes.js`, `backend/src/app.js`, `backend/tests/auth.test.js`
  - 완료 조건: `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`가 contract대로 동작하고, password 평문은 DB/응답/로그에 없으며, 로그인 실패는 이메일 존재 여부를 노출하지 않는다.

- [X] T005 [US1] 기존 전략/보유/가상주문/판단로그 API를 현재 session userId 기준으로 제한한다 in `backend/src/repositories/*.js`, `backend/src/routes/*.js`
  - 목적: `DEFAULT_USER_ID` 없이 모든 기존 데이터 접근을 현재 로그인 userId로 제한하고 cross-user 접근을 차단한다.
  - 수정 파일: `backend/src/repositories/strategiesRepository.js`, `backend/src/repositories/holdingsRepository.js`, `backend/src/repositories/virtualOrdersRepository.js`, `backend/src/repositories/decisionLogsRepository.js`, `backend/src/services/strategiesService.js`, `backend/src/services/virtualOrdersService.js`, `backend/src/routes/strategiesRoutes.js`, `backend/src/routes/ordersRoutes.js`, `backend/tests/crossUserIsolation.test.js`
  - 완료 조건: 모든 strategy/holding/order/log read/create/update/delete/evaluate/fill/cancel 경로가 `req.userId`를 사용하고, client-supplied `userId`는 무시되며, 다른 사용자 데이터 직접 접근은 404이고, cross-user 차단 테스트가 통과한다.

## Phase 4: User Story 2 - Configure Personal Kiwoom REST API Credentials with IP Guidance (Priority: P2)

**Independent Test**: 로그인 사용자가 Kiwoom Setup에서 EC2 Elastic IP 안내를 보고 credential을 저장/조회/삭제하며, App Key는 masked만 보이고 Secret Key/access token은 어디에도 반환되지 않는다.

- [X] T006 [US2] 사용자별 Kiwoom credential 저장/조회/삭제 API를 구현한다 in `backend/src/routes/kiwoomSettingsRoutes.js`, `backend/src/services/kiwoomCredentialService.js`
  - 목적: 현재 userId 기준으로 App Key/Secret Key/environment를 저장하고, App Key masked/status/EC2 Elastic IP만 frontend에 제공한다.
  - 수정 파일: `backend/src/repositories/kiwoomCredentialsRepository.js`, `backend/src/services/kiwoomCredentialService.js`, `backend/src/routes/kiwoomSettingsRoutes.js`, `backend/src/app.js`, `backend/tests/kiwoomCredential.test.js`
  - 완료 조건: `GET /api/settings/kiwoom`, `POST /api/settings/kiwoom`, `DELETE /api/settings/kiwoom`이 동작하고, Secret Key/access token/plain App Key는 응답/로그에 없으며, credential과 status는 userId별로 분리된다.

- [X] T007 [US2] KiwoomAuthService와 연결 테스트 API를 구현한다 in `backend/src/services/kiwoomAuthService.js`, `backend/src/routes/kiwoomSettingsRoutes.js`
  - 목적: 저장된 user별 App Key/Secret Key로 access token을 발급/암호화 저장/캐시하고, 만료 또는 Kiwoom token rejection 시 한 번 재발급한다.
  - 수정 파일: `backend/src/services/kiwoomAuthService.js`, `backend/src/services/kiwoomCredentialService.js`, `backend/src/repositories/kiwoomCredentialsRepository.js`, `backend/src/routes/kiwoomSettingsRoutes.js`, `backend/tests/kiwoomAuthService.test.js`
  - 완료 조건: `POST /api/settings/kiwoom/test`가 token 성공 시 `TOKEN_VALID`만 반환하고 token 평문은 반환하지 않으며, 실패 시 `EC2 Elastic IP` 등록 안내와 실제 IP를 포함한 sanitized message를 반환하고, 사용자 PC IP가 아니라 backend EC2 IP를 등록해야 한다는 안내가 유지된다.

## Phase 5: User Story 3 - Look Up Live Price and Daily Chart Through the Backend (Priority: P3)

**Independent Test**: Kiwoom credential이 있는 사용자로 `005930` 현재가와 일봉을 조회하고, 첫 일봉 요청은 Kiwoom/cache write, 두 번째 요청은 cache hit가 되며, credential 실패 시 수동 현재가 입력으로 평가를 계속할 수 있다.

- [X] T008 [US3] Kiwoom market data provider와 Market API를 userId 기반으로 구현한다 in `backend/src/market-data/KiwoomMarketDataProvider.js`, `backend/src/routes/marketRoutes.js`
  - 목적: frontend가 Kiwoom을 직접 호출하지 않고 backend가 user credential/token으로 현재가와 일봉을 조회해 표준 응답으로 변환한다.
  - 수정 파일: `backend/src/market-data/KiwoomMarketDataProvider.js`, `backend/src/market-data/index.js`, `backend/src/services/marketDataService.js`, `backend/src/repositories/marketPriceCacheRepository.js`, `backend/src/routes/marketRoutes.js`, `backend/tests/marketRoutes.test.js`
  - 완료 조건: `GET /api/market/:stockCode/price`와 `GET /api/market/:stockCode/daily?from=YYYY-MM-DD&to=YYYY-MM-DD`가 auth 필요/userId scoped로 동작하고, 일봉은 `(user_id, stock_code, date)` upsert/cache source를 반환하며, Secret Key/access token은 응답/로그에 없다.

- [X] T009 [US1] [US2] [US3] React 인증/키움설정/시장데이터 UI를 구현한다 in `frontend/src/App.jsx`, `frontend/src/auth/*.jsx`, `frontend/src/pages/*.jsx`, `frontend/src/components/*.jsx`
  - 목적: 회원가입/로그인/로그아웃, Kiwoom Setup, EC2 Elastic IP 안내, 현재가 조회, 일봉 차트를 MVP 화면으로 제공한다.
  - 수정 파일: `frontend/src/api/client.js`, `frontend/src/App.jsx`, `frontend/src/auth/AuthContext.jsx`, `frontend/src/auth/LoginPage.jsx`, `frontend/src/auth/RegisterPage.jsx`, `frontend/src/pages/KiwoomSetupPage.jsx`, `frontend/src/pages/StrategiesPage.jsx`, `frontend/src/pages/StrategyDetailPage.jsx`, `frontend/src/components/EvaluationPanel.jsx`, `frontend/src/components/DailyChart.jsx`, `frontend/src/styles.css`
  - 완료 조건: 보호 화면은 로그인 전 접근 불가이고, Setup 페이지는 등록해야 하는 IP가 브라우저 PC IP가 아니라 EC2 Elastic IP임을 명확히 안내하며, App Key는 masked만 표시되고, 현재가 조회 실패 시 기존 수동 입력 fallback으로 평가 실행이 가능하다.

## Final Phase: Validation & Deployment Readiness

- [X] T010 전체 MVP 보안/회귀 검증을 수행하고 누락을 보완한다 in `backend/tests/*.test.js`, `frontend/dist/`, `specs/002-user-auth-and-kiwoom-market-data/quickstart.md`
  - 목적: 빠른 MVP가 깨지지 않게 auth, user isolation, secret 노출 방지, Kiwoom mock, manual fallback, 주문 API 부재를 한 번에 검증한다.
  - 수정 파일: `backend/tests/auth.test.js`, `backend/tests/crossUserIsolation.test.js`, `backend/tests/kiwoomCredential.test.js`, `backend/tests/kiwoomAuthService.test.js`, `backend/tests/marketRoutes.test.js`, `frontend/dist/`, `specs/002-user-auth-and-kiwoom-market-data/quickstart.md`
  - 완료 조건: `npm test`, `npm run build`, frontend bundle secret grep, route inventory check가 통과하고, backend route table에 Kiwoom 주문 API나 실주문 endpoint가 없으며, 이메일 인증/비밀번호 찾기/소셜 로그인/백테스트/실주문은 구현되지 않는다.

- [X] T011 전략 생성 폼에 종목 검색 dropdown과 키움 예수금 불러오기를 추가한다 in `backend/src/routes/marketRoutes.js`, `backend/src/routes/accountRoutes.js`, `frontend/src/components/StrategyForm.jsx`
  - 목적: 사용자가 종목코드/종목명을 직접 따로 입력하지 않고 검색 결과를 선택하게 하며, read-only 계좌 예수금/주문가능금액을 총 투자금 입력값으로 가져올 수 있게 한다.
  - 수정 파일: `backend/src/market-data/MarketDataProvider.js`, `backend/src/market-data/KiwoomMarketDataProvider.js`, `backend/src/market-data/MockMarketDataProvider.js`, `backend/src/market-data/index.js`, `backend/src/services/marketDataService.js`, `backend/src/routes/marketRoutes.js`, `backend/src/routes/accountRoutes.js`, `backend/src/app.js`, `frontend/src/api/client.js`, `frontend/src/components/StrategyForm.jsx`, `frontend/src/styles.css`
  - 완료 조건: `GET /api/market/stocks/search?q=...`와 `GET /api/account/deposit`이 auth 필요/userId scoped로 동작하고, 전략 생성 UI는 검색 결과 선택을 요구하며, Mock 환경에서는 외부 mock endpoint 404 대신 앱 내부 mock 종목/예수금 데이터를 반환한다.

- [X] T012 Argo CD poll 기반 GitOps 동기화 지연 설정을 문서화하고 클러스터에 반영한다 in `infra/kubernetes/argocd/*.yaml`
  - 목적: GitHub webhook 없는 Argo CD core 설치에서 GitOps image tag commit 감지 지연을 줄이고, hard refresh에 의존하지 않는 운영 절차를 남긴다.
  - 수정 파일: `infra/kubernetes/argocd/README.md`, `infra/kubernetes/argocd/runtime-tuning.yaml`
  - 완료 조건: `timeout.reconciliation=30s`, `timeout.reconciliation.jitter=5s`, `reposerver.repo.cache.expiration=30s`, `controller.app.state.cache.expiration=30s` 설정이 문서화되고, 설정 변경 시 `argocd-application-controller`와 `argocd-repo-server` 재시작이 필요하다는 운영 메모가 남는다.

## Dependencies & Execution Order

### Phase Dependencies

- Phase 1 Setup: 바로 시작 가능.
- Phase 2 Foundation: T001 이후 진행. T002와 T003은 서로 다른 파일 중심이라 병렬 가능하지만 T004 이후 작업의 선행 조건이다.
- US1: T001-T003 이후 T004 → T005 순서.
- US2: T001-T004 이후 가능. T006 이후 T007.
- US3: T001-T007 이후 가능. T008 이후 T009의 시장 데이터 연결 부분 완료.
- 전략 생성 종목 검색/예수금 조회: T006-T008 이후 가능. 사용자 credential/environment 선택과 provider factory가 선행되어야 한다.
- Final: T004-T009 이후 T010.

### User Story Dependencies

- **US1 (P1)**: MVP 핵심. 인증과 기존 데이터 분리까지 완료되어야 공개 도메인에서 안전하다.
- **US2 (P2)**: US1 인증에 의존한다. credential은 반드시 현재 userId 기준으로 저장한다.
- **US3 (P3)**: US1 인증과 US2 credential/token에 의존한다. Kiwoom 실패 시 수동 입력 fallback은 독립적으로 유지한다.

## Parallel Opportunities

- T002(DB schema)와 T003(crypto/logger)은 T001 이후 서로 다른 영역이라 병렬 가능.
- T006(credential API) 구현 중 T009의 순수 auth shell UI 초안은 병렬 가능하지만, 실제 API wiring은 T006/T007 이후 해야 한다.
- T010의 bundle audit/route inventory는 backend tests와 병렬로 실행 가능하다.

## Implementation Strategy

1. **MVP first**: T001-T005를 먼저 완료해 회원가입/로그인과 사용자별 데이터 분리를 만든다.
2. **Credential slice**: T006-T007로 Kiwoom credential 저장과 연결 테스트를 만든다.
3. **Market data slice**: T008로 backend-only Kiwoom 현재가/일봉/cache를 만든다.
4. **UI slice**: T009로 auth, setup, strategy detail 연결을 완성한다.
5. **Strategy creation helpers**: T011로 종목 검색 dropdown과 예수금 불러오기를 붙인다.
6. **GitOps hardening**: T012로 Argo CD poll/cache 설정을 운영 문서와 클러스터에 반영한다.
7. **Validation**: T010으로 보안/회귀 검증 후 다음 단계(`/speckit-implement`)로 넘긴다.

## Deferred Specs

- 백테스트
- 백테스트 리포트
- paper trading hardening
- Kiwoom 실주문
