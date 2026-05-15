## 1. 마이그레이션 0021

- [ ] 1.1 `backend/src/db/migrations/0021_buy_algorithm_v2_native.sql` 추가.
  - `ALTER TABLE strategies ADD COLUMN pending_avg_budget REAL DEFAULT 0;`
  - `ALTER TABLE strategies ADD COLUMN pending_big_budget REAL DEFAULT 0;`
  - `ALTER TABLE auto_trading_orders ADD COLUMN decision_log_id INTEGER REFERENCES decision_logs(id);`
  - `ALTER TABLE auto_trading_orders ADD COLUMN half TEXT;`
- [ ] 1.2 마이그레이션 적용 후 기존 행이 NULL/0으로 정상 초기화되는지 확인.

## 2. 공통 유틸

- [ ] 2.1 `backend/src/services/buyAlgorithm.js`에 다음 함수 추가:
  - `resolveBigBuyPremiumRate({ override, splitCount })` — override가 null/undefined면 `0.1 / splitCount`.
  - `computeMaxSplitCount({ totalBudget, referencePrice })` — `floor(totalBudget / (referencePrice × 2))`.
  - `makeIdempotencyKey({ tradeDate, strategyId, round, half })`.
- [ ] 2.2 유틸 단위 테스트 (`backend/tests/buyAlgorithm.test.js`).

## 3. 백테스트 엔진 (strategyEngine.js)

- [ ] 3.1 `normalizeParams`에서 `bigBuyPremiumRate` 기본값을 2.1 유틸로 결정.
- [ ] 3.2 `normalizeState`에 `pendingAvgBudget`, `pendingBigBudget` 추가.
- [ ] 3.3 `evaluateDay`에서 두 절반의 체결 로직을 일봉 `low`와 비교하는 방식으로 변경. 체결가는 `min(open, 지정가)`.
- [ ] 3.4 두 절반에 대해 carryover 계산 → 매수 후 `pending_*_budget` 갱신.
- [ ] 3.5 회차 카운터는 한 거래일 1회만 증가(어떤 절반이라도 매수 성사 시).
- [ ] 3.6 새 사이클 시작 시 `pending` 0으로 리셋.
- [ ] 3.7 결정 객체에 `half` 필드 추가.
- [ ] 3.8 해외 종목도 정수 주만 매수(allowFractional 정리). 첫 매수도 정수 주.
- [ ] 3.9 `tests/strategyEngine.test.js`에 specs/backtest/spec.md 시나리오 추가.

## 4. 자동매매 평가 엔진 (autoTradingStrategyEngine.js)

- [ ] 4.1 `evaluateAutoTrading`이 `{ decision, intents, reason }` 반환하도록 시그니처 변경.
- [ ] 4.2 첫 매수: `intents: [{ half: 'FIRST', orderPrice: currentPrice, ... }]`.
- [ ] 4.3 일반 매수: 평단가/큰수 조건 독립 평가 + carryover 합산해 `AVG`, `BIG` intent 생성. 1주 미만이면 intent 미생성(carryover로 흡수).
- [ ] 4.4 매도/HOLD/COMPLETED는 intents 빈 배열.
- [ ] 4.5 carryover 후속 갱신값(`nextPendingAvgBudget`, `nextPendingBigBudget`)을 결과에 포함시켜 호출자가 DB 갱신.
- [ ] 4.6 단위 테스트: 두 intent 모두 발동 / `BIG`만 / 둘 다 carryover / 누적 후 매수 / 매도.

## 5. 자동매매 주문 흐름 (autoTradingService.js)

- [ ] 5.1 결정 결과의 `intents` 배열을 순회하며 각 intent에 대해 SafetyGuard·주문 접수를 직렬 수행.
- [ ] 5.2 `makeIdempotencyKey`를 2.1 유틸로 통일(half 포함).
- [ ] 5.3 `auto_trading_orders` insert 시 `half`, `decision_log_id` 저장.
- [ ] 5.4 한 평가에서 만들어지는 모든 주문이 같은 `decision_log_id`를 가지도록 결정 로그를 먼저 만들고 그 id를 주문에 전달.
- [ ] 5.5 `AVG` 접수 후 `BIG` 평가에 갱신된 매수가능금액 반영(KIS 매수가능금액 재조회 또는 로컬 차감).
- [ ] 5.6 평가 종료 시점에 `strategies.pending_avg_budget`, `pending_big_budget` 갱신.
- [ ] 5.7 새 사이클 시작 시 `pending` 0으로 리셋.
- [ ] 5.8 자동 취소 흐름이 모든 절반 종류의 미체결을 포함하는지 회귀 테스트.
- [ ] 5.9 통합 테스트: 평가 → 1~2건 주문 접수 → DB 상태 + carryover 검증.

