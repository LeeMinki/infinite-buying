## Context

자동매매 도메인은 현재 라오어 무한매수법 단일 종목 전략(`LAOR_INFINITE_V2`)만 운용한다. `auto_trading_strategies`/`auto_trading_orders`/`auto_trading_decision_logs`/`auto_trading_position_snapshots`/`auto_trading_locks` 테이블과 `autoTradingScheduler`(고정 10분 간격 tick), `autoTradingSafetyGuard`, `user_trading_settings.live_order_enabled`(사용자당 1행), `kisAuthService`/`kisTradingService`(KIS 토큰·잔고·매수가능금액·주문)가 핵심 구성요소다.

이번 change는 성격이 다른 단타형 전략 — 한국 국장 장중 등락률 상위 종목을 정해진 시각에 진입해 목표 수익·손절로 빠르게 청산 — 을 같은 화면 안의 별도 탭으로 추가한다. 라오어 전략의 알고리즘·테이블·화면은 건드리지 않는 것이 강한 제약이다.

## Goals / Non-Goals

**Goals:**
- 라오어 전략과 독립적으로 생성·시작·종료·조회되는 새 전략 종류 `KR_RANK_MOMENTUM`.
- 오전 9시 10분 진입 + 선택적 11시 30분 점심 진입, 각 진입 하루 1회·진입 구간당 매수 1회.
- KIS 국내주식 등락률 순위 API 연동, 등락률 30% 이상 제외 후 첫 종목 선택.
- 실주문 실행 설정·스케줄러·안전 검증·멱등성 패턴을 라오어 전략과 공유.
- 진입 구간·매도 사유·실주문 여부를 구분한 기록.

**Non-Goals:**
- 라오어 전략 알고리즘·테이블·화면 변경.
- 미국주식 랭킹 전략, 백테스트 지원, 다종목 동시 보유.
- 자동 환전, 1주 미만(소수점) 한국주식 매수 — 한국주식은 정수 1주 단위.
- 주문 실패 자동 재시도.

## Decisions

### 1. 라오어 테이블을 건드리지 않고 새 테이블 세트를 둔다

`auto_trading_strategies` 등 기존 테이블은 LAOR 전제(분할 회차·회차당 금액·NOT NULL 컬럼)에 묶여 있고, 자식 테이블 FK가 `auto_trading_strategies(id)`를 가리킨다. 여기에 다른 종류의 전략 행을 끼워 넣으면 LAOR 평가 경로·인덱스·FK에 영향이 갈 위험이 있다.

**결정**: 라오어 테이블은 그대로 두고, 동일한 패턴(상태 머신, 멱등키, 락, 판단/주문/스냅샷 기록)을 따르는 새 테이블 세트를 만든다.
- `kr_rank_strategies` — 전략. status(`CREATED`/`RUNNING`/`STOPPED`/`ERROR`), 총 예산, 목표 수익률, 손절률, 점심 진입 사용 여부, 점심 목표 수익률, started/stopped/last_evaluated.
- `kr_rank_entries` — 일자별·진입 구간별 진입 기록. `UNIQUE(strategy_id, trade_date, entry_window)`로 "하루 1회·진입 구간 1회"를 DB 차원에서 보장. 선택 종목, 매수 여부(`bought`), 랭킹 스냅샷 참조.
- `kr_rank_orders` — 주문 라이프사이클. 최초 생성 시에는 `idempotency_key` UNIQUE였으나, 이후 `0026_round_model_and_retry.sql`에서 실패 주문 재시도를 위해 UNIQUE 제약을 제거하고 인덱스로 바뀌었다. side·entry_window·sell_reason 포함.
- `kr_rank_decision_logs` — 매 평가의 판단·진입 구간·랭킹/선택 종목·사유.
- `kr_rank_locks` — `(strategy_id, lock_key) UNIQUE` 동시 평가 방지.

기존 자동매매의 **구조(패턴)는 최대한 재사용**하되 테이블만 분리한다. `user_trading_settings.live_order_enabled`, `kisAuthService`, `kisTradingService`, `autoTradingSafetyGuard`(또는 동등 검증), `autoTradingScheduler`는 공유한다.

*대안*: `auto_trading_strategies`에 `strategy_type` 컬럼을 추가해 한 테이블에 공존 — 재사용도는 높지만 LAOR NOT NULL 컬럼/FK/평가 쿼리에 종류 분기가 침투해 라오어 전략 회귀 위험이 커 기각.

