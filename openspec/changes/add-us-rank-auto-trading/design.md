## Context

자동매매 도메인은 현재 두 종류의 전략을 운용한다 — 라오어 무한매수법(`LAOR_INFINITE_V2`, `auto_trading_*` 테이블, 10분 스케줄러)과 한국 국장 상승률 랭킹(`KR_RANK_MOMENTUM`, `kr_rank_*` 테이블, 1분 스케줄러). 두 전략은 같은 `user_trading_settings.live_order_enabled` 스위치와 `kisAuthService`/`kisTradingService`를 공유하지만, 테이블·서비스·스케줄러 타이머·라우트·프론트 패널은 분리돼 있다.

이번 change는 **세 번째 전략 타입 `US_RANK_MOMENTUM`** 을 같은 패턴으로 추가한다. 핵심 차이:
- 시장은 미국 정규장(NYSE/NASDAQ), KIS 해외주식 API 사용.
- 한 거래일 안에서 **반복 회전 매매**: KR 랭킹은 진입 구간당 1회였지만, US 랭킹은 매도 후 곧바로 재매수.
- **하루 종료 트리거 두 가지**: 손절(-5%) 1회면 그날 신규 매수 중단, KST 04:30이면 강제 청산.
- DST(미국 서머타임) 자동 감지로 KST 23:30~06:00(겨울) 또는 22:30~05:00(여름) 정규장 시간 판정.

## Goals / Non-Goals

**Goals:**
- 미국 정규장 시간에 한 종목씩 반복 회전 매매하는 새 전략 종류 `US_RANK_MOMENTUM`.
- KR 랭킹·라오어와 독립적으로 생성·시작·종료·조회되는 자동매매 흐름.
- 매수 → +2% 익절 → 다음 매수 → ... 반복. 어느 매매든 -5% 손절이 한 번이라도 발생하면 그날 신규 매수 정지.
- KST 04:30 일률 청산 + 신규 매수 정지.
- DST 자동 감지(미국 동부 시각 변환).
- KIS 해외주식 등락률 상위 랭킹 → 첫 유효 1순위 종목 현재가 지정가 매수. 미국장은 가격제한폭이 없어 별도 상승률 상한 필터를 두지 않는다.
- 매수 금액 기본은 자동 예산(KIS 매수가능금액 전액). 고정 USD 금액 입력 옵션도 제공.
- 실주문 실행 설정·1분 스케줄러·안전 검증·멱등성·판단 로그·주문 이력 패턴을 KR 랭킹과 공유.

**Non-Goals:**
- 라오어·KR 랭킹 알고리즘·테이블·화면 변경.
- 자동 환전 — 한국 랭킹과 마찬가지로 사용자가 KIS 통합증거금/환전을 미리 처리해야 함.
- 프리마켓·애프터마켓(정규장 외) 매매.
- 다종목 동시 보유 — 한 전략은 한 시점에 한 종목만 보유.
- 동일 종목 왕복 매매 — 보유 종목이 현재 랭킹의 첫 유효 종목이면 익절 기준에 닿아도 매도하지 않는다.
- 백테스트 지원, 손절 후 회복(같은 날 다시 매수 시작).
- 주문 실패 자동 재시도 한도 초과 시 자동 복구.

## Decisions

### 1. 라오어·KR 테이블을 건드리지 않고 새 테이블 세트를 둔다

KR 랭킹과 동일한 근거: 기존 두 전략의 테이블·FK·인덱스에 분기를 끼워 넣으면 회귀 위험이 크다.

