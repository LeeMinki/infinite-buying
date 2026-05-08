# Tasks: Real-Price Backtest

- [X] T001 Remove old mode-selection UI.
  - 목적: 사용자가 단일 현재가 평가와 모드 선택에서 혼란을 겪지 않게 한다.
  - 수정 파일: `frontend/src/App.jsx`, `frontend/src/pages/StrategiesPage.jsx`, removed old mode pages.
  - 완료 조건: 화면에서 `백테스트`로 바로 이동한다.

- [X] T002 Remove old validation APIs.
  - 목적: 더 이상 지원하지 않는 실행 경로를 backend에서 노출하지 않는다.
  - 수정 파일: `backend/src/app.js`, removed simulation/trading-mode route/service/repository files.
  - 완료 조건: 백테스트 외 과거 검증 API가 app에 mount되지 않는다.

- [X] T003 Use Kiwoom-only market data.
  - 목적: 백테스트가 실제 과거 가격으로만 계산되게 한다.
  - 수정 파일: `backend/src/config/env.js`, `backend/src/market-data/index.js`, `backend/src/market-data/KiwoomMarketDataProvider.js`, `backend/src/services/kiwoomAuthService.js`.
  - 완료 조건: `MARKET_DATA_PROVIDER=kiwoom`만 허용된다.

- [X] T004 Simplify Backtest UI.
  - 목적: 백테스트 실행 버튼 하나로 실제 가격 조회와 계산을 이어서 실행한다.
  - 수정 파일: `frontend/src/pages/BacktestPage.jsx`.
  - 완료 조건: 사용자에게 내부 저장소/provider 표현을 노출하지 않고 실제 가격 기반 결과를 보여준다.

- [X] T005 Update documents and tests.
  - 목적: 문서와 테스트가 backtest-only 방향과 일치하게 한다.
  - 수정 파일: `README.md`, `specs/003-trading-modes-simulator-backtest/*`, `backend/tests/*`.
  - 완료 조건: `npm test`, `npm run build`가 통과한다.

- [X] T006 User-scoped Kiwoom daily price storage and chart rendering fix.
  - 목적: 백테스트 실행 전에 실제 키움 일봉을 사용자별 저장소에 확보하고, 이미 충분한 Kiwoom 행이 있으면 재사용한다. 또한 백테스트 결과 화면에서 평균단가 vs 종가 차트가 X축 데이터 키 불일치로 비어 보이던 문제를 수정한다.
  - 수정 파일: `backend/src/services/marketDataService.js`, `backend/tests/marketDataServiceCache.test.js`, `frontend/src/pages/BacktestPage.jsx`.
  - 완료 조건: 저장된 사용자별 Kiwoom 행이 요청 범위를 덮으면 그 행을 반환하고, 덮지 못하면 Kiwoom 으로 폴백한 뒤 결과를 저장한다. `refresh=true` 는 저장된 행을 우회한다. 백테스트 결과 화면의 두 차트가 동일한 `chartData` (`date`, `totalAsset`, `price`, `averagePrice`)를 사용한다.
