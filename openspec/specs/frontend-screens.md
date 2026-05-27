# Frontend 화면

React 19 + Vite + Recharts. 라우팅 라이브러리는 사용하지 않고 `frontend/src/App.jsx`의 `view` 상태로 다음 4가지 화면을 토글한다.

| `view` 값 | 화면 컴포넌트 | 경로 (UI 상) |
| --- | --- | --- |
| 기본 | `StrategiesPage` | 메인 (백테스트·자동매매·KIS 설정 진입 카드 + 내 전략 목록) |
| `kis` | `KisSetupPage` | KIS 설정 |
| `backtest` | `BacktestPage` | 백테스트 |
| `auto-trading` | `AutoTradingPage` | 자동매매 |

## 메인 (`StrategiesPage`)

- 시작 가이드·공통 전략 초안(`StrategyForm`)·라오어 중심 설명 패널을 제거하고, **백테스트·자동매매·KIS 설정으로 바로 진입하는 액션 카드**(`home-actions`)를 노출한다. 자동매매 카드는 한국장·미국장 랭킹 전략을 주요 진입으로 강조한다.
- 그 아래 "라오어 초안" 목록(저장된 라오어 전략 선택·삭제·상태)을 보조로 둔다. 전략 상세·백테스트 검증/자동매매 만들기 흐름은 각 화면에서 이어간다.

## KIS 설정 (`KisSetupPage`)

- App Key / App Secret / 계좌번호 / 계좌상품코드 입력.
- 저장 후 App Secret 원문은 다시 표시되지 않음.
- 연결 테스트 버튼 → `POST /api/settings/kis/test`.

## 백테스트 (`BacktestPage`)

- 입력 폼 + 실행 버튼 → `POST /api/backtests`.
- 입력 옵션: 분할 회차·목표 수익률·큰수 매수 여유율·"목표 매도 후 새 사이클 시작"·**"소수점 매매 시뮬레이션"** 체크박스. 소수점 옵션을 끄면 기본 1주 단위(자동매매와 동일, carryover 적용), 켜면 소수점 6자리 수량 시뮬레이션.
- 결과 영역: 요약 카드 (return rate, max drawdown, **매수 단위 모드** 등), `AssetCurveChart`, `AveragePriceChart`, `DailyChart`, `TradeHistoryTable`, `ResultSummary`.
- `RunPicker`로 과거 run 선택·일괄 삭제.
- `ZeroBuyDiagnostic` — 매수 0회 케이스 진단 보조 UI.
- 통화 자동 추론(`inferMarket`, `inferCurrency`): 6자리 숫자 = `KR`/`KRW`, 그 외 = `US`/`USD`.

## 자동매매 (`AutoTradingPage`)

- 실주문 실행 토글 아래에 **전략 종류 탭**(순서: `한국 국장 상승률 랭킹 전략` → `미국장 상승률 랭킹 전략` → `라오어 무한매수법`, 첫 노출은 한국 랭킹 탭). 한 탭의 동작이 다른 탭의 전략에 영향을 주지 않는다. 실주문 실행 설정은 세 탭이 공유한다.
- 한국/미국 랭킹 전략 탭(`KrRankAutoTradingPanel`/`UsRankAutoTradingPanel`): 전략 생성·시작·종료, 선택 랭킹 종목·계정 요약, 그리고 기록 섹션은 **`주문 이력`(왕복 거래) → `판단 로그`(최초 10개 + 더보기)** 순서. 주문 이력은 매수와 매도를 한 행으로 묶어 매수 시각(KST)·종목·매수가·매도 시각·매도가·사유·손익을 보여주며, 실패·미체결 건은 제외한다(보유 중은 매도란을 "진행 중/보유 중"으로 표기). 한국장의 진입 기록·미국장의 매매 사이클 테이블은 기본 노출하지 않는다. 전략 삭제는 soft delete라 기존 이력은 보존된다(삭제 시 보유 중이면 자동 청산되지 않는다는 경고 표시). 실주문 OFF 시 "실제 주문 없이 기록만 저장 중" 안내.
- (아래는 라오어 무한매수법 탭) 페이지 상단: 전략 목록을 가로 카드(칩) 그룹으로 노출 (좌·우 2단 grid 미사용).
- 전략 상세 패널: `AccountSummaryPanel` (현재가/보유수량/평균단가/현금/매수가능금액/환전 후/환율), `LatestPosition` (최근 포지션 스냅샷 + 그 시점의 결정 배지), `OrdersTable`, `DecisionLogTable`.
- 전략 생성 폼: 종목 검색 한 줄 + 총 예산·분할 회차·목표 수익률·큰수 매수 여유율 균형 배치 + 제출 우측 정렬. `GET /api/auto-trading/buying-power-preview`로 "현재 잔고 / 환전 후" 단축 버튼 제공. "1주 단위 매수만 지원" 안내와 함께, 종목 현재가 기준 최대 분할회차(`floor(totalBudget / (현재가 × 2))`)로 분할 회차 입력을 클램프한다.
- 실주문 실행 토글, 전략 시작/종료, 수동 평가 버튼.
- `LaorStrategyGuide mode="auto"`: 매수(평단가·큰수)를 매도보다 먼저 표시, 미체결 자동 취소 동작 설명 포함.
- `RiskNotice` + `ForeignCurrencyGuide` (해외 종목 시 KRW↔외화 안내).

## 공용 컴포넌트 (`frontend/src/components/`)

- `StockSearchField` — KIS 종목 검색 결과 UI (소수점매매 가능 여부 등 부가 정보 표시 가능)
- `StrategyForm` — 메인 좌측 폼
- `LaorStrategyGuide` — 알고리즘 가이드 (백테스트/자동매매 모드)
- 차트류: `AssetCurveChart`, `AveragePriceChart`, `DailyChart`
- 결과 표시: `EvaluationPanel`, `HoldingPanel`, `OrdersTable`, `ResultSummary`, `TradeHistoryTable`
- 안내: `RiskNotice`

## API 호출 클라이언트

`frontend/src/api/client.js` (정확한 모듈 인터페이스는 본 baseline에서 직접 확인하지 않았다 — 구현 확인 필요 항목 참고).