**결정**: 다음 다섯 테이블을 새로 만든다.
- `us_rank_strategies` — 전략 본체. status, 자동 예산 여부, 고정 매수 금액(USD), 익절 비율, 손절 비율, 강제 청산 시각(KST), 거래소 코드(NASDAQ/NYSE/AMEX 또는 전체), 통화, 누적 목표 수익률과 시작 기준 자본, 보유 정보, 오늘 잠금 여부(`day_locked_out`), 오늘 잠금 기준 거래일.
- `us_rank_trades` — **한 거래일 안의 매매 사이클 단위 기록**. KR 랭킹은 진입 구간당 1회였지만 US는 반복이라 진입 구간 개념 대신 "trade cycle"로 부른다. trade_date·trade_seq(그날 N번째 매매)·symbol·entry_price·exit_price·exit_reason(TARGET/STOP_LOSS/FORCE_CLOSE/CYCLE_COMPLETE)·profit_rate·status(`SELECTED`/`BOUGHT`/`CLOSED`/`FAILED`)를 저장.
- `us_rank_orders` — 주문 라이프사이클. `idempotency_key` 형식은 `{YYYYMMDD}-{strategyId}-{tradeSeq}-{BUY|SELL}`. sell_reason은 `TARGET`/`STOP_LOSS`/`FORCE_CLOSE`/`CYCLE_COMPLETE`.
- `us_rank_decision_logs` — 매 평가의 판단·trade_seq·랭킹/선택 종목·사유.
- `us_rank_locks` — `(strategy_id, lock_key) UNIQUE` 동시 평가 방지.

`user_trading_settings`, `kisAuthService`, `kisTradingService`, `autoTradingScheduler` 프로세스(타이머만 추가), 안전 검증 패턴은 공유한다.

*대안*: KR 랭킹 테이블을 `market` 컬럼으로 확장해 KR/US 공존 — 점심 진입 같은 KR 전용 필드와 trade_seq 같은 US 전용 필드가 서로 NULL 컬럼이 되고, 평가 분기가 한 서비스에 섞여 회귀 위험. 기각.

### 2. 미국 정규장 시간 + DST 자동 감지

미국 정규장은 ET 09:30~16:00. ET와 KST 시차는 표준시 14시간, DST 13시간이다.

| 시기 | ET 09:30~16:00 | KST |
|---|---|---|
| 표준시 (11월 첫째 일 ~ 3월 둘째 일) | UTC-5 | 23:30~06:00 (익일) |
| 서머타임 (3월 둘째 일 ~ 11월 첫째 일) | UTC-4 | 22:30~05:00 (익일) |

**결정**: `isUsRegularSession(now)`는 미국 동부 시각으로 변환해 `09:30 <= time < 16:00 && weekday`인지 판정한다. KST/UTC 직접 계산 대신 `now.toLocaleString('en-US', { timeZone: 'America/New_York' })`로 ET를 얻어 분 단위로 비교한다. DST는 OS의 IANA tz 데이터가 처리하므로 우리 코드에 DST 분기를 두지 않는다.

`isUsForceCloseTime(now, kstHhmm = '04:30')`은 KST로 변환한 시각이 `>= 04:30 && < 05:30`인지 검사한다(폴링 누락 방어로 1시간 윈도우). 단, `isUsRegularSession`이 false이면 false를 반환한다(장 외 트리거 방지). 사용자가 입력한 강제 청산 시각(`force_close_kst`, 기본 `04:30`)을 인자로 받는다.

미국 휴장일은 별도 캘린더가 없으면 알 수 없으므로 1차 출시에서는 검사하지 않는다 — KIS API가 휴장일에 가격을 0/오류로 돌려주면 자연스럽게 SKIP되도록 `evaluateEntryPath`에서 가격 0 가드만 둔다. Risk 절 참고.

*대안*: `node-cron`/`luxon` 의존 추가 — 외부 의존 최소화 원칙에 따라 표준 `Intl.DateTimeFormat` 기반으로 처리해 기각.

### 3. 1분 간격 전용 스케줄러

KR 랭킹과 같은 이유로 1분 폴링이 필요하다. 정규장 시작(23:30 KST 또는 22:30 KST)을 분 단위로 포착해야 한다.

**결정**: `autoTradingScheduler`에 세 번째 타이머 `usRankTimer`(환경변수 `US_RANK_SCHEDULER_INTERVAL_MS`, 기본 60초)를 추가한다. 라오어 10분·KR 1분과 독립.

장 외 SKIP은 KR 랭킹과 동일하게 `noLog: true`로 처리해 매분 폴링 노이즈를 방지한다. idle tick(무보유·장 외)은 KIS 호출 없이 일찍 종료한다.

### 4. KIS 해외 등락률 상위 랭킹 API

`KisMarketDataProvider`에 해외 등락률 순위 조회를 추가한다. 프로젝트 내 KIS 엑셀 문서 기준으로 다음 API를 사용한다.

