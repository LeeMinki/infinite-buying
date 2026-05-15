# 백테스트

## 책임

KIS 일봉으로 단일 종목 분할 매수 전략(`LAOR_INFINITE_V2_NATIVE`) 결과를 계산해 요약 지표, 거래 이력, 자산 곡선, 평균단가 vs 종가를 제공한다.

## 주요 파일

- `backend/src/routes/backtestRoutes.js`
- `backend/src/services/backtestService.js` — 입력 검증, run 생성, public 변환
- `backend/src/services/strategyEngine.js` — `LAOR_INFINITE_V2` 의사결정 + 체결 계산
- `backend/src/repositories/backtestRunsRepository.js`
- `backend/src/repositories/backtestTradesRepository.js`
- `backend/tests/backtests.test.js`, `backtestEndToEnd.test.js`, `strategyEngine.test.js`

## API

| Method | Path | 설명 |
| --- | --- | --- |
| POST | `/api/backtests` | 새 백테스트 실행. 입력: 종목 정보, 기간, 총 예산, 분할 회차, 목표 수익률, 큰수 매수 여유율, 새 사이클 시작 여부. KIS 일봉 조회 → 알고리즘 계산 → 결과 저장. |
| GET | `/api/backtests` | 사용자의 run 목록. |
| GET | `/api/backtests/:id` | run 요약. |
| GET | `/api/backtests/:id/trades` | run 거래 이력 (BUY/SELL/HOLD/COMPLETED). |
| DELETE | `/api/backtests/:id` | run 삭제. |

## 알고리즘 (`LAOR_INFINITE_V2`)

README "백테스트" 절을 정식 명세로 본다. 요약:

1. **회차 예산** = 사이클 시작 시점의 총 시드 ÷ 분할 회차.
2. **첫 매수**: 보유 수량이 없으면 그날 시가로 회차 예산만큼 매수.
2a. **매수 단위 모드**: 기본은 **1주 단위**(자동매매와 동일, 국내·해외 무관). 회차 절반 예산이 1주 가격보다 작으면 carryover로 다음 거래일에 누적. `allow_fractional_shares` 옵션을 켜면 소수점 6자리 수량으로 시뮬레이션. 모드는 `backtest_runs.allow_fractional_shares`에 저장.
3. **이후 매수**: 회차 예산을 절반씩 둘로 나누어 독립적으로 판단.
   - **평단가 매수**: 일봉 저가가 평단가 지정가에 닿으면 절반 매수. 체결가는 `min(시가, 평단가)`.
   - **큰수 매수**: 일봉 저가가 전일 종가 × (1 + `bigBuyPremiumRate`) 지정가에 닿으면 다른 절반 매수. `bigBuyPremiumRate`를 비워두면 `0.1 / splitCount`.
   - 둘 다 충족 시 회차 예산 전부 매수, 한쪽만 충족 시 그 절반만 매수.
4. **매도**: 장중 고가가 `평단가 × (1 + targetProfitRate)` 이상이면 목표가에 전량 매도 (목표 매도일에는 추가 매수 없음).
5. **새 사이클**: `restart_after_sell`가 켜져 있으면 목표 매도 이후 현재 총자산을 다시 분할 회차로 나누어 다음 사이클 시작. 꺼져 있으면 종료(`COMPLETED`).
6. **회차 소진**: 분할 회차를 모두 쓰고 현금이 다음 회차 예산보다 적으면 보유 수량의 1/4을 종가 매도해 자금 확보.

체결 기준: 매수는 일봉 저가와 지정가 비교, 매도는 목표가(고가가 목표가에 닿으면 목표가). 수수료, 세금, 환율, 슬리피지는 0으로 가정.

## 결과 지표 (`backtest_runs`)

- `initial_budget`, `final_asset`, `realized_profit`, `unrealized_profit`, `return_rate`
- `max_invested_amount`, `max_drawdown_rate`
- `total_buy_count`, `total_sell_count`, `final_holding_quantity`, `final_average_price`
- `status`: `RUNNING` → `COMPLETED` 또는 `FAILED` (+`error_message`)

## 거래 이력 (`backtest_trades`)

각 거래일별로 side(BUY/SELL/HOLD/COMPLETED), 가격, 수량, 회차, 현금, 보유 수량, 평단, 투입금액, 실현/미실현 손익, 평가금, 총자산, drawdown, reason을 저장.

## 통화

- 국내: KRW (정수 주, 정수 금액)
- 해외: KIS 응답 통화 (`backtest_runs.currency`, 기본 USD). 소수점 6자리 수량 지원 (`migrations/0015~0016`에서 `REAL`로 마이그레이션).
