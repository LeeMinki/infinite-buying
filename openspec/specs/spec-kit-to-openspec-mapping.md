# Spec Kit ↔ OpenSpec 매핑

기존 Spec Kit 산출물(`/specs/001~005/`)은 그대로 보존된다. 각 디렉터리는 그 시점의 "이번에 만들 변경"을 정의한 changeset이며, **현재 코드의 진실의 원천은 본 OpenSpec baseline + 코드** 자체다.

## 디렉터리 매핑 요약

| Spec Kit 디렉터리 | 주제 | OpenSpec baseline 대응 |
| --- | --- | --- |
| `specs/001-virtual-trade-mvp/` | 최초 MVP: 전략 초안, 가상 보유/주문, 평가 로그 | [orders-fills-positions.md](orders-fills-positions.md) "구(舊) 가상 주문 / 평가 로그" 절, [database-model.md](database-model.md) "(구) 가상 주문 / 전략 초안" 절 |
| `specs/002-user-auth-and-kiwoom-market-data/` | 사용자 인증 + (당시) Kiwoom REST 시장 데이터 | [user-authentication.md](user-authentication.md), [market-data.md](market-data.md) (Kiwoom → KIS로 이행됨) |
| `specs/003-trading-modes-simulator-backtest/` | 시뮬레이터/백테스트 도입 | [backtest.md](backtest.md) (이후 005에서 알고리즘이 LAOR_INFINITE_V2로 재정의됨) |
| `specs/004-migrate-kiwoom-to-kis/` | 시장 데이터 공급자 Kiwoom → KIS 이전 | [market-data.md](market-data.md), [kis-credentials-and-token.md](kis-credentials-and-token.md) |
| `specs/005-kis-auto-trading/` | KIS 자동매매, 안전 가드, LAOR_INFINITE_V2 평단가/큰수 매수 분리, 미체결 자동 취소 | [auto-trading.md](auto-trading.md), [orders-fills-positions.md](orders-fills-positions.md), [backtest.md](backtest.md), [security.md](security.md) |

## 각 산출물의 신뢰도 안내

- Spec Kit `spec.md`는 그 시점의 의도이며, 일부 요구사항은 이후 변경으로 폐기되거나 재정의되었다. 예시:
  - 001: Kiwoom 가정은 002~004를 거쳐 KIS로 대체됨.
  - 003: 백테스트 알고리즘이 005에서 `LAOR_INFINITE_V2`로 재정의되고 평단가/큰수 매수 분리·큰수 매수 여유율이 추가됨.
  - 005: 초기 `spec.md`에는 "자동 취소 미구현"이라고 적혀 있었으나, FR-051a/b 갱신과 PR #21로 자동 취소가 추가되었다. 본 baseline은 갱신 후 상태를 정식 명세로 사용한다.

향후 새 기능 변경은 Spec Kit 디렉터리를 더 만들지 말고, `openspec/changes/` 아래에 OpenSpec change로 작성한다.

## 코드 ↔ Baseline 빠른 매핑

| 코드 위치 | Baseline 문서 |
| --- | --- |
| `backend/src/auth/`, `backend/src/routes/authRoutes.js` | [user-authentication.md](user-authentication.md) |
| `backend/src/services/kisAuthService.js`, `kisTokenManager.js`, `kisCredentialService.js`, `backend/src/routes/kisSettingsRoutes.js` | [kis-credentials-and-token.md](kis-credentials-and-token.md) |
| `backend/src/market-data/`, `backend/src/services/marketDataService.js`, `backend/src/routes/marketRoutes.js` | [market-data.md](market-data.md) |
| `backend/src/services/backtestService.js`, `strategyEngine.js`, `backend/src/routes/backtestRoutes.js` | [backtest.md](backtest.md) |
| `backend/src/services/autoTrading*.js`, `strategyCalculator.js`, `kisTradingService.js`, `backend/src/routes/autoTradingRoutes.js` | [auto-trading.md](auto-trading.md), [orders-fills-positions.md](orders-fills-positions.md) |
| `backend/src/db/migrations/0001~0020` | [database-model.md](database-model.md) |
| `backend/src/app.js`, 라우트 일체 | [backend-api.md](backend-api.md) |
| `frontend/src/pages/*`, `frontend/src/components/*` | [frontend-screens.md](frontend-screens.md) |
| `backend/src/crypto/`, `backend/src/auth/sessionStore.js`, SafetyGuard | [security.md](security.md) |