- API명: 해외주식 상승율_하락율
- URL: `/uapi/overseas-stock/v1/ranking/updown-rate`
- TR ID: `HHDFS76290000`
- 주요 입력: `KEYB=''`, `AUTH=''`, `EXCD`(`NAS`/`NYS`/`AMS`), `GUBN='1'`(상승율)
- 주요 응답: `symb`(종목코드), `name`/`ename`(종목명), `last`(현재가), `rate`(등락률), `rank`(순위)

응답에서 종목코드·종목명·현재가·등락률·거래소를 정규화해 등락률 내림차순 리스트로 반환한다. 진입 시에는 가격·등락률·종목코드가 유효한 첫 종목을 그대로 선택한다. 미국주식은 한국처럼 가격제한폭이 없으므로 상승률 상한 필터를 두지 않는다.

선택 종목이 없으면 매수하지 않고 판단 기록을 남긴다. 랭킹 조회 자체가 실패하면 ERROR/SKIP로 기록하고 trade 행을 만들지 않아 다음 tick에서 재시도된다.

### 5. 반복 회전 매매 — Trade Cycle 모델

KR 랭킹은 `kr_rank_entries(strategy_id, trade_date, entry_window)` UNIQUE로 "구간당 1회"를 보장했다. US는 반복이라 다른 모델이 필요하다.

**결정**: `us_rank_trades` 테이블의 한 행 = 한 번의 매수~매도 사이클.
- 새 매매 사이클 시작 조건(`startNewCycle`):
  1. `day_locked_out = false` (오늘 손절 발생 없음, `day_locked_out_at`이 오늘 거래일이 아니면 새 거래일이라 자동 해제)
  2. `holding_symbol IS NULL` (보유 없음)
  3. `isUsRegularSession(now)` (정규장 중)
  4. 현재 KST 시각이 `force_close_kst` 이전 (예: 04:30 전)
- 매매 사이클 시작 시 `us_rank_trades` INSERT: `trade_seq = (오늘 최대 trade_seq + 1)`, status='SELECTED'. 종목·가격·랭킹 스냅샷도 같이 저장.
- 매수 성공: status='BOUGHT', `entry_price` 기록, 전략의 `holding_*` 업데이트.
- 매도 성공: status='CLOSED', `exit_price`·`exit_reason`·`profit_rate` 기록, 전략의 `holding_*` 클리어.
- exit_reason='STOP_LOSS'이면 `day_locked_out=true`, `day_locked_out_at=오늘`로 설정 — 그날 신규 매수 정지.
- exit_reason='FORCE_CLOSE'면 강제 청산이므로 day_locked_out 설정(다시 매수하지 않음).

멱등키는 `{YYYYMMDD}-{strategyId}-{tradeSeq}-{BUY|SELL}` — trade_seq가 매매 사이클을 구분한다.

`day_locked_out` 해제 타이밍: 다음 거래일 첫 평가에서 `day_locked_out_at`이 오늘이 아니면 자동으로 false로 본다(읽기 시점 판정, DB 업데이트는 새 매매 발생 시).

### 6. 매수 금액: 자동 예산 기본 + 고정 USD 옵션

**결정**: KR 랭킹의 `autoBudgetEnabled` 패턴을 그대로 적용한다.
- `auto_budget_enabled=true` (기본): 평가 시점 KIS 매수가능금액(USD, `frcr_ord_psbl_amt1`)을 그대로 한 종목에 투입.
- `auto_budget_enabled=false`: 사용자가 지정한 `fixed_buy_usd_amount`를 한도로 사용. min(fixed, cashAvailable)을 실제 한도로.

미국주식은 KIS 표준 주문이 정수 1주 단위라 1주 단위로 매수한다(소수점 매매 제외). 매수 수량 = floor(min(한도, cashAvailable) / currentPrice). 0주면 판단 기록만 남기고 SKIP.

### 7. 익절·손절·강제 청산 — 매도 사유 세 가지

`us_rank_orders.sell_reason` CHECK: `('TARGET', 'STOP_LOSS', 'FORCE_CLOSE', 'CYCLE_COMPLETE')`.

