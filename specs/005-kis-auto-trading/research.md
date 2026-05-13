# Research: KIS Auto Trading

## Decision: Keep KIS as the direct trading integration

**Rationale**: 004 intentionally simplified the app to a single KIS provider. 005 should extend that same path for trading so automatic trading can reuse existing KIS credentials, token handling, symbol search, and price lookup without adding a broker abstraction.

**Alternatives considered**:

- Add a generic BrokerTradingService interface: rejected because the current product scope is KIS-only and abstraction would slow implementation.
- Keep trading dry-run only: rejected because 005 explicitly requires live order execution when the user enables it.

## Decision: Introduce `KisTokenManager` on top of existing KIS auth behavior

**Rationale**: Current KIS auth logic already encrypts persisted tokens and caches valid tokens in memory. Automatic trading requires the same behavior outside a user page request. A dedicated manager clarifies that scheduled evaluation can acquire tokens by `userId` without exposing token values.

**Alternatives considered**:

- Use only request-time auth service: rejected because scheduled evaluation must work while the user is not connected.
- Store raw token in memory only: rejected because restart would require immediate token reissue for every user and current storage already encrypts tokens safely.

## Decision: Default live order execution to disabled and audit all changes

**Rationale**: Automatic trading can create real financial loss. Every user must explicitly opt in, and the app must provide an audit trail for setting changes. When disabled, the same evaluation path records DRY_RUN orders, making behavior visible before live enablement.

**Alternatives considered**:

- Global environment flag only: rejected because users must control the setting from the web UI.
- Strategy-level live setting only: rejected because a user-wide kill switch is simpler and safer for this phase.

## Decision: Use whole-share quantities for automatic live trading

**Rationale**: The 005 spec states automatic BUY quantity is `floor(buyAmountPerRound / currentPrice)`. KIS overseas product information may indicate fractional availability, but live fractional order paths have different constraints and are not necessary for this phase.

**Alternatives considered**:

- Allow fractional quantities for overseas live trading: deferred because it requires confirming separate KIS fractional order capabilities and edge cases.
- Reuse backtest fractional logic: rejected because backtest assumptions are not equivalent to live order constraints.

## Decision: Build `KisTradingService` with domestic/overseas branching inside the service

**Rationale**: KIS uses different trading endpoints and TR IDs for domestic and overseas markets. Keeping branching inside one service gives the rest of automatic trading a normalized interface.

**Local KIS reference checked**: `KIS/한국투자증권_오픈API_전체문서_20260512_030000.xlsx`

Important sheets:

- Domestic balance: `주식잔고조회`, TR `TTTC8434R`, URL `/uapi/domestic-stock/v1/trading/inquire-balance`
- Domestic buying power: `매수가능조회`, TR `TTTC8908R`, URL `/uapi/domestic-stock/v1/trading/inquire-psbl-order`
- Domestic sellable quantity: `매도가능수량조회`, TR `TTTC8408R`, URL `/uapi/domestic-stock/v1/trading/inquire-psbl-sell`
- Domestic cash order: `주식주문(현금)`, buy `TTTC0012U`, sell `TTTC0011U`, URL `/uapi/domestic-stock/v1/trading/order-cash`
- Domestic order/fill history: `주식일별주문체결조회`, TR `TTTC0081R`, URL `/uapi/domestic-stock/v1/trading/inquire-daily-ccld`
- Domestic open amend/cancel candidates: `주식정정취소가능주문조회`, TR `TTTC0084R`, URL `/uapi/domestic-stock/v1/trading/inquire-psbl-rvsecncl`
- Overseas balance: `해외주식 잔고`, TR `TTTS3012R`, URL `/uapi/overseas-stock/v1/trading/inquire-balance`
- Overseas buying power: `해외주식 매수가능금액조회`, TR `TTTS3007R`, URL `/uapi/overseas-stock/v1/trading/inquire-psamount`
- Overseas open orders: `해외주식 미체결내역`, TR `TTTS3018R`, URL `/uapi/overseas-stock/v1/trading/inquire-nccs`
- Overseas order/fill history: `해외주식 주문체결내역`, TR `TTTS3035R`, URL `/uapi/overseas-stock/v1/trading/inquire-ccnl`
- Overseas order: `해외주식 주문`, US buy `TTTT1002U`, US sell `TTTT1006U`, URL `/uapi/overseas-stock/v1/trading/order`

