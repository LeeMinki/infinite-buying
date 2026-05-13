# Feature Specification: KIS Auto Trading

**Feature Branch**: `005-kis-auto-trading`
**Created**: 2026-05-12
**Status**: Ready for planning
**Input**: 사용자가 선택한 종목에 대해 자동매매 전략을 만들고 시작/종료하며, 실주문 실행 설정이 꺼진 상태에서는 DRY_RUN 기록만 남기고 켜진 상태에서는 미체결·중복·매수가능금액·보유 수량 검사를 통과한 주문만 한국투자증권(Korea Investment & Securities Co., Ltd., 이하 KIS)을 통해 실행한다.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Control Live Order Setting (Priority: P1)

로그인한 사용자는 자동매매에서 실제 주문을 실행할지 여부를 명확하게 켜고 끌 수 있다. 설정이 꺼져 있으면 자동매매는 계속 판단하지만 실제 주문은 절대 발생하지 않고 DRY_RUN 기록만 남긴다.

**Why this priority**: 실제 돈이 걸린 기능이므로 사용자가 주문 가능 상태를 명확히 통제하는 것이 전체 기능의 전제다.

**Independent Test**: 사용자가 자동매매 설정 화면에서 실주문 실행을 켜고 끈 뒤, 설정 상태와 변경 이력이 저장되는지 확인한다. 설정이 꺼진 상태에서 평가를 실행해 실제 주문 없이 DRY_RUN 주문과 판단 로그만 생성되는지 확인한다.

**Acceptance Scenarios**:

1. **Given** 실주문 실행 설정이 꺼진 사용자, **When** 자동매매 평가가 BUY 또는 SELL을 판단하면, **Then** 실제 주문 없이 DRY_RUN 주문 기록과 판단 로그가 저장된다.
2. **Given** 사용자가 실주문 실행 설정을 변경할 때, **When** 설정 저장이 완료되면, **Then** 새 설정과 변경 이력이 사용자별로 저장된다.
3. **Given** 다른 사용자가 실주문 실행 설정을 조회할 때, **When** 직접 식별자를 조작해도, **Then** 현재 로그인 사용자의 설정만 확인할 수 있다.

---

### User Story 2 - Create and Run an Auto Trading Strategy (Priority: P1)

로그인한 사용자는 종목을 검색해 자동매매 대상 종목을 선택하고, 총 예산·분할 회차·목표 수익률·큰수 매수 여유율을 입력해 자동매매 전략을 생성한 뒤 시작하거나 종료할 수 있다.

**Why this priority**: 사용자가 자동매매 대상과 전략 조건을 명확히 정의하고 RUNNING/STOPPED 상태를 직접 제어해야 자동매매 기능의 핵심 가치가 생긴다.

**Independent Test**: KIS 설정을 완료한 사용자가 종목 검색으로 종목을 선택하고 전략을 생성한 뒤 시작한다. 전략 상태가 RUNNING으로 바뀌고, 종료하면 STOPPED가 되며 이후 자동 평가 대상에서 제외되는지 확인한다.

**Acceptance Scenarios**:

1. **Given** KIS 설정을 완료한 사용자, **When** 종목 검색 결과를 선택하고 자동매매 전략을 생성하면, **Then** 전략은 CREATED 상태로 저장되고 종목·시장·통화·예산·위험 한도를 표시한다.
2. **Given** CREATED 또는 STOPPED 전략, **When** 사용자가 자동매매 시작을 누르면, **Then** 전략은 RUNNING 상태가 되고 다음 평가 대상에 포함된다.
3. **Given** RUNNING 전략, **When** 사용자가 자동매매 종료를 누르면, **Then** 전략은 STOPPED 상태가 되고 이후 자동 평가 대상에서 제외된다.
4. **Given** STOPPED 전략에 이미 접수된 주문이 있을 때, **When** 사용자가 전략을 종료해도, **Then** 기존 주문은 자동 취소되지 않고 미체결 상태로 화면에 표시된다.
5. **Given** 사용자가 메인 화면에서 공통 전략 초안을 만든 상태, **When** 전략 상세에서 백테스트 또는 자동매매로 이동하면, **Then** 종목, 예산, 분할 회차, 목표 수익률이 해당 화면 입력값으로 전달된다.

