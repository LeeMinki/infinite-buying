## 1. 공용 산식

- [x] 1.1 `backend/src/services/buyAlgorithm.js` — `resolveBigBuyPremiumRate`의 기본값을 `0.1 / count` → `0.1`로 변경. `splitCount` 인자는 유효성 검증용으로만 남기거나, 더 이상 불필요하면 시그니처 정리.

## 2. 백테스트 엔진

- [x] 2.1 `backend/src/services/strategyEngine.js` — 일봉 평가의 큰수 매수 지정가를 `prevCloseSafe × (1 + bigBuyPremiumRate)` → `평단가 × (1 + bigBuyPremiumRate)`로 변경 (`bigBuyPrice` 계산부).
- [x] 2.2 `strategyEngine.js` — 단일가 평가(`evaluate`)의 `bigBuyPrice`도 평단가 기준으로 변경. `previousClose`에 의존하던 부분 정리.
- [x] 2.3 `strategyEngine.js` — 큰수 매수가 더 이상 전일 종가를 쓰지 않으므로 관련 주석·`reason` 문구("전일 종가 기준" 등)를 평단가 기준으로 갱신. 큰수 매수에서만 쓰이던 `prevClose` 처리는 다른 용도가 없으면 제거.

## 3. 자동매매 엔진

- [x] 3.1 `backend/src/services/autoTradingStrategyEngine.js` — `bigBuyBasePrice = previousClose || currentPrice`를 `averagePrice` 기준으로 변경, `bigBuyPrice = averagePrice × (1 + bigBuyPremiumRate)`.
- [x] 3.2 `autoTradingStrategyEngine.js` — `BIG` intent의 `reason` 문구 "전일종가 기준 지정가" → "평단가 기준 지정가". `conditionNotes`의 큰수 지정가 문구도 점검.
- [x] 3.3 `autoTradingStrategyEngine.js` — 큰수 매수에서만 쓰이던 `previousClose` 입력이 더 이상 불필요하면 정리(다른 용도 확인 후).
- [x] 3.4 `backend/src/services/strategyCalculator.js`(레거시 단일가 계산)에 큰수 매수 산식이 있으면 동일하게 평단가 기준·고정 10%로 정렬. 없으면 해당 없음 확인.

## 4. 테스트

- [x] 4.1 `backend/tests/autoTrading.test.js` — 큰수 매수 관련 케이스의 기대값을 평단가 기준으로 수정 (`orderPrice`, HOLD/BUY 분기에 쓰인 `previousClose` 기반 기대값).
- [x] 4.2 `backend/tests/strategyEngine.test.js` — 큰수 매수 지정가가 평단가 기준임을 검증하도록 수정·추가 (상승일 큰수만 체결 / 하락일 둘 다 체결 시나리오).
- [x] 4.3 `backend/tests/strategyCalculator.test.js` — `previousClose` 기반 기대값이 있으면 갱신.
- [x] 4.4 기본 여유율이 분할 회차와 무관하게 고정 `0.1`임을 검증하는 케이스 추가(`splitCount` 다른 값에서도 동일).
- [x] 4.5 `npm test`(backend) 전체 통과 확인.

## 5. 화면 설명

- [x] 5.1 `frontend/src/components/LaorStrategyGuide.jsx` — 큰수 매수 단계 설명을 "평단가보다 큰수 매수 여유율만큼 높은 가격까지 매수", 기준 가격=평단가, 기본값=고정 10%로 수정. 백테스트·자동매매 양쪽 본문.
- [x] 5.2 `frontend/src/pages/BacktestPage.jsx` — 큰수 매수 여유율 입력 도움말을 평단가 기준·고정 10% 기본값으로 수정. 자동 계산 값 표시(`0.1 / splitCount` 의존) 제거.
- [x] 5.3 `frontend/src/pages/AutoTradingPage.jsx` — 큰수 매수 여유율 입력 도움말을 5.2와 동일하게 수정.
- [x] 5.4 `npm run build`(frontend) 통과 확인.

## 6. 문서

- [x] 6.1 `README.md` — 백테스트·자동매매 절의 큰수 매수 설명을 평단가 기준·고정 10%로 갱신.
- [x] 6.2 `openspec/specs/backtest.md` — "알고리즘" 절의 큰수 매수 설명(`전일 종가 × (1 + bigBuyPremiumRate)`, `0.1 / splitCount`) 갱신.
- [x] 6.3 `openspec/specs/auto-trading.md` — "큰수 매수 여유율" 절과 주요 파일 설명의 큰수 매수 기준·기본값 갱신.

## 7. 검증

- [x] 7.1 백테스트를 임의 종목으로 실행해 큰수 매수가 평단가 기준으로 체결되는지 거래 이력으로 확인.
- [x] 7.2 `openspec validate fix-big-buy-algorithm`(또는 동등 명령)으로 change 정합성 확인.