매도 판단(`evaluateSellPath` 변형):
1. profit_rate = (current - avg) / avg
2. 누적 목표 수익률이 설정되어 있고 총자산이 시작 기준 자본 대비 목표에 닿음 → SELL CYCLE_COMPLETE 후 전략 STOPPED
3. profit_rate <= -stop_loss_rate → SELL STOP_LOSS (기본 -5%, 매도 후 `day_locked_out=true`)
4. profit_rate >= target_profit_rate → 현재 랭킹 첫 유효 종목 확인. 보유 종목이 계속 1위이면 HOLD, 아니면 SELL TARGET
5. `isUsForceCloseTime(now, force_close_kst)` true → SELL FORCE_CLOSE (`day_locked_out=true`, 신규 매수 정지)
6. 위 조건이 모두 아니면 HOLD

KIS 미국 일반 매수 주문은 문서상 일반 시장가 주문이 아니라 지정가·LOO·LOC·TWAP·VWAP 중심으로 제공된다. 1차 구현은 KIS 표준 해외 주문 경로를 재사용해 현재가 지정가로 주문한다. 매도도 같은 주문 경로를 사용하되, 주문 상태와 미체결은 다음 tick에서 다시 확인한다.

### 8. 누적 목표 수익률 종료

사용자는 선택적으로 누적 목표 수익률을 설정할 수 있다. 전략 시작 시점의 USD 매수가능금액을 `cycle_baseline_usd`로 저장하고, 평가 시점 총자산(`cashAvailable + holdingQuantity * currentPrice`)이 기준 자본 대비 목표 수익률에 도달하면 사이클을 끝낸다. 보유 종목이 있으면 `CYCLE_COMPLETE` 사유로 정리한 뒤 전략을 `STOPPED`로 바꾸고, 무보유 상태라면 주문 없이 전략을 `STOPPED`로 바꾼다.

### 9. 실주문 실행 설정·안전 검증 재사용

`user_trading_settings.live_order_enabled` 그대로 사용. 안전 검증은 KR 랭킹과 동일 패턴 — 미체결 주문·중복 주문·주문 수량 0·매수가능금액 부족·보유 수량 부족을 평가 시 차단.

해외 주문은 라오어 미국 종목에서 이미 구현된 `placeOverseasOrder` 경로를 재사용한다(거래소 코드 정규화 포함).

### 10. 판단 로그·주문 이력·진입 기록 UI 패턴 재사용

KR 랭킹 패널을 본떠 `UsRankAutoTradingPanel.jsx`를 만든다 — 연결 계좌 패널(USD 매수가능금액), 전략 만들기 폼, 전략 목록 카드, 전략 상세 metric, 판단 로그 테이블(평가금액 컬럼 포함), 주문 이력 테이블(총 금액 컬럼 포함), 진입(매매 사이클) 기록 테이블. `AutoTradingPage`에 세 번째 탭 추가.

### 11. 휴장일·종목 비유효 시간 처리

미국 휴장일(추수감사절·크리스마스·노동절 등)은 별도 캘린더가 없으면 알 수 없다. KIS API가 휴장일에 등락률 응답을 빈 리스트로 돌려주면 `selectRankingCandidate`가 null을 반환해 자연스럽게 SKIP된다. 응답 자체가 오류면 그 tick은 ERROR로 기록되고 다음 tick 재시도(아무것도 안 사고 끝나는 정상 동작). 이 1차 방어가 충분하지 않다고 판단되면 후속 change에서 휴장일 캘린더 도입을 검토한다(Open Questions).

## Risks / Trade-offs

