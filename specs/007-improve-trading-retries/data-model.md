# Data Model: 증거 기반 랭킹 자동매매와 주문 복구

## `kr_rank_experiments`

고정된 shadow 후보 규칙의 버전과 승격 상태를 저장한다.

| 필드 | 의미 |
| --- | --- |
| `id`, `user_id`, `strategy_id` | 사용자 격리 식별자 |
| `version` | 파라미터가 바뀌면 증가하는 불변 버전 |
| `variant` | V0~V5 후보 식별자 |
| `parameters_json` | 고정 threshold와 비용/slippage 가정 |
| `mode` | `SHADOW`, `VALIDATION`, `FINAL_TEST`, `APPROVED`, `REJECTED` |
| `validation_started_at`, `frozen_at` | 누수 방지 경계 |
| `created_at`, `updated_at` | 감사 시각 |

Unique: `(user_id, strategy_id, version, variant)`.

## `kr_rank_shadow_signals`

30초 tick의 실제 관찰과 후보별 판정을 저장한다.

| 필드 | 의미 |
| --- | --- |
| `id`, `user_id`, `strategy_id`, `experiment_id` | 소유권과 실험 연결 |
| `trade_date`, `entry_window`, `observed_at` | 시간순 평가 키 |
| `ranking_snapshot` | 실제 market-wide top 30의 safe market data |
| `quote_snapshot` | 후보 현재가·등락률; 인증정보 없음 |
| `completed_candles` | 판단에 사용한 완성 분봉 |
| `candidate_symbol`, `signal_price` | 가상 진입 후보 |
| `decision` | `PASS`, `REJECT`, `NO_CANDIDATE`, `ERROR` |
| `reason_codes` | deterministic 필터 결과 |

Unique: `(experiment_id, trade_date, entry_window, observed_at)`.

## `kr_rank_virtual_trades`

shadow 신호 하나에서 파생된 가상 거래다.

| 필드 | 의미 |
| --- | --- |
| `id`, `user_id`, `strategy_id`, `experiment_id`, `signal_id` | 관계 키 |
| `symbol`, `entry_price`, `entry_at` | 진입 |
| `target_price`, `stop_price` | 고정 +2%/-5% 가격 |
| `exit_price`, `exit_at`, `exit_reason` | `TARGET`, `STOP`, `TIME`, `AMBIGUOUS_STOP_FIRST` |
| `gross_pnl`, `cost`, `net_pnl`, `return_rate` | 성과 |
| `phase` | `TRAIN`, `VALIDATION`, `FINAL_TEST` |

한 실험은 한 구간에서 최대 한 virtual trade를 갖는다.

## 기존 `kr_rank_orders` / `us_rank_orders`

기존 상태를 유지하되 다음 불변조건을 서비스 계층에서 보장한다.

- retry는 직전 attempt와 lineage로 연결된다.
- `UNKNOWN`은 조회로 해소되기 전 terminal retry 대상이 아니다.
- `ACCEPTED`는 position mutation의 근거가 아니다.
- 전략 관리 수량과 외부 주문/잔고를 섞지 않는다.
- 취소 완료 전 replacement POST를 금지한다.

## 상태 전이

```text
REQUESTED
├─ 명시적 비일시 미접수 ─> REJECTED ─> 최신 신호 확인 ─> 새 REQUESTED (한도 내)
├─ 응답 불명확 ─────────> UNKNOWN ─> KIS 조회 ─┬─ ACCEPTED/PARTIALLY_FILLED
│                                                ├─ FILLED
│                                                └─ 미접수 확정 ─> REJECTED
└─ 주문번호 접수 ───────> ACCEPTED ─> PARTIALLY_FILLED ─> FILLED

ACCEPTED/PARTIALLY_FILLED ─> 취소 요청 ─> CANCELED 확인 ─> replacement 허용
```
