# Backend API

## 마운트

`backend/src/app.js`에서 마운트한다. 모든 보호 API는 `authMiddleware.requireAuth`를 거친 뒤 `req.userId`로 사용자 격리된다.

| Mount path | Router |
| --- | --- |
| `/api/auth` | `routes/authRoutes.js` |
| `/api/settings/kis` | `routes/kisSettingsRoutes.js` |
| `/api/strategies` | `routes/strategiesRoutes.js` |
| `/api/market` | `routes/marketRoutes.js` |
| `/api/orders` | `routes/ordersRoutes.js` |
| `/api/backtests` | `routes/backtestRoutes.js` |
| `/api/auto-trading` | `routes/autoTradingRoutes.js` |
| `/api/kr-rank` | `routes/krRankRoutes.js` |
| `/api/us-rank` | `routes/usRankRoutes.js` |
| `/api/health` | `app.js` 내 인라인 |

## Endpoint 일람

### 헬스

| Method | Path | 인증 | 설명 |
| --- | --- | --- | --- |
| GET | `/api/health` | 무 | `{ ok: true, enableLiveOrder: boolean }` |

### 인증 (`/api/auth`)

| Method | Path | 인증 | 설명 |
| --- | --- | --- | --- |
| POST | `/register` | 무 | 회원가입 + 세션 발급 |
| POST | `/login` | 무 | 로그인 + 세션 발급 |
| POST | `/logout` | 세션 | 세션 파기 |
| GET | `/me` | 필요 | 현재 사용자 |

### KIS 설정 (`/api/settings/kis`)

| Method | Path | 설명 |
| --- | --- | --- |
| GET | `/` | masked 설정 조회 |
| POST | `/` | 저장/업데이트 |
| DELETE | `/` | 삭제 |
| POST | `/test` | access token 발급 테스트 |

### 시장 데이터 (`/api/market`)

| Method | Path | 설명 |
| --- | --- | --- |
| GET | `/stocks/search?q=` | KIS 종목 검색 |
| GET | `/:market/:symbol/price?exchange=` | 현재가 (일반) |
| GET | `/:market/:symbol/daily?from=&to=&refresh=` | 일봉 (일반) |
| GET | `/us/:symbol/price` | 현재가 (US 단축) |
| GET | `/us/:symbol/daily` | 일봉 (US 단축) |

### 백테스트 (`/api/backtests`)

| Method | Path | 설명 |
| --- | --- | --- |
| POST | `/` | 새 백테스트 |
| GET | `/` | run 목록 |
| GET | `/:id` | run 요약 |
| GET | `/:id/trades` | 거래 이력 |
| DELETE | `/:id` | run 삭제 |

### 자동매매 (`/api/auto-trading`)

설정 & 대시보드:

| Method | Path | 설명 |
| --- | --- | --- |
| GET | `/settings` | 실주문 실행 설정 조회 |
| PUT | `/settings/live-order` | 실주문 토글 |
| GET | `/dashboard` | 대시보드 요약 |
| GET | `/account-summary?strategyId=` | 계좌 요약 (잔고, 매수가능금액, 환전 후, 환율) |
| GET | `/buying-power-preview?market=&symbol=&exchange=` | 전략 생성 시 "현재 가능 / 환전 후 가능" 미리보기 |

전략 CRUD & 평가:

| Method | Path | 설명 |
| --- | --- | --- |
| POST | `/strategies` | 자동매매 전략 생성 |
| GET | `/strategies` | 전략 목록 |
| GET | `/strategies/:id` | 전략 상세 |
| PUT | `/strategies/:id` | 전략 수정 |
| DELETE | `/strategies/:id` | 전략 삭제 |
| POST | `/strategies/:id/start` | 시작 → `RUNNING` |
| POST | `/strategies/:id/stop` | 종료 → `STOPPED` |
| POST | `/strategies/:id/evaluate` | 수동 평가 |
| GET | `/strategies/:id/orders` | 전략 주문 목록 |
| GET | `/strategies/:id/decisions` | 판단 로그 |
| GET | `/strategies/:id/positions` | 포지션 스냅샷 |