---

### User Story 3 - Evaluate Strategy and Record Decisions (Priority: P1)

실행 중인 자동매매 전략은 사용자가 웹에 접속해 있지 않아도 서버에서 주기적으로 평가된다. 평가는 현재가, 잔고, 매수가능금액, 미체결 주문 상태를 확인하고 BUY / SELL / HOLD / SKIP / ERROR 중 하나를 기록한다.

**Why this priority**: 자동매매는 사용자의 브라우저가 열려 있지 않아도 지속적으로 동작해야 하며, 모든 판단 근거가 추적 가능해야 한다.

**Independent Test**: RUNNING 전략을 만든 뒤 사용자가 로그아웃한 상태에서도 평가가 생성되는지 확인한다. 현재가·보유수량·평균단가·현금·판단·사유·포지션 스냅샷이 사용자별로 저장되는지 확인한다.

**Acceptance Scenarios**:

1. **Given** RUNNING 전략과 유효한 KIS 설정, **When** 평가 시각이 되면, **Then** 현재가·잔고·매수가능금액·미체결 주문을 조회하고 포지션 스냅샷과 판단 로그를 저장한다.
2. **Given** KIS access token이 없거나 만료된 상태, **When** 자동매매 평가가 시작되면, **Then** 저장된 KIS 설정으로 token을 발급 또는 갱신하고 평가를 계속한다.
3. **Given** token 발급 또는 계좌 조회가 실패한 상태, **When** 평가가 실행되면, **Then** 실제 주문 없이 ERROR 또는 SKIP 판단을 저장하고 사용자에게 안전한 오류 메시지를 표시한다.
4. **Given** 장 운영 시간이 아니거나 판단이 불확실할 때, **When** 평가가 실행되면, **Then** 주문 없이 SKIP 판단을 기록한다.

---

### User Story 4 - Execute Safe Live Orders (Priority: P2)

실주문 실행 설정이 켜진 사용자는 미체결·중복·매수가능금액·보유 수량 검사를 통과한 경우에만 KIS 주문으로 실제 매수 또는 매도를 실행할 수 있다. 주문 결과와 상태는 자동매매 주문 기록에 저장된다.

**Why this priority**: 실제 주문은 자동매매의 확장 가치이지만, 주문 전 검사와 추적성이 먼저 보장되어야 한다.

**Independent Test**: 실주문 실행 설정을 켜고 RUNNING 전략을 평가한다. 미체결 주문 없음, 중복 주문 없음, 매수가능금액 또는 보유수량 충분 조건이 모두 만족될 때만 주문이 접수되고 결과가 기록되는지 확인한다.

**Acceptance Scenarios**:

1. **Given** 실주문 실행 설정이 켜져 있고 BUY 판단이 발생한 전략, **When** 매수가능금액이 충분하고 주문 전 검사를 모두 만족하면, **Then** 실제 매수 주문을 요청하고 주문 결과를 저장한다.
2. **Given** 실주문 실행 설정이 켜져 있고 SELL 판단이 발생한 전략, **When** 보유 수량이 충분하고 주문 전 검사를 통과하면, **Then** 실제 매도 주문을 요청하고 주문 결과를 저장한다.
3. **Given** 미체결 주문이 존재하는 전략, **When** 평가가 BUY 또는 SELL을 판단하면, **Then** 신규 주문을 차단하고 SKIP 판단과 차단 사유를 저장한다.
4. **Given** 주문 수량이 0이거나 계좌 매수가능금액 또는 보유 수량이 부족한 판단, **When** 평가가 실행되면, **Then** 실제 주문 없이 HOLD 또는 SKIP을 저장한다.

---

### User Story 5 - Monitor Orders, Positions, and Dashboard (Priority: P2)

사용자는 자동매매 대시보드와 전략 상세 화면에서 실행 상태, 실주문 설정, 최근 판단, 주문 이력, 미체결 주문, 포지션 스냅샷, 수익률, 오류 상태를 확인할 수 있다.

**Why this priority**: 자동매매는 투명성이 중요하며 사용자가 현재 앱이 무엇을 하고 있는지 빠르게 확인할 수 있어야 한다.

