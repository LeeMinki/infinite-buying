## 1. 데이터 모델

- [x] 1.1 새 마이그레이션 `00xx_kr_rank_auto_trading.sql` 작성 — `kr_rank_strategies`(status, total_budget, target_profit_rate, stop_loss_rate, lunch_entry_enabled, lunch_target_profit_rate, started/stopped/last_evaluated_at, last_decision, last_error_message) 생성. 기존 `auto_trading_*` 테이블은 ALTER하지 않는다.
- [x] 1.2 `kr_rank_entries` 테이블 생성 — `UNIQUE(strategy_id, trade_date, entry_window)`, 선택 종목·`bought` 플래그·랭킹 스냅샷 참조.
- [x] 1.3 `kr_rank_orders` 테이블 생성 — side·entry_window·sell_reason·status·`idempotency_key` UNIQUE·`live_order_enabled`·payload masked 컬럼.
- [x] 1.4 `kr_rank_decision_logs` 테이블 생성 — decision·entry_window·랭킹/선택 종목·current_price·holding·reason·evaluation_source.
- [x] 1.5 `kr_rank_locks` 테이블 생성 — `(strategy_id, lock_key) UNIQUE`.
- [x] 1.6 각 테이블에 `(user_id, ...)` 시작 복합 인덱스 추가, 마이그레이션 적용 확인.
- [x] 1.7 `openspec/specs/database-model.md`에 `kr_rank_*` 테이블 설명 추가.

## 2. KIS 등락률 순위 연동

- [x] 2.1 `KisMarketDataProvider`에 한국주식 등락률 순위 조회 메서드 추가 (KIS 국내주식 등락률 순위 API, trId·입력값을 실응답으로 확정).
- [x] 2.2 응답을 종목코드·종목명·현재가·등락률로 정규화하고 등락률 내림차순 리스트로 반환.
- [x] 2.3 `marketDataService`에 랭킹 조회 래퍼 함수 추가.
- [x] 2.4 KIS 호출 실패·빈 응답 처리 — 에러를 상위로 전파해 진입 tick이 SKIP/ERROR로 기록되게 한다.

## 3. 백엔드 — 전략 서비스 & 라우트

- [x] 3.1 `krRankRepository` 추가 — 전략/진입/주문/판단/락 CRUD.
- [x] 3.2 `krRankService` 추가 — 전략 생성·시작·종료·조회, 입력 검증(총 예산>0, 목표 수익률·손절률, 점심 진입 옵션·점심 목표 수익률).
- [x] 3.3 `krRankRoutes` 추가 — 전략 CRUD·start·stop·목록·상세·주문·판단 조회 엔드포인트. `app.js`에 라우트 등록.
- [x] 3.4 실주문 실행 설정은 기존 `user_trading_settings`를 그대로 읽어 재사용.

## 4. 백엔드 — 평가 엔진

- [x] 4.1 `krRankStrategyEngine` 추가 — 진입 구간(오전 09:10~, 점심 11:30~) 판정과 그날·구간 진입 완료 여부 확인.
- [x] 4.2 진입 판단 — 랭킹 조회, 등락률 30% 이상 제외, 남은 첫 종목 선택, 선택 종목 없으면 판단 기록만.
- [x] 4.3 매수 판단 — 가용 현금 기준 `floor(현금/현재가)` 정수 수량 계산, 0주면 매수 안 함·판단 기록.
- [x] 4.4 매도 판단 — 보유분 수익률이 목표 수익률(점심 보유분은 점심 목표 수익률) 도달 시 전량 매도, 손절 기준 도달 시 전량 매도, 매도 사유 구분.
- [x] 4.5 진입 구간당 매수 1회 — `kr_rank_entries.bought`가 true면 같은 (날짜, 구간) 재매수 금지(매도 후에도).
- [x] 4.6 멱등키 `makeKrRankIdempotencyKey({tradeDate, strategyId, entryWindow, side})` 구현.
- [x] 4.7 안전 검증 — RUNNING 여부·수량>0·미체결 없음·멱등키 중복 없음·매수가능금액≥금액·보유≥매도수량 검증 (기존 `autoTradingSafetyGuard` 재사용 또는 동등 검증).

