# 데이터베이스 모델

SQLite (`better-sqlite3`). 마이그레이션은 `backend/src/db/migrations/0001~0020`. 실행: `npm run migrate`.

모든 도메인 테이블은 `user_id` 컬럼을 가지며 `ON DELETE CASCADE`로 사용자 삭제 시 정리된다.

## 인증·세션

- `users` — `id, email (UNIQUE, NOCASE), password_hash, created_at, updated_at` (`0001`)
- `sessions` — `express-session` + `better-sqlite3-session-store`가 자동 관리.

## KIS 자격증명

- `kis_credentials` — `user_id UNIQUE`, masked App Key, 암호화 App Key/App Secret/access token/계좌번호/계좌상품코드, 토큰 만료, 상태(`NOT_CONFIGURED`/`CONFIGURED`/`TOKEN_VALID`/`TOKEN_ERROR`), 마지막 토큰 발급 시각, 마지막 에러 메시지 (`0012`).

## 시장 데이터 캐시

- `market_price_cache` — `(user_id, market, symbol, date) UNIQUE`. `open / high / low / close / volume / currency / source`. 현재 source는 `KIS_API` (`0013`).

## (구) 가상 주문 / 전략 초안

- `strategies` — 전략 초안. 종목, 총 예산, 분할 회차, 목표 수익률, 큰수 매수 여유율(`big_buy_premium_rate`, `0020`).
- `holdings` — 가상 보유.
- `virtual_orders` — 가상 주문.
- `decision_logs` — 가상 평가 로그.
- `user_id` 컬럼 추가 마이그레이션은 `0002`.

> 정확한 컬럼 목록은 초기 마이그레이션(0001 이전에 만들어졌을 가능성)을 본 baseline에서 확인하지 못했다. **구현 확인 필요**: `strategies` / `holdings` / `virtual_orders` / `decision_logs`의 컬럼 정의 원본 파일.

## 백테스트

- `backtest_runs` — 종목, 기간, 총 예산, 분할 회차, 목표 수익률, 알고리즘(`LAOR_INFINITE_V2`), 초기 lump 비율(레거시), 일일 금액(레거시), 큰수 매수 여유율, 상태(`RUNNING`/`COMPLETED`/`FAILED`), 결과 지표 (`0008` → `0014~0016`에서 컬럼 확장 및 REAL 변환 → `0020`).
- `backtest_trades` — 거래일별 BUY/SELL/HOLD/COMPLETED, 가격, 수량, 회차, 현금, 평단, 손익, 평가금, 총자산, drawdown, reason (`0009`).

## 자동매매 (`0017~0025`)

- `user_trading_settings` — 사용자당 1행. `live_order_enabled` (0/1).
- `user_trading_setting_histories` — 실주문 설정 변경 이력.
- `auto_trading_strategies` — 자동매매 전략. status (`CREATED`/`RUNNING`/`STOPPED`/`ERROR`), 종목·시장·통화·`exchange`(거래소 코드, `0025`), 총 예산, 분할 회차, 회차당 매수 금액, 목표 수익률, 현재 회차, (레거시) 1회·일일 주문 한도, `big_buy_premium_rate`, started/stopped/last_evaluated/last_order_at, last_decision, last_error_message.
- `auto_trading_position_snapshots` — 평가 시점 보유 수량·평단·현재가·평가금·미실현·현금 + `decision` (그 시점의 판단).
- `auto_trading_orders` — 주문 라이프사이클. `idempotency_key` UNIQUE. `exchange`(거래소 코드, `0025`).
- `auto_trading_decision_logs` — 매 평가의 결정·평가 출처·target_sell_price·distance_to_target_rate·open_order_count·order_id·reason.
- `auto_trading_locks` — `(strategy_id, lock_key) UNIQUE`. 동시 평가 방지.
- `daily_order_limit_usages` — `(user_id, strategy_id, trade_date) UNIQUE`. 한도 검사는 현재 비활성, 호환 컬럼만 유지.

## 한국 국장 상승률 랭킹 자동매매 (`0024`)

라오어 자동매매(`auto_trading_*`)와 분리된 별도 테이블 세트. 실주문 실행 설정(`user_trading_settings`)만 공유한다.

- `kr_rank_strategies` — 한국 국장 상승률 랭킹 전략(`KR_RANK_MOMENTUM`). status (`CREATED`/`RUNNING`/`STOPPED`/`ERROR`), 진입 구간별 매수 금액·목표 수익률·손절률(`morning_*`/`lunch_*`), 점심 진입 사용 여부, 현재 보유 종목(`holding_symbol`/`holding_symbol_name`/`holding_entry_window`, 무보유면 NULL), started/stopped/last_evaluated_at, last_decision, last_error_message.
- `kr_rank_entries` — 일자별·진입 구간별 진입 기록. `(strategy_id, trade_date, entry_window) UNIQUE`로 "하루 1회·진입 구간당 1회" 보장. 선택 종목·등락률·랭킹 스냅샷·`bought` 플래그.
- `kr_rank_orders` — 주문 라이프사이클. `idempotency_key` UNIQUE. side·entry_window·sell_reason(`TARGET`/`STOP_LOSS`) 포함.
- `kr_rank_decision_logs` — 매 평가의 결정·진입 구간·선택 종목·매도 사유·랭킹 스냅샷·평가 출처·order_id·reason.
- `kr_rank_locks` — `(strategy_id, lock_key) UNIQUE`. 동시 평가 방지.

## 미국 국장 상승률 랭킹 자동매매 (`0029`)

라오어 자동매매(`auto_trading_*`)와 한국 랭킹(`kr_rank_*`)을 변경하지 않는 별도 테이블 세트. 실주문 실행 설정(`user_trading_settings`)과 KIS credential만 공유한다.

- `us_rank_strategies` — 미국 국장 상승률 랭킹 전략(`US_RANK_MOMENTUM`). status, 자동 예산 여부, 고정 매수 금액(USD), 익절률, 손절률, 등락률 상한, 강제 청산 시각(KST), 거래소(`ALL`/`NAS`/`NYS`/`AMS`), 통화(`USD`), 현재 보유 종목, 당일 신규 매수 잠금(`day_locked_out`)과 잠금 사유.
- `us_rank_trades` — 한 번의 매수~매도 사이클 기록. `(strategy_id, trade_date, trade_seq) UNIQUE`로 미국 거래일 안의 N번째 사이클을 구분한다. 선택 종목, 랭킹 스냅샷, 진입가/수량, 청산가/사유, 수익률, 상태를 저장한다.
- `us_rank_orders` — 주문 라이프사이클. `idempotency_key`, side, sell_reason(`TARGET`/`STOP_LOSS`/`FORCE_CLOSE`), 수량, 단가, 예상 금액, KIS 주문번호, 마스킹된 요청/응답, 에러 메시지.
- `us_rank_decision_logs` — 매 평가의 결정, 선택 종목, 현재가, 보유 수량, 매수가능금액, 예상 주문, 랭킹 스냅샷, 평가 출처, order_id, 사유.
- `us_rank_locks` — `(strategy_id, lock_key) UNIQUE`. 동시 평가 방지.

## 인덱스 요약

각 도메인 테이블의 `(user_id, ...)` 시작 복합 인덱스가 정의되어 있다 (예: `idx_auto_trading_strategies_user_status`, `idx_backtest_runs_user_symbol`). 상세는 각 마이그레이션 SQL 참고.