**Independent Test**: 자동매매 전략을 실행하고 몇 차례 평가한 뒤 대시보드와 상세 화면에서 최근 판단 로그, 주문 상태, 포지션 스냅샷, 오류 전략, 오늘 주문 금액이 표시되는지 확인한다.

**Acceptance Scenarios**:

1. **Given** 자동매매 평가 이력이 있는 사용자, **When** 대시보드를 열면, **Then** 실주문 설정 상태, RUNNING 전략 수, 최근 판단, 최근 주문, 오류 전략, 오늘 주문 금액, 최근 포지션 스냅샷을 볼 수 있다.
2. **Given** 주문 기록이 있는 전략, **When** 사용자가 주문 상태 새로고침을 실행하면, **Then** KIS 주문·체결·미체결 정보를 반영해 체결 수량, 잔량, 평균 체결가, 상태를 갱신한다.
3. **Given** 실주문 실행 설정이 켜져 있고 전략이 선택된 사용자, **When** 자동매매 화면을 열면, **Then** 계좌번호 원문 없이 매수가능금액, 보유 수량, 평균단가, 미체결 주문 수를 볼 수 있다.
4. **Given** RUNNING 전략, **When** 서버가 정상 동작 중이면, **Then** 최소 10분에 한 번 현재가, 보유 수량, 평균단가, 매수가능금액, 회차, 미체결 주문 수, 실주문 설정이 포함된 판단 로그가 저장된다.
5. **Given** 다른 사용자의 전략 또는 주문 식별자, **When** 현재 사용자가 직접 요청하면, **Then** 해당 데이터는 없는 것처럼 처리된다.

### Edge Cases