**Alternatives considered**:

- Implement only overseas trading first: rejected because spec requires Korean/US difference handled internally.
- Expose separate domestic/overseas APIs to frontend: rejected because strategy UI should stay symbol/market based.

## Decision: SafetyGuard runs before any real order and returns a structured outcome

**Rationale**: Live order path must be auditable and deterministic. The guard centralizes status checks, open-order checks, duplicate checks, buying power, sellable quantity, and live-order setting behavior.

**Alternatives considered**:

- Inline safety checks in AutoTradingService: rejected because it makes testing individual failure paths harder.
- Rely on KIS rejection for unsafe orders: rejected because the app must avoid sending known-bad orders.

## Decision: Use idempotency keys and strategy locks for duplicate prevention

**Rationale**: Scheduled and manual evaluations can overlap. A per-strategy lock prevents concurrent evaluations, and unique idempotency keys prevent duplicate order records if the process retries or races around persistence.

**Alternatives considered**:

- Lock only in memory: rejected because a single process restart or future multi-process deployment would lose state.
- Unique order key only: rejected because it prevents duplicate records but still allows duplicate KIS calls in a race before persistence.

## Decision: Treat uncertain market-session status as SKIP

**Rationale**: Placing orders outside valid market windows can cause broker errors or unexpected behavior. If the app cannot confidently determine that trading is allowed, it should log SKIP and avoid orders.

**Alternatives considered**:

- Always evaluate regardless of session: rejected because the spec requires SKIP when market status is uncertain.
- Hard-code only US regular market hours: rejected because the app supports domestic and overseas symbols and KIS has different session rules.

## Decision: Throttle and retry KIS read calls to stay under per-second rate limits

**Rationale**: KIS는 계정별 초당 거래건수 제한(예: `EGW00201 초당 거래건수를 초과하였습니다`)을 적용한다. 자동매매 한 화면을 그리기 위해 현재가·잔고·매수가능금액·미체결을 거의 동시에 발사하면 같은 1초에 4건이 몰려 손쉽게 한도를 넘긴다. 두 단계로 방어한다.

- **사용자별 호출 간격 큐**: `KisTradingService` 안에 사용자 단위 직렬화 큐를 둬 호출 사이 최소 220ms 간격을 강제한다. 일반 계정 5건/초 한도(=200ms) 아래에 안전 마진을 둔다.
- **일시 오류 backoff 재시도**: `EGW00201`, `EGW*` 계열, HTTP 429/5xx 같은 일시 오류는 400ms → 900ms → 1800ms 의 backoff 로 최대 3회 재시도. 주문(POST) API는 멱등성을 보장하기 어려우니 재시도하지 않는다.
- **호출 직렬화**: `getAccountSummary` 같이 한 작업에 4개 KIS 호출이 필요한 경우 `Promise.all` 대신 순차 `await` 으로 burst 를 줄인다.

**Alternatives considered**:

- 단순히 한 번에 재시도: rate limit 이 풀리기 전에 또 보내면 같은 에러가 반복되어 효과가 없음.
- 전역(글로벌) 큐: 다중 사용자 환경에서 한 사용자가 다른 사용자의 호출을 차단해 불공정.
- KIS 응답 캐시: 자동매매 평가는 최신값이 필요해 단순 캐시는 부적합. 다만 `getAccountSummary` 결과를 짧은 TTL(예: 2~3초)로 한 번 더 캐시하는 것은 후속 작업으로 남겨둠.

## Decision: No automatic retry after order failure

**Rationale**: Retrying financial orders can create duplicate exposure if the first response is ambiguous. Failures are recorded and require the next scheduled/manual evaluation or user inspection.

**Alternatives considered**:

- Retry transient failures automatically: rejected for safety.
- Retry only token failures: handled before order request through token manager; order request failures are not retried.
