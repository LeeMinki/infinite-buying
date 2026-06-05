# 주문 / 체결 / 포지션 기록

## 책임

자동매매 평가에서 생성된 주문, 그 체결 상태 갱신, 평가 시점의 포지션 스냅샷, 그리고 (구) 가상 주문(`/api/orders`, `/api/strategies/:id`) 이력을 기록·조회한다.

## 자동매매 주문 (`auto_trading_orders`)

`migrations/0017_auto_trading.sql` 정의. 주요 필드:

- `user_id`, `strategy_id`, `symbol`, `market`, `currency`
- `side`: `BUY` / `SELL`
- `quantity`, `order_price`, `estimated_amount`
- `kis_order_no`, `kis_original_order_no`
- `status`: `DECIDED` / `DRY_RUN` / `REQUESTED` / `ACCEPTED` / `REJECTED` / `PARTIALLY_FILLED` / `FILLED` / `CANCELED` / `FAILED` / `UNKNOWN`
- `filled_quantity`, `remaining_quantity`, `average_filled_price`
- `idempotency_key` — `{YYYYMMDD}-{strategyId}-{half}` 형식. `0026`에서 UNIQUE 제약을 제거해 같은 키의 `FAILED` 주문은 제한 재시도할 수 있게 했고, 중복 차단은 service 레이어의 `hasNonFailedOrder`/`countFailedOrders`가 담당한다.
- `half` (`migrations/0021`) — `FIRST` / `AVG` / `BIG` / `SELL`. 한 평가에서 `AVG`·`BIG` 두 주문이 생길 수 있다
- `decision_log_id` (`migrations/0021`, references `auto_trading_decision_logs(id)`) — 한 결정과 그 결정이 만든 주문(들)의 1:N 연결
- `decision_reason`, `live_order_enabled`
- `request_payload_masked`, `response_payload_masked` — 민감 필드 마스킹 후 저장
- `error_message`

상태 전이 (정상 흐름):

```
liveOrderEnabled=false → DRY_RUN (종료 상태)
liveOrderEnabled=true → REQUESTED → ACCEPTED → PARTIALLY_FILLED → FILLED
                                              ↘ CANCELED (자동 취소 또는 KIS에서 취소)
                                              ↘ REJECTED / FAILED / UNKNOWN
```

## 주문 갱신

- `POST /api/auto-trading/orders/:id/refresh` — KIS 주문/체결 조회로 상태를 갱신해 로컬에 반영.
- 자동매매 평가가 다음 tick에 다시 돌면, 미체결 행들에 대해 `kis_order_no`를 가지고 KIS에 조회·갱신할 수 있다 (구현 흐름은 `kisTradingService` + `autoTradingService.refreshOrder`).

## 자동 취소

실주문 모드에서 평가 시작 직전에 우리 시스템이 만든 미체결 주문을 KIS 정정취소 API로 자동 취소한다. 상세는 [auto-trading.md](auto-trading.md) "평가 사이클" 4번 참고.

- 국내: TR `TTTC0013U`, `RVSE_CNCL_DVSN_CD=02`, `QTY_ALL_ORD_YN=Y`
- 해외: TR `TTTT1004U`, `RVSE_CNCL_DVSN_CD=02`, `OVRS_EXCG_CD` 포함

성공 시 로컬에 `CANCELED`로 마킹하고 `decision_reason`에 cancel 노트가 추가된다.

## 판단 로그 (`auto_trading_decision_logs`)

매 평가마다 기록된다. 컬럼: 시간, 결정(`BUY`/`SELL`/`HOLD`/`SKIP`/`ERROR`), 평가 출처(`MANUAL`/`SCHEDULED`), 현재가, 평단가, 목표 매도가(`target_sell_price`), 목표가까지의 비율(`distance_to_target_rate`), 미체결 주문 수(`open_order_count`), 예상 수량/금액, 연결된 `order_id`, 사유 등. 컬럼 추가는 `migrations/0018_auto_trading_decision_extras.sql`.

## 포지션 스냅샷 (`auto_trading_position_snapshots`)

평가 시점에 KIS에서 조회한 보유 수량·평단·현재가·평가금·미실현 손익·현금을 저장. `decision` 컬럼(`migrations/0019`)으로 그 시점의 판단(BUY/SELL/HOLD/SKIP/ERROR/COMPLETED 등)을 함께 보관해 UI에 배지로 노출.

## 일일 사용량 (`daily_order_limit_usages`)

`(user_id, strategy_id, trade_date)` UNIQUE. 과거에는 1회·일일 주문 한도 검사에 사용되었으나, 현재 해당 검사는 SafetyGuard에서 제거되었다. 컬럼은 호환을 위해 0으로 유지될 뿐 의사결정에 영향을 주지 않는다.

## 구(舊) 가상 주문 / 평가 로그

`strategies` / `holdings` / `virtual_orders` / `decision_logs` 4개 테이블은 초기 MVP에서 사용된 가상 주문/판단 흐름의 산출물이다. 라우트는 그대로 유지:

| Method | Path |
| --- | --- |
| POST | `/api/strategies` |
| GET | `/api/strategies` |
| GET/PUT/DELETE | `/api/strategies/:id` |
| GET | `/api/strategies/:id/holding` |
| POST | `/api/strategies/:id/evaluate` |
| GET | `/api/strategies/:id/orders` |
| GET | `/api/strategies/:id/logs` |
| POST | `/api/orders/:id/fill` |
| POST | `/api/orders/:id/cancel` |

서비스: `strategiesService.js`, `virtualOrdersService.js`. 현재 메인 화면의 "공통 전략 초안" UI도 이 `strategies` 테이블을 사용해 백테스트·자동매매 입력값을 미리 채워주는 상태를 저장한다.