- KIS token 발급 실패 또는 만료 갱신 실패 시 실제 주문은 실행하지 않고 ERROR 또는 SKIP 로그를 저장한다.
- KIS 호출이나 token 발급 실패로 사용자에게 오류를 보여줄 때, 응답의 안전한 필드(`msg_cd`, `msg1`, HTTP 상태 코드)는 함께 표시해 원인 파악을 돕는다. `access_token`, `appsecret`, 계좌번호 원문 등 비밀 값은 절대 노출하지 않는다.
- KIS는 계정별 초당 거래건수 제한(예: `EGW00201`)을 적용한다. 시스템은 같은 사용자에 대한 조회성 KIS 호출 사이에 최소 간격(약 220ms)을 두고, EGW00201/EGW 계열/429/5xx 같은 일시 오류는 짧은 backoff 후 최대 3회까지 재시도한다. 주문(POST) API는 재시도하지 않는다.
- 동일한 자동매매 평가/계좌 조회에서 발생하는 여러 KIS API 호출은 같은 초에 몰아 발사하지 않고 순차 실행해 rate limit 충돌 위험을 줄인다.
- KIS 현재가, 잔고, 매수가능금액, 미체결 주문 조회 중 일부가 실패하면 주문을 중단하고 실패한 항목을 판단 로그에 남긴다.
- 미체결 주문이 하나라도 있으면 신규 주문을 생성하지 않는다.
- 같은 전략이 동시에 두 번 평가되어도 중복 주문이 생성되지 않아야 한다.
- 동일 전략의 같은 날짜, 같은 방향, 같은 판단에 대해 중복 주문이 생성되지 않아야 한다.
- 주문 수량이 0이면 주문하지 않고 HOLD 또는 SKIP으로 기록한다.
- 매수가능금액이 부족하면 BUY 주문을 차단하고 사유를 기록한다.
- 매도 가능 수량이 부족하면 SELL 주문을 차단하고 사유를 기록한다.
- (removed) 과거 명세에는 "1회 주문 한도 / 일일 주문 한도 초과 시 주문 차단" 항목이 있었다. 본 기능에서는 사용자가 굳이 설정하지 않아도 되는 노이즈로 판단되어 폼/입력값/SafetyGuard 검사에서 모두 제거되었다. 기존 DB 컬럼은 호환을 위해 0으로 채워 둔다.
- 장 운영 시간이 아니거나 장 운영 여부를 확신할 수 없으면 SKIP으로 기록한다.
- 자동매매 종료는 이미 접수된 주문을 자동 취소하지 않으며 미체결 주문을 계속 표시한다.
- secret, token, 계좌번호 원문이 오류 메시지나 화면, 로그에 노출되지 않아야 한다.
- KIS 설정의 계좌번호 또는 계좌 상품코드가 비어 있으면 자동매매 계좌 조회는 안전한 오류 메시지를 반환하고, 사용자에게 KIS 설정 화면에서 값을 채워달라고 안내한다.
- 자동매매 전략 삭제는 RUNNING 상태에서도 가능하되, RUNNING 삭제 시 다음 평가가 중단된다는 점과 이미 접수된 KIS 주문은 자동 취소되지 않는다는 점을 명시적으로 한 번 더 확인받아야 한다.
- 해외 종목 자동매매 안내 문구는 특정 외화(USD 등)를 고정 표기하지 않고 선택된 전략의 결제 통화를 동적으로 사용한다.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST require login for every auto trading screen and action.
- **FR-002**: Users MUST be able to view and update their own live order execution setting.
- **FR-003**: The system MUST default live order execution to off for every user until the user explicitly enables it.
- **FR-004**: The system MUST record every live order execution setting change with previous value, new value, user, and change time.
- **FR-005**: Users MUST be able to search and select a tradable symbol for an auto trading strategy.
- **FR-006**: Users MUST be able to create, view, update, start, stop, and manually evaluate their own auto trading strategies.
- **FR-007**: Auto trading strategies MUST store symbol, optional symbol name, market, currency, status, total budget, split count, per-round buy amount, target profit rate, max buy-above-average rate, current round, last evaluation time, last order time, last decision, and last error. The legacy per-order-limit and daily-order-limit columns are retained in the database schema for migration safety, but they are no longer surfaced in the strategy form, no longer validated by SafetyGuard, and not part of the strategy creation/update API contract.
- **FR-008**: Strategy status MUST support CREATED, RUNNING, STOPPED, and ERROR.
- **FR-009**: Only RUNNING strategies MUST be evaluated automatically.
- **FR-010**: STOPPED strategies MUST be excluded from automatic evaluation.
- **FR-011**: The system MUST continue evaluating RUNNING strategies while the user is not connected to the website, as long as the service is running.
- **FR-012**: The system MUST manage KIS access token expiry per user and automatically issue, reuse, or renew tokens for automatic evaluation.
- **FR-013**: If token issue or renewal fails, the system MUST not place orders and MUST record ERROR or SKIP with a safe message.
- **FR-014**: The system MUST NOT expose raw KIS App Secret, access token, or account number to users or browser responses.
- **FR-015**: The system MUST NOT write raw KIS App Secret, access token, or account number into application logs or user-visible errors.
- **FR-016**: Each evaluation MUST retrieve or derive current price, holding quantity, average price, cash available, and open order state before deciding whether to trade.
- **FR-017**: Each evaluation MUST save a position snapshot containing symbol, market, currency, quantity, average price, current price, evaluation amount, unrealized profit, unrealized profit rate, optional cash available, source, and captured time.
- **FR-018**: Each evaluation MUST save a decision log with decision, price, position values, expected quantity, expected price, expected amount, live order setting, reason, time, target sell price (computed from `averagePrice × (1 + targetProfitRate)`), distance-to-target rate (how far the current price is from the target sell price as a signed ratio), open order count at evaluation time, evaluation source (`SCHEDULED` for scheduler runs, `MANUAL` for user-triggered evaluations), and a back-link to the generated order id when one was created.
- **FR-019**: The decision outcome MUST be one of BUY, SELL, HOLD, SKIP, or ERROR.
- **FR-020**: A SELL decision MUST be produced when holding quantity is greater than zero and current price is at least average price multiplied by one plus target profit rate.
- **FR-021**: A SELL decision MUST target the full available holding quantity.
- **FR-022**: If SELL conditions are not met, the system MUST evaluate BUY opportunities from the per-round buy amount.
- **FR-022a**: If the strategy already has holdings and average price is available, BUY evaluation MUST split the per-round buy amount into two halves. The average-price half is eligible when the current price is at or below average price. The big-number half is eligible when the current price is at or below `previousCloseOrKisBasePrice × (1 + bigBuyPremiumRate)`. The default `bigBuyPremiumRate` is 0.1, meaning the big-number half can buy up to 10% above the previous close or KIS base price. Backtests use the daily previous close and daily close; auto-trading uses KIS current price and the KIS previous close/base price when available. The two halves are evaluated independently — both, one, or neither may match. When only one half matches, the strategy buys only that half-budget worth and the remaining half MUST stay in the strategy's cash pool (no special carry-forward bookkeeping; the leftover naturally counts toward the next evaluation's KIS buying-power check).
- **FR-022b**: A SELL decision MUST stop the current evaluation. The system MUST NOT create a same-day or same-evaluation BUY after a target SELL; the next BUY evaluation starts from the next scheduled/manual evaluation or next backtest trading day.
- **FR-023**: BUY quantity MUST be calculated from the eligible buy budget divided by current price. For domestic (KR) symbols the result MUST be floored to whole shares. For non-domestic symbols the result MUST be kept as a fractional quantity (up to 6 decimal places) so a strategy with an eligible budget smaller than one share's price still produces a BUY decision rather than perpetual HOLD. The actual broker order submission step, not the strategy decision, is responsible for any whole-share rounding required by the chosen KIS endpoint.
- **FR-024**: If calculated BUY quantity is zero, the system MUST record HOLD and MUST NOT create an actual order request.
- **FR-025**: If all split rounds are used, the system MUST record HOLD unless a SELL condition is met.
- **FR-026**: The system MUST use KIS balance values as the primary source for holding quantity and average price.
- **FR-027**: Internal order and fill records MAY be used as supporting context but MUST NOT override fresher KIS balance values.
- **FR-028**: When live order execution is off and a BUY or SELL decision occurs, the system MUST create a DRY_RUN order record without calling the broker order function.
- **FR-029**: When live order execution is on, the system MUST run safety validation before any real order request.
- **FR-030**: Safety validation MUST block orders unless the strategy is RUNNING, no open order exists, no duplicate order exists for the same strategy/date/side/decision, quantity is positive, and account capacity is sufficient (cash for BUY, sellable quantity for SELL). When live order execution is on and the selected market is non-domestic and the calculated BUY quantity is less than one whole share, safety validation MUST block the real order with a user-readable message explaining that the KIS standard overseas order endpoint requires whole shares and that fractional buying needs the KIS 소수점매수 service. DRY_RUN records keep the fractional quantity for transparency.
- **FR-031**: BUY safety validation MUST confirm cash or buying power is sufficient.
- **FR-032**: SELL safety validation MUST confirm sellable quantity is sufficient.
- **FR-033**: Blocked orders MUST be recorded as SKIP decision logs with a user-readable reason.
- **FR-034**: Real order requests MUST record order side, quantity, order price, estimated amount, broker order identifier when available, original order identifier when available, status, idempotency key, decision reason, live order setting, safe masked request details, safe masked response details, errors, and timestamps.
- **FR-035**: Order status MUST support DECIDED, DRY_RUN, REQUESTED, ACCEPTED, REJECTED, PARTIALLY_FILLED, FILLED, CANCELED, FAILED, and UNKNOWN.
- **FR-036**: Users MUST be able to list their own auto trading orders and view a single order detail.
- **FR-037**: Users MUST be able to refresh a single order state, including filled quantity, remaining quantity, average filled price, and status.
- **FR-038**: The automatic evaluator MUST use a per-strategy lock so one strategy is not evaluated concurrently.
- **FR-039**: Automatic evaluation failures MUST be isolated so one failed evaluation does not stop the whole app.
- **FR-040**: The system MUST provide a dashboard summary containing live order setting, running strategy count, recent decisions, recent orders, error strategies, today's used order amount, and recent position snapshots.
- **FR-041**: Every auto trading setting, history row, strategy, position snapshot, order, decision log, lock, and daily order usage record MUST be scoped to the current user.
- **FR-042**: Users MUST NOT be able to view or mutate another user's auto trading strategy, order, position, decision log, setting, or usage data.
- **FR-043**: The user interface MUST show an account summary for the selected strategy in both record mode and live-order mode without exposing the raw account number, so the user can verify their KIS connection before turning on real orders.
- **FR-044**: The account summary MUST include cash or buying power, holding quantity, average price, and open order count when KIS returns those values, plus a clear indicator of whether the displayed numbers will be used to send real orders (live-order mode) or only for reference (record mode).
- **FR-045**: The user interface MUST clearly show when live order execution is off with wording equivalent to "기록 모드" and "주문은 전송하지 않습니다".
- **FR-046**: The user interface MUST clearly show when live order execution is on and actual orders may be placed after safety validation.
- **FR-046a**: The user interface MUST explain safety validation in plain language as checks for open orders, duplicate orders, buying power, holding quantity, and positive order quantity.
- **FR-046b**: For strategies whose market is not domestic (KR), the user interface MUST display a plain-language guide explaining that the broker does not auto-convert the home currency at order time, and that the user must either enroll in KIS integrated-margin or pre-exchange to settlement currency before automatic orders can succeed. The guide MUST NOT hard-code a specific foreign currency name (e.g., "USD") and MUST NOT phrase the explanation as if it were specific to one strategy's settlement currency; it explains the broker's general home-currency-to-foreign-currency rule.
- **FR-046c**: The user interface MUST allow the user to delete an existing auto-trading strategy from the strategy list, confirm the action (with an extra warning when the strategy is RUNNING), and remove all related decision logs, position snapshots, orders, locks, and daily order usage rows for that strategy.
- **FR-046d**: For overseas strategies, the account summary MUST surface both the current foreign-currency buying power (KIS `frcr_ord_psbl_amt1` or equivalent) and the "after FX conversion" buying power (KIS `echm_af_ord_psbl_amt`), along with the applied FX rate (KIS `exrt`). When the current foreign-currency buying power is 0 but the after-FX value is positive, the UI MUST explain that the user can either enroll in KIS integrated-margin or pre-exchange to make that amount available for automatic orders.
- **FR-046f**: The "최근 포지션" (latest position snapshot) UI MUST include a plain-language description that clarifies the snapshot is the captured state at the moment of the last evaluation (not real-time KIS data) and is used to track how the strategy's holdings have evolved over evaluation cycles. The snapshot MUST also surface the decision (BUY / SELL / HOLD / SKIP / ERROR / COMPLETED) that the auto-trading evaluator produced at the same moment, so the user can immediately tell what action accompanied that snapshot. Each `auto_trading_position_snapshots` row therefore stores the matching decision string, populated during the evaluation that wrote the snapshot. When no snapshot has been captured yet, the empty state MUST guide the user to start the strategy or press the "지금 평가" button.
- **FR-046g**: The decision log UI MUST include a helper sentence explaining that `SCHEDULED` rows are produced by the background scheduler and `MANUAL` rows are produced by user-triggered manual evaluations, and explaining how to read the "목표가까지" (distance-to-target) column: 0% or negative means the target sell price has been reached, and a positive percentage is the remaining upside required.
- **FR-046j**: The auto-trading algorithm explanation panel MUST list buy conditions BEFORE the sell condition, since buying is the more frequent and primary action under the cost-averaging strategy. The reordered narrative flow is: (1) what is checked each evaluation, (2) the two buy halves (평단가 매수, 큰수 매수), (3) how the buy quantity is calculated, (4) the sell condition that overrides everything, (5) live-order safety checks. The panel MUST also note that an unmatched half stays as cash and that there is no automatic cancel of unfilled KIS orders.
- **FR-046h**: The auto-trading page layout MUST allocate full page width to the strategy detail panel so its metric grid stays readable instead of collapsing into a column of single-line cells. The strategy list is rendered as a horizontal card group (chips) directly above the strategy detail panel; the detail panel uses the same horizontal width as the other auto-trading panels (전략 만들기, 연결 계좌 등). The chips wrap onto multiple rows on narrow viewports.
- **FR-046i**: The auto-trading strategy creation form MUST present its fields in a clean, balanced grid. The stock-search field always spans the full row, the numeric inputs (총 예산, 분할 회차, 목표 수익률, 큰수 매수 여유율) line up consistently, and the submit button anchors a final row on the right. The layout MUST stay consistent after the removal of the 1회/일일 주문 한도 fields.
- **FR-046j**: The backtest and auto-trading screens MUST show an algorithm guide in plain Korean. The guide MUST explain how the seed is split, how the average-price half and big-number half are bought, how target selling works, and that a target SELL does not trigger another BUY on the same day/evaluation.
- **FR-046e**: The auto-trading strategy creation form MUST, after the user selects a symbol, fetch the current KIS buying power for that symbol/market and offer one-click options to set the strategy's total budget to the available foreign-currency balance or the after-FX equivalent. The user MUST still be free to type any total budget manually; the recommendation never auto-overwrites the input.
- **FR-047**: The auto-trading screen MUST NOT reuse the backtest profit-guarantee notice as its primary warning copy; live-order copy must focus on order transmission and account safety checks.
- **FR-048**: RUNNING strategies MUST produce an initial start log and then produce scheduled decision logs at least every 10 minutes while the backend process is running.
- **FR-049**: Decision logs MUST include the checked current price, holding quantity, average price, cash or buying power, current round, open order count, live order setting, and a user-readable decision reason when those values are available.
- **FR-050**: Fees, taxes, exchange-rate precision, and slippage MUST be excluded from this feature's strategy calculation.
- **FR-051**: Automatic strategy stop MUST NOT automatically cancel already submitted orders.
- **FR-051a**: When evaluating a strategy in live-order mode, before SafetyGuard runs, the system MUST attempt to auto-cancel any KIS orders that *this auto-trading system* previously submitted for the same strategy and are still open (`REQUESTED`, `ACCEPTED`, `PARTIALLY_FILLED`, `UNKNOWN`). Cancellation uses KIS 정정취소 endpoints (domestic `TTTC0013U` `/uapi/domestic-stock/v1/trading/order-rvsecncl`, US overseas `TTTT1004U` `/uapi/overseas-stock/v1/trading/order-rvsecncl`) with `RVSE_CNCL_DVSN_CD=02` (cancel). Each successfully canceled order MUST be marked `CANCELED` in `auto_trading_orders` with a safe reason and the masked KIS response. Orders the system did not create (user-placed via KIS HTS/MTS) MUST never be canceled by this flow. In DRY_RUN mode (live-order off) no cancellation is attempted; the existing SafetyGuard open-order block applies as before.
- **FR-051b**: After auto-cancel attempts, the system MUST re-fetch open orders from KIS and pass the refreshed list to SafetyGuard. If KIS still reports open orders (e.g., external orders not owned by the system, or KIS has not yet reflected cancellation), SafetyGuard's open-order check still blocks the new order and records SKIP with the cancel attempt notes appended to the decision reason.
- **FR-052**: Open orders MUST be visible in the strategy detail screen.
- **FR-053**: The main strategy draft MUST be reusable as initial input for backtest and auto-trading strategy creation so the three areas do not feel disconnected.
- **FR-054**: User-facing UI copy SHOULD label internal DRY_RUN order records as "모의 주문 기록" or an equivalent Korean phrase instead of exposing the raw technical status.