## 6. SafetyGuard

- [ ] 6.1 intent별 검사 진입점 추가. 한 intent의 SKIP이 다른 intent를 차단하지 않도록.
- [ ] 6.2 "실주문 + 해외 + quantity < 1" 차단 가드는 유지(이상치 방어). 메시지를 사용자 친화적으로 개선.

## 7. 전략 service & repository

- [ ] 7.1 `strategiesService.createStrategy`에서 `bigBuyPremiumRate`가 omitted/null이면 산식 적용.
- [ ] 7.2 `createStrategy`/`createAutoTradingStrategy`에서 분할회차 cap 검증. 위반 시 400.
- [ ] 7.3 응답에 `effectiveBigBuyPremiumRate`, `maxSplitCount` 노출.
- [ ] 7.4 strategies repository에 `pending_avg_budget`, `pending_big_budget` 읽기/쓰기 추가.
- [ ] 7.5 autoTradingRepository의 createOrder가 `half`, `decision_log_id` 받도록.

## 8. KIS 주문 호출

- [ ] 8.1 `kisTradingService.placeBuyOrder`를 한 평가에서 두 번 호출했을 때 rate limit과 충돌하지 않는지 단위 테스트로 확인.
- [ ] 8.2 응답에서 `kis_order_no`가 각 intent별로 정확히 저장되는지 회귀 테스트.

## 9. 프론트엔드

- [ ] 9.1 `frontend/src/components/StrategyDraftForm.jsx`: `bigBuyPremiumRate` placeholder/helper 갱신, 분할회차 max 산식 적용.
- [ ] 9.2 자동매매 전략 생성 폼(`AutoTradingPage.jsx` 등): 분할회차 cap UI, "1주 단위 매수" 안내.
- [ ] 9.3 `LaorStrategyGuide.jsx` 본문 갱신(산식, 두 지정가, 미체결 자동 취소, 1주 단위, carryover).
- [ ] 9.4 자동매매 상세 주문 목록에 `half` 칩(`평단가 매수`/`큰수 매수`/`첫 매수`/`매도`).
- [ ] 9.5 결정 로그 그룹화: 같은 `decisionLogId`의 주문들을 한 카드 안에 표시.
- [ ] 9.6 백테스트 결과 화면에 `algorithmVersion` 라벨.

## 9b. 백테스트 매수 단위 모드

- [x] 9b.1 마이그레이션 0021에 `backtest_runs.allow_fractional_shares` 컬럼 추가.
- [x] 9b.2 `backtestService.validateInput`이 `allowFractionalShares`를 받도록(기본 false).
- [x] 9b.3 `backtestService.createRun`의 `params.market === 'US'` 강제를 `params.allowFractionalShares`로 교체.
- [x] 9b.4 `backtestRunsRepository`의 createRun INSERT와 toRun에 컬럼 반영. `publicRun`에 노출.
- [x] 9b.5 `BacktestPage.jsx`에 "소수점 매매 시뮬레이션" 체크박스 + 안내.
- [x] 9b.6 백테스트 결과 요약에 매수 단위 모드 표시.
- [x] 9b.7 backtestService 통합 테스트: 정수 모드 vs 소수점 모드 결과 차이 검증.

## 10. 문서 / baseline

- [ ] 10.1 `openspec/specs/auto-trading.md` 갱신.
- [ ] 10.2 `openspec/specs/backtest.md` 갱신.
- [ ] 10.3 `openspec/specs/orders-fills-positions.md` 갱신.
- [ ] 10.4 `openspec/specs/frontend-screens.md` 갱신.
- [ ] 10.5 `openspec/specs/current-limitations.md`에서 "소수점매수" 항목 갱신(KIS Open API 미지원 명시 + carryover 보완 설명).
- [ ] 10.6 `openspec/specs/security.md`에서 SafetyGuard 1주 미만 가드 사유 갱신.
- [ ] 10.7 `README.md`의 LAOR 설명 갱신.

## 11. 최종 검증

- [ ] 11.1 `cd backend && node --test tests/*.test.js` 통과.
- [ ] 11.2 변경된 파일 빠른 수동 점검.
- [ ] 11.3 PR 머지 후 `openspec/changes/change-buy-algorithm/`을 아카이브 (`/opsx:archive`).