## 5. 백엔드 — 주문 실행 & 스케줄러

- [x] 5.1 실주문 OFF — 판단·`DRY_RUN` 주문 예정·랭킹/선택 종목 기록 저장, KIS 주문 API 미호출.
- [x] 5.2 실주문 ON — 안전 검증 통과 주문만 `kisTradingService`로 한국주식 매수/매도 전송, 상태 전이 기록.
- [x] 5.3 주문 실패(`FAILED`/`REJECTED`) 시 자동 재시도 안 함.
- [x] 5.4 `autoTradingScheduler` tick에 한국 랭킹 전략 평가 추가 — RUNNING 전략을 `kr_rank_locks`로 락 후 평가, 라오어 평가와 독립 실행.
- [x] 5.5 진입 구간 폭을 스케줄러 간격보다 넓게 설정하고, `kr_rank_entries` UNIQUE로 중복/동시 진입 1회 보장.

## 6. 프론트엔드

- [x] 6.1 `AutoTradingPage`에 전략 종류 탭 추가 — 라오어 탭(기존 UI 그대로) / "한국 국장 상승률 랭킹 전략" 탭.
- [x] 6.2 한국 랭킹 전략 생성 폼 — 총 예산·목표 수익률·손절 기준·점심 진입 사용 여부·점심 목표 수익률.
- [x] 6.3 한국 랭킹 전략 대시보드 — 전략 시작/종료, 오전 진입 실행 여부, 점심 진입 사용/실행 여부, 선택 랭킹 종목 표시.
- [x] 6.4 매수 판단·매도 판단·주문 상태 목록 표시, 진입 구간·매도 사유·실주문 여부 구분 표시.
- [x] 6.5 실주문 OFF 시 "실제 주문 없이 기록만 저장 중" 안내 표시.
- [x] 6.6 `frontend/src/api/client.js`에 한국 랭킹 전략 API 함수 추가.

## 7. 테스트 & 문서

- [x] 7.1 등락률 30% 이상 제외·첫 종목 선택 단위 테스트.
- [x] 7.2 진입 구간당 매수 1회(매도 후 재매수 금지) 테스트.
- [x] 7.3 멱등키 중복 차단·미체결 시 신규 주문 금지 테스트.
- [x] 7.4 목표 수익/손절 매도 판단·매도 사유 구분 테스트.
- [x] 7.5 실주문 OFF에서 KIS 주문 미호출·기록은 저장됨 테스트.
- [x] 7.6 라오어 전략 기존 테스트가 모두 통과하는지 회귀 확인.
- [x] 7.7 `README.md`·`openspec/specs/auto-trading.md`·`frontend-screens.md`에 한국 랭킹 전략 설명 반영.

## 8. 진입 구간별 예산·손절 분리 + 1분 폴링 보강

- [x] 8.1 `kr_rank_strategies` 스키마를 진입 구간별 컬럼으로 정정 — `morning_budget`/`lunch_budget`, `morning_target_profit_rate`/`morning_stop_loss_rate`, `lunch_target_profit_rate`/`lunch_stop_loss_rate`.
- [x] 8.2 `krRankService` 입력 검증·평가를 진입 구간별 매수 금액 한도(`min(구간 예산, 가용 현금)`)와 진입 구간별 목표 수익률·손절 기준으로 정정.
- [x] 8.3 한국 랭킹 전략 전용 1분 간격 스케줄러 타이머 추가(`KR_RANK_SCHEDULER_INTERVAL_MS`), 라오어 10분 타이머와 분리.
- [x] 8.4 1분 폴링 로그 폭주 방지 — idle tick은 KIS 호출 없이 종료, 스케줄러 HOLD/SKIP은 판단 로그 미기록(`touchEvaluation`).
- [x] 8.5 프론트엔드 — 진입 구간별 매수 금액·목표·손절 입력 폼, 점심 진입 체크박스 UI 크기 정정(`checkbox-field` 재사용).
- [x] 8.6 테스트·문서(proposal·design·specs·README·database-model) 진입 구간별 예산·손절·1분 폴링 반영.
