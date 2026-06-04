## 1. DB 마이그레이션

- [x] 1.1 `backend/src/db/migrations/0029_us_rank_auto_trading.sql` 작성 및 `0030_us_rank_tune.sql` 보강: `us_rank_strategies`(자동 예산·고정 USD·익절·손절·강제 청산 시각·거래소·통화·누적 목표·보유·day_locked_out·day_locked_out_at), `us_rank_trades`((strategy_id, trade_date, trade_seq) UNIQUE), `us_rank_orders`(idempotency_key·sell_reason CHECK TARGET/STOP_LOSS/FORCE_CLOSE/CYCLE_COMPLETE), `us_rank_decision_logs`, `us_rank_locks`((strategy_id, lock_key) UNIQUE) 테이블 + 인덱스 생성. 기존 라오어·한국 랭킹 테이블 ALTER 없음.
- [x] 1.2 로컬에서 마이그레이션 적용 확인 (`schema_migrations`에 `0029_us_rank_auto_trading.sql` 추가, 각 테이블 컬럼·CHECK·UNIQUE 확인).

## 2. KIS 해외 등락률 순위 조회 (Open Question 해결)

- [x] 2.1 KIS Open API 문서·실응답으로 해외주식 등락률 상위 랭킹 엔드포인트·trId·필수 입력값(거래소 코드 NAS/NYS/AMS, 정렬 방향, 통화)·응답 필드(종목코드·종목명·현재가·등락률) 확정.
- [x] 2.2 `backend/src/market-data/KisMarketDataProvider.js`에 `getOverseasFluctuationRanking({ exchange })` 메서드 추가. 응답을 종목코드·종목명·현재가·등락률·거래소로 정규화한 배열로 반환.
- [x] 2.3 `backend/src/services/marketDataService.js`에 `getOverseasFluctuationRanking(userId, options)` 래퍼 추가 (KR 랭킹과 동일 패턴).
- [x] 2.4 단위 테스트: 빈 응답·등락률 파싱 실패 종목 제외·정렬 보존.

## 3. 전략 엔진 (순수 함수)

- [x] 3.1 `backend/src/services/usRankStrategyEngine.js` 생성. 미국장은 가격제한폭이 없으므로 상승률 상한 상수 없이 첫 유효 랭킹 후보를 선택.
- [x] 3.2 `isUsRegularSession(now)` — `Intl.DateTimeFormat('America/New_York')`로 ET를 얻어 평일 10:00~16:00 판정. 토/일은 false.
- [x] 3.3 `kstNowMinutes()`, `parseHhmmMinutes()` — KR 랭킹 엔진에서 패턴 차용(가능하면 공용 모듈로 추출).
- [x] 3.4 `isUsForceCloseTime(now, forceCloseKst)` — 현재 KST가 forceCloseKst 이상이고 `isUsRegularSession(now)`이면 true. 그 외 false.
- [x] 3.5 `etTradeDate(now)` — 미국 동부 자정 기준 거래일 문자열(`YYYY-MM-DD`) 반환. `day_locked_out` 해제 판정에 사용.
- [x] 3.6 `selectRankingCandidate(rankingList)` — 종목코드·현재가·등락률이 유효한 첫 랭킹 후보 선택.
- [x] 3.7 `computeBuyQuantity(cash, price)` — 정수 1주 단위, KR 랭킹 패턴 재사용.
- [x] 3.8 `evaluateSell({ currentPrice, averagePrice, targetProfitRate, stopLossRate, forceCloseTriggered, cycleTargetReached })` — 우선순위 CYCLE_COMPLETE → STOP_LOSS → TARGET → FORCE_CLOSE → HOLD로 평가.
- [x] 3.9 `makeUsRankIdempotencyKey({ tradeDate, strategyId, tradeSeq, side })` — `{YYYYMMDD}-{strategyId}-{tradeSeq}-{BUY|SELL}`.
- [x] 3.10 단위 테스트: ET DST 분기, 강제 청산 시각 트리거, 매도 우선순위, 멱등키 형식.

## 4. 레포지토리