### Key Entities *(include if feature involves data)*

- **UserTradingSetting**: User-owned setting that indicates whether real broker orders may be executed for auto trading.
- **UserTradingSettingHistory**: Audit trail of live order execution setting changes.
- **AutoTradingStrategy**: User-owned automatic trading plan for one selected symbol, including status, budget, split count, target profit rate, current round, order limits, and recent state.
- **AutoTradingPositionSnapshot**: Point-in-time record of the account position and current price used during evaluation.
- **AutoTradingOrder**: Record of a decided, dry-run, requested, accepted, rejected, filled, canceled, failed, or unknown order.
- **AutoTradingDecisionLog**: User-visible record of each strategy evaluation and its reason.
- **AutoTradingLock**: Short-lived coordination record that prevents concurrent evaluation of the same strategy.
- **DailyOrderLimitUsage**: Per-day usage record used to enforce maximum daily order amount.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of new users start with live order execution disabled.
- **SC-002**: Users can enable or disable live order execution and see the updated state within 2 seconds.
- **SC-003**: 100% of live order setting changes create a history record with previous and new values.
- **SC-004**: Users can create an auto trading strategy from a searched symbol in under 2 minutes after KIS setup is complete.
- **SC-005**: Users can start or stop an auto trading strategy and see the status change within 2 seconds.
- **SC-006**: RUNNING strategies produce decision logs during automatic evaluation without requiring the user's browser to remain open.
- **SC-007**: When live order execution is disabled, 100% of BUY and SELL decisions create DRY_RUN records and 0 real orders.
- **SC-008**: When live order execution is enabled, 100% of real order attempts pass safety validation before submission.
- **SC-009**: Duplicate concurrent evaluations for the same strategy do not create duplicate real orders.
- **SC-010**: Strategies with open orders create no new real orders until the open order state is resolved.
- **SC-011**: (removed) The per-order and daily order limits feature was removed from this iteration. Account capacity (cash for BUY, sellable quantity for SELL) and the duplicate/open-order checks remain the primary safeties.
- **SC-012**: Users can refresh an order and see current fill status, remaining quantity, and average fill price when available.
- **SC-013**: Users can view recent decisions, orders, positions, and error strategies from the dashboard in under 3 seconds.
- **SC-014**: Cross-user access attempts for strategies, orders, decisions, settings, and snapshots return no other user's data.
- **SC-015**: No raw App Secret, access token, or account number appears in browser responses or user-visible errors.
- **SC-016**: When a strategy is selected, its account summary (or a safe account lookup error) appears within 3 seconds regardless of whether live order execution is on or off; the displayed mode label changes between record mode and live-order mode based on the current setting.
- **SC-016a**: Users can delete an existing auto-trading strategy from the strategy list and see the row disappear within 2 seconds, with related decision logs, position snapshots, orders, locks, and daily order usage rows removed as part of the same operation.
- **SC-016b**: For overseas strategies, the account summary shows both the current foreign-currency buying power and the after-FX buying power along with the applied FX rate within 3 seconds of selecting a strategy. When current foreign-currency buying power is 0 and after-FX buying power is positive, the UI explains that the user can either enroll in KIS integrated-margin or pre-exchange before automatic orders can place real fills.
- **SC-016c**: When the user selects a symbol in the auto-trading strategy creation form, one-click recommended-budget options based on the current KIS buying power appear within 3 seconds. Users can apply a recommendation to the total budget input or ignore it and type their own value.
- **SC-017**: After a strategy starts, users can see an immediate start log and subsequent scheduled logs containing checked price/account/settings context at least every 10 minutes.
- **SC-018**: A strategy draft created on the main screen can prefill the backtest and auto-trading forms without retyping symbol, budget, split count, and target rate.