### 2. 한국 랭킹 전략은 1분 간격 전용 스케줄러로 평가한다

라오어 전략 스케줄러는 기본 10분 간격이라 "정확히 09:10" 진입을 보장하지 못한다. 단타형 진입은 시각 정확도가 중요하다.

**결정**: 한국 랭킹 전략에 **1분 간격 전용 스케줄러**(`KR_RANK_SCHEDULER_INTERVAL_MS`, 기본 60초)를 둔다. 라오어 10분 스케줄러와 별도 타이머로 독립 동작한다. 진입은 여전히 **시각이 아니라 진입 구간(window)** 으로 다룬다 — 오전 09:10~10:00, 점심 11:30~12:20. tick이 돌 때 (a) 전략이 RUNNING, (b) 현재 시각이 진입 구간 안, (c) 그 날짜·구간의 `kr_rank_entries` 행이 아직 없음 — 세 조건이 맞으면 진입을 1회 실행하고 `kr_rank_entries` 행을 만든다. UNIQUE 제약이 중복 tick·동시 tick에서도 진입을 1회로 묶는다. 1분 간격이면 진입이 09:10 직후 1분 안에 실행되고, 랭킹 조회가 일시 실패해도 구간 안에서 여러 번 재시도된다.

매도 판단은 진입 구간과 무관하게 RUNNING이고 보유분이 있으면 매 tick(1분) 평가한다(목표 수익/손절 도달 시 전량 매도).

**1분 폴링의 로그 폭주 방지**: 1분 tick마다 HOLD/SKIP 판단 로그를 남기면 하루 1,440건이 쌓인다. 따라서 스케줄러의 HOLD·SKIP은 판단 로그를 만들지 않고 마지막 평가 시각만 갱신하며, 의미 있는 이벤트(BUY·SELL·ERROR)와 사용자가 직접 누른 평가만 로그로 남긴다. 또 무보유·진입 구간 밖 같은 idle tick은 KIS 토큰·API 호출 없이 일찍 종료한다.

*대안*: 별도 cron 트리거 — 인프라 추가 부담, 기존 스케줄러 프로세스에 타이머만 추가하면 충분해 기각.

### 3. KIS 국내주식 등락률 순위 API

`KisMarketDataProvider`에 등락률 순위 조회를 추가한다 — KIS 국내주식 `등락률 순위`(`/uapi/domestic-stock/v1/ranking/fluctuation`, trId `FHPST01700000`, 상승률 정렬). 응답에서 종목코드·종목명·현재가·등락률을 정규화해 등락률 내림차순 리스트로 반환한다. 진입 시 등락률 ≥ 30% 종목을 제외하고 남은 첫 종목을 선택한다. 선택 종목이 없으면 매수하지 않고 판단 기록만 남긴다. 랭킹 조회 자체가 실패하면 그 tick은 ERROR/SKIP로 기록하고 진입 행을 만들지 않아 다음 tick(같은 구간 내)에서 재시도된다.

### 4. 진입 구간별 매수 금액 한도 안에서 가용 현금 최대 사용

전략은 진입 구간별로 매수 금액(`morning_budget`, `lunch_budget`)을 따로 갖는다. 점심 진입을 켜면 하루 두 번 매수하므로 오전·점심 자금을 분리해야 한다. 매수 수량 = `floor(min(해당 구간 매수 금액, KIS 매수가능금액) / 현재가)`. 0주면 매수하지 않고 판단 기록만 남긴다. 한국주식이므로 정수 1주 단위, 환전 불필요.

목표 수익률·손절 기준도 진입 구간별로 따로 입력받는다(`morning_target_profit_rate`/`morning_stop_loss_rate`, `lunch_target_profit_rate`/`lunch_stop_loss_rate`). 보유분의 매도 판단은 그 보유분을 만든 진입 구간(`holding_entry_window`)의 목표·손절을 적용한다. 점심 진입이 꺼져 있으면 `lunch_*` 값은 사용하지 않는다.

### 5. 진입 구간당 매수 1회 — 매도해도 재매수 없음

`kr_rank_entries.bought`가 true면 같은 (날짜, 구간)에서 다시 매수하지 않는다. 매수 후 익절/손절로 청산해도 그 구간은 종료된 것으로 본다. 다음 매수 기회는 다음 진입 구간(점심) 또는 다음 거래일 오전이다.