- [x] 4.1 `backend/src/repositories/usRankRepository.js` 생성. KR 랭킹 레포지토리와 같은 패턴 — strategies/trades/orders/decision_logs/locks CRUD + helper.
- [x] 4.2 `createStrategy` / `updateStrategy` / `getStrategy` / `listStrategies` / `listRunningStrategies` / `startStrategy` / `stopStrategy` / `deleteStrategy` / `markEvaluation` / `touchEvaluation` / `setHolding` / `clearHolding` / `setStrategyError` / `setDayLockedOut` / `clearDayLockedOutIfStale(etTradeDate)`.
- [x] 4.3 `createTrade` / `updateTradeOutcome` / `getOpenTrade(strategyId)` / `nextTradeSeq(strategyId, etTradeDate)` / `listTrades(userId, { strategyId, limit })`.
- [x] 4.4 `createOrder` / `updateOrder` / `getOrder` / `listOrders` / `hasDuplicateOrder(idempotencyKey)` / `hasNonFailedOrder(idempotencyKey)` / `countFailedOrders(idempotencyKey)` / `hasBlockingOpenOrder(userId, strategyId)`.
- [x] 4.5 `createDecisionLog` / `attachOrderIdToDecisionLog` / `listDecisionLogs`.
- [x] 4.6 `acquireLock(userId, strategyId, lockKey, lockedUntil)` / `releaseLock(strategyId, lockKey)`.
- [x] 4.7 단위 테스트: trade_seq 자동 증가, day_locked_out 자동 해제, 중복 주문 차단, 행 변환(`toStrategy`/`toTrade`/`toOrder`/`toDecisionLog`).

## 5. 서비스

- [x] 5.1 `backend/src/services/usRankService.js` 생성. KR 랭킹 서비스와 같은 패턴.
- [x] 5.2 `normalizeStrategyInput(input)` — target_profit_rate / stop_loss_rate / force_close_kst / exchange / cycle_target_profit_rate 검증. 미국장 랭킹 전략은 매수가능금액 전액을 사용한다. `force_close_kst`는 `HH:MM` 형식만 허용, 잘못된 형식 거절.
- [x] 5.3 CRUD: `createStrategy` / `listStrategies` / `getStrategy` / `updateStrategy` / `deleteStrategy` / `startStrategy` / `stopStrategy`.
- [x] 5.4 `evaluateStrategy(userId, id, { scheduled })` — 락 획득, 장 외/장 잠금 SKIP, evaluateSellPath 또는 새 매매 사이클 시작 분기.
- [x] 5.5 `evaluateUnlocked(userId, strategy, evaluationSource)` — `day_locked_out` 갱신·점검, 보유 있으면 evaluateSellPath, 없으면 evaluateEntryPath. 장 외이면 noLog SKIP.
- [x] 5.6 `evaluateSellPath` — 잔고 0이면 보유 해제. evaluateSell 호출. HOLD면 사유에 익절·손절·강제청산 미도달 명시. TARGET이면 랭킹 순위와 관계없이 전량 매도. SELL면 hasNonFailedOrder/재시도 한도 검사, 매도 주문, exit_reason에 따라 trade 행 업데이트(`status=CLOSED`, `exit_*` 채움). STOP_LOSS / FORCE_CLOSE이면 `setDayLockedOut(today_et)`, CYCLE_COMPLETE이면 전략 STOPPED.
- [x] 5.7 `evaluateEntryPath` — day_locked_out 검사, force_close 직전 가드, 진행 중인 trade 없으면 새 trade INSERT(랭킹 조회 → 5 USD·거래량·거래대금·+50% 과열·분봉 필터 통과 후보 선택 → trade_seq+1 행 생성), 이미 SELECTED 상태 trade 있으면 그것을 사용. 매수 수량 계산(자동 예산 vs 고정), 안전 검증, placeOrder. 성공 시 `setHolding`·trade `status=BOUGHT, entry_price=...`.
- [x] 5.8 `placeOrder` — `kisTradingService.placeBuyOrder/placeSellOrder` 위임 (KIS 해외 일반 주문 제약에 맞춰 현재가 지정가, exchange 정규화는 기존 placeOverseasOrder 경로 재사용).
- [x] 5.9 `checkOrderSafety` — 수량 0/미체결 주문/중복 주문/매수가능금액 부족/보유 수량 부족 차단.
- [x] 5.10 `saveDecision` / `saveSkip(noLog)` — KR 랭킹 패턴. 장 외·idle SKIP은 noLog.
- [x] 5.11 `evaluateRunningStrategies()` — RUNNING 전략 순회.
- [x] 5.12 통합 테스트: 정규장 진입·익절 매도 후 재매수·손절 후 day_locked_out·강제 청산.