주문:

| Method | Path | 설명 |
| --- | --- | --- |
| GET | `/orders` | 전체 주문 |
| GET | `/orders/:id` | 단일 주문 |
| POST | `/orders/:id/refresh` | KIS 조회로 상태 갱신 |

### 한국 랭킹 자동매매 (`/api/kr-rank`)

| Method | Path | 설명 |
| --- | --- | --- |
| GET | `/overview` | 사용자 한국 랭킹 전략 요약 |
| GET/POST | `/strategies` | 전략 목록/생성 |
| GET/PUT/DELETE | `/strategies/:id` | 전략 상세/수정/soft delete |
| POST | `/strategies/:id/start` | 시작 |
| POST | `/strategies/:id/stop` | 종료 |
| POST | `/strategies/:id/evaluate` | 수동 평가 |
| POST | `/strategies/:id/sync-fills` | KIS 체결 조회로 주문/보유 상태 동기화 |
| GET | `/strategies/:id/orders` | 전략 주문 목록 |
| GET | `/strategies/:id/trade-history` | 매수·매도 연결 왕복 거래 이력 |
| POST | `/strategies/:id/trade-history/:buyOrderId/replay` | KIS 과거 분봉 기반 거래 복기 |
| GET | `/strategies/:id/decisions` | 판단 로그 |
| GET | `/strategies/:id/entries` | 진입 기록 |

### 미국 랭킹 자동매매 (`/api/us-rank`)

| Method | Path | 설명 |
| --- | --- | --- |
| GET | `/overview` | 사용자 미국 랭킹 전략 요약 |
| GET/POST | `/strategies` | 전략 목록/생성 |
| GET/PUT/DELETE | `/strategies/:id` | 전략 상세/수정/soft delete |
| POST | `/strategies/:id/start` | 시작 |
| POST | `/strategies/:id/stop` | 종료 |
| POST | `/strategies/:id/evaluate` | 수동 평가 |
| POST | `/strategies/:id/sync-fills` | KIS 체결 조회로 주문/보유 상태 동기화 |
| GET | `/strategies/:id/trades` | 매매 사이클 목록 |
| GET | `/strategies/:id/orders` | 전략 주문 목록 |
| GET | `/strategies/:id/trade-history` | 매수·매도 연결 왕복 거래 이력 |
| POST | `/strategies/:id/trade-history/:tradeId/replay` | KIS 과거 분봉 기반 거래 복기 |
| GET | `/strategies/:id/decisions` | 판단 로그 |

### (구) 가상 전략 (`/api/strategies`)

| Method | Path | 설명 |
| --- | --- | --- |
| GET | `/` | 사용자 전략 초안 목록 |
| POST | `/` | 전략 초안 생성 |
| GET/PUT/DELETE | `/:id` | 단일 전략 |
| GET | `/:id/holding` | 가상 보유 |
| POST | `/:id/evaluate` | 가상 평가 |
| GET | `/:id/orders` | 가상 주문 |
| GET | `/:id/logs` | 가상 평가 로그 |

### (구) 가상 주문 (`/api/orders`)

| Method | Path | 설명 |
| --- | --- | --- |
| POST | `/:id/fill` | 가상 체결 |
| POST | `/:id/cancel` | 가상 취소 |

## 오류 응답 규약

- 미인증: 401 (`authMiddleware`).
- 검증 실패: 400 (`backtestService.badRequest`, `autoTradingService.badRequest` 등 service 단에서 `error.status` 부여).
- 자원 미존재: 404 (`backtestService.notFound`).
- KIS 외부 실패: 503 + `{ error, manualFallback }`.
- 그 외: 500 + `{ error: err.message }`. 글로벌 핸들러는 `app.js`.