- **[DST 전환 직후 24~48시간 동안 KIS API가 새 시간대를 잘못 보고할 가능성]** → KIS는 미국 동부 거래소 시각 기준으로 가격을 응답하므로 한국 측 코드가 ET를 정확히 판정하면 영향 없음. `Intl.DateTimeFormat('America/New_York')`로 OS tz 데이터에 위임.
- **[손절 후 day_locked_out 상태에서 보유분이 남아 있고 강제 청산 시각 전에 회복하면 매도 안 함]** → 손절 매도는 보유분을 청산한 뒤 잠그는 것이라 보유 잔존은 없음. 단 매도 주문이 실패해 보유가 남으면 다음 tick에서 매도 재시도(주문 재시도 한도 ORDER_RETRY_LIMIT 적용). 한도 초과 시 보유 그대로 강제 청산 시각까지 대기.
- **[강제 청산 시각 04:30 직전에 매수가 들어가 즉시 청산되는 footgun]** → KR 랭킹의 청산 시각 검증과 동일한 가드: 매수 평가 시 `force_close_kst`까지 남은 시간이 1분 미만이면 신규 매수 SKIP. 그리고 새 매매 사이클 시작 조건에 "현재 시각 < force_close_kst" 포함.
- **[자동 예산 모드 + 5% 손절 후 day_locked_out 상태에서 KST 04:30 강제 청산 안 일어남]** → 보유 없으면 강제 청산도 노옵. 매수가 다음 날까지 정지될 뿐. 의도된 동작.
- **[1분 폴링으로 매번 KIS 호출이 늘어 rate limit 위험]** → idle tick(장 외, day_locked_out·보유 없음)은 KIS 호출 없이 일찍 종료. KR 랭킹과 동일한 패턴.
- **[같은 사용자가 라오어·KR·US 전략을 동시에 RUNNING]** → 모두 같은 KIS 계좌·현금을 공유하므로 가용 현금이 서로 영향. 각 전략은 평가 시점 매수가능금액 기준으로 판단하며 안전 검증이 잔액 부족을 차단. 자금 격리는 Non-Goal.
- **[KIS 해외 등락률 순위 API 응답 필드가 일부 계정·시장 상태에서 달라질 가능성]** → 엑셀 문서 기준 필드(`symb`, `name`/`ename`, `last`, `rate`)를 우선 사용하고, 일부 대체 필드도 방어적으로 읽는다. 필수 값이 없거나 등락률 파싱이 실패한 행은 제외한다.
- **[미국 휴장일에 매수 시도가 일어날 위험]** → 1차 방어는 KIS의 빈 응답·오류로 SKIP. 부족하면 후속 change.

## Migration Plan

1. 마이그레이션 SQL(`0029_us_rank_auto_trading.sql`)로 `us_rank_*` 테이블·인덱스 생성. 기존 테이블 ALTER 없음 → 롤백은 새 테이블 DROP.
2. 백엔드: `KisMarketDataProvider`에 해외 등락률 순위 조회 추가, `usRankStrategyEngine`/`usRankService`/`usRankRoutes`, `usRankRepository`, 1분 간격 전용 스케줄러 타이머 추가.
3. 프론트엔드: `UsRankAutoTradingPanel.jsx`, `AutoTradingPage`에 탭 추가, `api/client.js`에 US 랭킹 API 함수 추가.
4. 배포 후 실주문 OFF 상태로 정규장 시간에 진입 시도 → DRY_RUN 주문·trade 행이 정상 생성되는지 확인.
5. 사용자가 실주문 ON으로 전환해 실거래 검증. 첫날은 자동 예산을 끄고 작은 USD 금액으로 시작 권장.
6. 롤백: 프런트 탭 숨김 + US 라우트 비활성화 + 새 테이블 DROP. 기존 두 전략 경로는 처음부터 불변이라 영향 없음.

## Open Questions

- 강제 청산 시각(KST 04:30) 기본값이 미국 정규장 종료(KST 06:00 / 서머타임 05:00)보다 1시간 30분~30분 빠른데, 사용자가 종료 직전(예: KST 05:50)으로 더 미루고 싶을 수 있음. 폼 입력으로 받아 유연하게.
- 미국 휴장일을 명시적으로 다룰지 — 1차 출시는 KIS 응답에만 의존, 후속 change에서 결정.
- `day_locked_out` 해제 타이밍을 새 거래일 첫 평가로 잡았는데, "거래일"의 정의를 KST 기준(자정) vs ET 기준(미국 동부 자정) 중 무엇으로 할지. 정규장이 KST 자정을 가로지르므로 ET 거래일을 기준으로 잡는 게 자연스러움 — 구현 시 확정.
- 보유 종목이 현재 랭킹 1위일 때 익절 매도를 보류하는 규칙을 폼 옵션으로 노출할지. 현재는 기본 규칙으로 고정한다.