## 6. 라우트

- [x] 6.1 `backend/src/routes/usRankRoutes.js` 생성. `GET /api/us-rank/overview`, `GET/POST /api/us-rank/strategies`, `GET/PUT/DELETE /api/us-rank/strategies/:id`, `POST /api/us-rank/strategies/:id/start|stop|evaluate|sync-fills`, `GET /api/us-rank/strategies/:id/trades|orders|trade-history|decisions`, `POST /api/us-rank/strategies/:id/trade-history/:tradeId/replay`.
- [x] 6.2 `backend/src/app.js`에 라우터 마운트.
- [x] 6.3 라우트 인증 검증(기존 미들웨어 재사용).

## 7. 스케줄러

- [x] 7.1 `backend/src/config/env.js`에 `US_RANK_SCHEDULER_INTERVAL_MS`(기본 60_000) 추가.
- [x] 7.2 `backend/src/services/autoTradingScheduler.js`에 `usRankTimer` 추가 — `evaluateRunningStrategies`(usRankService) 호출. 라오어·KR 랭킹과 독립 타이머.
- [x] 7.3 `stopAutoTradingScheduler()` 정리.

## 8. 프론트엔드 — 패널·폼

- [x] 8.1 `frontend/src/api/client.js`에 US 랭킹 API 함수 추가: `getUsRankOverview`, `listUsRankStrategies`, `createUsRankStrategy`, `getUsRankStrategy`, `deleteUsRankStrategy`, `startUsRankStrategy`, `stopUsRankStrategy`, `evaluateUsRankStrategy`, `listUsRankTrades`, `listUsRankOrders`, `listUsRankDecisions`.
- [x] 8.2 `frontend/src/pages/UsRankAutoTradingPanel.jsx` 생성 — KR 랭킹 패널 기반. 연결 계좌(USD 매수가능금액), 전략 만들기 폼(매수가능금액 전액 안내/익절/손절/강제 청산 시각/거래소/누적 목표), 전략 목록 카드, 전략 상세(매매 횟수·잠금·익절/손절·누적 목표 표시), 매매 사이클 테이블, 판단 로그(평가금액 컬럼), 주문 이력(총 금액 컬럼).
- [x] 8.3 `frontend/src/pages/AutoTradingPage.jsx`에 세 번째 탭 "미국장 상승률 랭킹 전략" 추가.
- [x] 8.4 빌드 확인(`npm run build`).

## 9. 문서·OpenSpec

- [x] 9.1 README의 자동매매 절에 미국장 랭킹 전략 설명 추가(라오어·한국 랭킹 다음).
- [x] 9.2 `openspec/specs/auto-trading.md`(또는 새 capability 디렉터리)에 미국장 랭킹 전략 요약 추가.
- [x] 9.3 `openspec/specs/database-model.md`에 새 테이블 5개 요약 추가.
- [x] 9.4 `npx openspec validate --specs --strict` 통과 확인.

## 10. 배포·검증

- [x] 10.1 백엔드 테스트(`npm test`) 전체 통과.
- [x] 10.2 프론트엔드 빌드 성공.
- [ ] 10.3 PR 생성 — 배포 후 ArgoCD 동기화 확인, 마이그레이션 `0029_us_rank_auto_trading.sql` 적용 확인.
- [x] 10.4 실주문 OFF 상태로 정규장 시간 진입 → DRY_RUN trade·orders 행이 정상 생성되는지 확인.
- [x] 10.5 강제 청산 시각 / 손절 → day_locked_out 시나리오 확인.
- [x] 10.6 후속 작업으로 회귀 위험·휴장일 캘린더·자동 종목 차단 필요 여부 평가.

## 11. 아카이브

- [ ] 11.1 모든 task 완료 후 `/opsx:archive`로 change 아카이브 + 새 spec(`us-rank-auto-trading`) 정식 등록.