### 6. 중복 주문 방지 / 멱등성

라오어와 같은 방식: `makeKrRankIdempotencyKey({tradeDate, strategyId, entryWindow, side})` → `{YYYYMMDD}-{strategyId}-{window}-{BUY|SELL}`. 현재 `kr_rank_orders.idempotency_key`는 UNIQUE가 아니라 조회 인덱스이며, service 레이어가 같은 키의 `FAILED` 아닌 주문 존재 여부와 실패 재시도 한도를 검사한다. 평가 시작에 `kr_rank_locks`로 락 획득, 미체결 주문이 있으면 신규 주문 금지.

### 7. 실주문 실행 설정 재사용

`user_trading_settings.live_order_enabled`를 그대로 읽는다. 꺼짐: 랭킹 조회·종목 선택·판단·`DRY_RUN` 주문 예정 기록까지 동일하게 진행, KIS 주문 API만 호출하지 않음. 켜짐: 안전 검증 통과 주문만 KIS로 전송.

## Risks / Trade-offs

- **[스케줄러 tick 간격이 진입 구간보다 넓으면 진입 누락]** → 한국 랭킹 전략 전용 1분 스케줄러로 평가하고, 진입 구간 폭(오전 50분·점심 50분)을 tick 간격보다 훨씬 넓게 잡아 진입을 반드시 포착한다.
- **[1분 폴링으로 KIS 호출·판단 로그가 과다해질 위험]** → idle tick(무보유·진입 구간 밖)은 KIS 호출 없이 종료하고, 스케줄러 HOLD/SKIP은 로그를 남기지 않는다(Decision 2).
- **[KIS 등락률 순위 API의 정확한 응답 필드/상한가 표기]** → 구현 시 실제 응답으로 필드 매핑 검증, 등락률 파싱 실패 종목은 후보에서 제외. Open Question 참조.
- **[테이블 분리로 자동매매 기록 UI가 두 갈래]** → 화면도 탭으로 분리되므로 UI 일관성에는 문제 없음. 공통 조회 로직은 헬퍼로 공유.
- **[장 시작 직후 등락률 상위는 변동성·체결 위험이 큼]** → 30% 이상 제외 규칙이 1차 방어. 손절률을 필수 입력으로 둬 하방을 제한.
- **[같은 사용자가 라오어·KR 전략을 동시에 RUNNING]** → 두 전략이 같은 계좌·현금을 공유하므로 가용 현금이 서로 영향. 각 전략은 평가 시점 매수가능금액을 기준으로 판단하며, 안전 검증이 잔액 부족을 차단. 자금 격리는 Non-Goal.

## Migration Plan

1. 새 마이그레이션 SQL(`00xx_kr_rank_auto_trading.sql`)로 `kr_rank_*` 테이블·인덱스 생성. 기존 테이블 ALTER 없음 → 라오어 전략 무영향, 롤백은 새 테이블 DROP.
2. 백엔드: 등락률 순위 조회, `krRankStrategyEngine`/`krRankService`/`krRankRoutes`, 1분 간격 전용 스케줄러 타이머 추가.
3. 프론트엔드: `AutoTradingPage`에 전략 종류 탭, KR 전략 생성·대시보드 UI.
4. 배포 후 실주문 OFF 상태로 DRY_RUN 진입·기록 동작 확인 → 이후 사용자가 실주문 ON.
5. 롤백: 프런트 탭 숨김 + KR 라우트 비활성화 + 새 테이블 DROP. 라오어 경로는 처음부터 불변이라 영향 없음.

## Open Questions

- KIS 국내주식 등락률 순위 API의 정확한 trId·필수 입력값(시장 구분 KOSPI/KOSDAQ/전체, 정렬·등락 구분)과 응답 필드명 — 구현 단계에서 KIS 문서/실응답으로 확정.
- "등락률 30% 이상 제외"의 기준: 진입 시점 실시간 등락률 기준으로 확정(가격제한폭 근접 종목 회피 목적).
- 매수 금액·목표 수익률·손절 기준은 진입 구간별(오전/점심)로 사용자가 따로 입력한다. 점심 진입이 꺼져 있으면 점심 값은 입력받지 않는다.