## Assumptions

- Existing login, user isolation, KIS credential storage, symbol search, current price lookup, and backtest foundations are reused.
- Users have already completed any KIS account setup required for trading before enabling live order execution.
- If required account identifiers are missing, the app blocks live order execution and asks the user to complete KIS settings.
- The default split count is 40 and the default target profit rate is 10%.
- The default max buy-above-average rate is 0%, meaning additional buys are allowed at or below average price unless the user explicitly allows buying above average price.
- Per-round buy amount is calculated from total budget divided by split count.
- Automatic evaluation interval defaults to 10 minutes; outside known open sessions the safe behavior is SKIP.
- This feature uses whole-share order quantities for automatic live trading.
- Stopping a strategy means no future evaluations, not cancellation of already submitted orders.
- Deleting a strategy removes all local rows for that strategy (decision logs, snapshots, orders, locks, daily order usage) but does not cancel already submitted broker orders.
- Account-summary lookups are allowed in both record mode and live-order mode so users can verify the KIS connection before turning on real orders. Live-order mode does not gate read access, only real-order submission via SafetyGuard.
- Non-domestic strategies (market other than KR) assume the user has either enrolled in KIS integrated-margin (so the home-currency balance is virtually added to the settlement-currency buying power via the foreign-margin lookup) or has pre-exchanged enough settlement-currency cash. The app does not initiate FX conversions on its own.
- Fees, taxes, exchange rates, and slippage are intentionally excluded from this feature's calculations.
