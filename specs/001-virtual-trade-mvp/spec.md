# Feature Specification: Infinite Buying Strategy Assistant MVP

**Feature Branch**: `001-virtual-trade-mvp`  
**Created**: 2026-04-28  
**Status**: Draft  
**Input**: User description: "React + Node.js + SQLite 기반의 무한매수 스타일 전략 보조 웹앱 MVP를 만든다."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Create And Evaluate A Strategy (Priority: P1)

A single user creates a strategy for one stock, records the budget and split-buying rules, then evaluates the strategy against the latest available market price to receive a buy, sell, hold, or pause decision without placing a real order.

**Why this priority**: This is the core product value. Without strategy creation and decision evaluation, the app does not serve its primary purpose.

**Independent Test**: Can be fully tested by creating a strategy, entering or retrieving a current price, running an evaluation, and confirming that a decision log and a virtual order are created only when the rules allow it.

**Acceptance Scenarios**:

1. **Given** a user creates a strategy with a stock, total budget, split count, and target profit settings, **When** the strategy is saved, **Then** the system stores the strategy with calculated per-round buy amount and an active status.
2. **Given** an active strategy with no pause state and a current price that does not satisfy the sell condition, **When** the user evaluates the strategy, **Then** the system determines whether a buy or hold decision applies based on the available budget, current holding state, and round-based rules.
3. **Given** an active strategy with holdings whose current price meets or exceeds the profit target, **When** the user evaluates the strategy, **Then** the system records a sell decision for the full held quantity and creates a pending virtual sell order.
4. **Given** a paused strategy, **When** the user evaluates the strategy, **Then** the system returns a pause decision and does not create a new virtual order.

---

### User Story 2 - Use Market Data With Manual Fallback (Priority: P2)

The user retrieves the current price and daily chart data for a stock from the configured market-data provider, and if the provider is unavailable, manually enters the current price to continue evaluation.

**Why this priority**: The strategy assistant depends on fresh price data, but the workflow must continue even when external market-data access fails.

**Independent Test**: Can be fully tested by requesting current price and daily chart data for a stock, then simulating a provider failure and confirming the user can continue with manual current-price input.

**Acceptance Scenarios**:

1. **Given** a stock code with available external data, **When** the user requests the latest price, **Then** the system shows the retrieved current price for use in strategy evaluation.
2. **Given** a stock code with available external data, **When** the user opens the chart view, **Then** the system shows daily price history for that stock.
3. **Given** current-price retrieval fails, **When** the user manually enters a current price, **Then** the system accepts the manual value and allows evaluation using that price.

---

### User Story 3 - Manage Virtual Orders And Holdings (Priority: P3)

The user reviews virtual orders created by strategy evaluations, marks them as filled or canceled, and sees holdings update to reflect virtual execution results while preserving a decision history.

**Why this priority**: The app is explicitly non-trading in MVP, so reliable virtual order tracking is the substitute for actual order execution and is required to keep state consistent over time.

**Independent Test**: Can be fully tested by creating a pending virtual buy or sell order, marking it filled or canceled, and confirming holdings and order history update correctly without any real order placement.

**Acceptance Scenarios**:

1. **Given** a pending virtual buy order, **When** the user marks it as filled, **Then** the system updates the holding quantity, invested amount, remaining budget, and average price accordingly.
2. **Given** a pending virtual sell order, **When** the user marks it as filled, **Then** the system reduces the holding quantity, updates realized profit, and closes the position if the quantity reaches zero.
3. **Given** a pending virtual order, **When** the user marks it as canceled, **Then** the system updates the order status to canceled and leaves holding values unchanged.
4. **Given** a strategy already has a buy decision for the same date and round, **When** evaluation would produce the same buy again, **Then** the system prevents creation of a duplicate virtual buy order.

### Edge Cases

- Current-price retrieval fails, times out, or returns unusable data; the user must still be able to evaluate the strategy with manual current-price input.
- The calculated buy quantity is zero because the current price exceeds the per-round buy budget; the system must return hold and must not create a buy order.
- The strategy has no holdings and the evaluation would otherwise satisfy a sell rule; the system must not create a sell order.
- A virtual order is requested to be filled or canceled after it is already finalized; the system must reject the repeated action and preserve the original state.
- The strategy reaches its split-buying limit or no remaining budget is available; the system must not create further buy orders.
- Daily chart data is unavailable for the selected stock; the chart view must show the failure clearly without blocking strategy CRUD or order-history viewing.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST allow the user to create, view, update, and delete a strategy for a single stock.
- **FR-002**: The system MUST store for each strategy its name, stock identifier, stock name, total budget, split count, per-round buy amount, target profit rate, current round, status, creation time, and last updated time.
- **FR-003**: The system MUST default a new strategy to 40 split rounds and a target profit rate of 10% unless the user changes those values.
- **FR-004**: The system MUST calculate the per-round buy amount as total budget divided by split count when a strategy is created or updated.
- **FR-005**: The system MUST maintain a holding record for each strategy that tracks quantity, average price, invested amount, remaining budget, realized profit, and last updated time.
- **FR-006**: The system MUST retrieve the latest current price for a stock from the configured market-data provider when the user requests it.
- **FR-007**: The system MUST retrieve daily price history for a stock from the configured market-data provider and present it in a chart-ready form for the strategy detail workflow.
- **FR-008**: The system MUST allow the user to manually enter a current price when external current-price retrieval fails.
- **FR-009**: The system MUST evaluate a strategy using the most recent available current price, the current holding state, the strategy settings, and the strategy status.
- **FR-010**: The system MUST return a pause decision when the strategy status is paused and MUST NOT create a new virtual order in that case.
- **FR-011**: The system MUST calculate the buy quantity as the largest whole-number quantity affordable within the per-round buy amount at the current price.
- **FR-012**: The system MUST return a hold decision and MUST NOT create a buy order when the calculated buy quantity is zero.
- **FR-013**: The system MUST determine a sell decision when the current price is greater than or equal to the holding average price multiplied by one plus the target profit rate.
- **FR-014**: The system MUST create a pending virtual sell order for the full held quantity when the sell condition is met and the strategy has holdings available to sell.
- **FR-015**: The system MUST evaluate buy eligibility when the sell condition is not met and the strategy is active.
- **FR-016**: The system MUST NOT create a buy order when the strategy has exhausted its remaining budget or reached its allowed split-buying rounds.
- **FR-017**: The system MUST create only virtual orders and MUST NOT place, request, or relay any real trade order.
- **FR-018**: The system MUST allow the user to view all virtual orders for a strategy, including order date, side, price, quantity, amount, status, round number, reason, creation time, and fill time.
- **FR-019**: The system MUST allow the user to mark a pending virtual order as filled.
- **FR-020**: The system MUST allow the user to mark a pending virtual order as canceled.
- **FR-021**: The system MUST update holding values after a virtual buy fill by increasing quantity and invested amount, decreasing remaining budget, and recalculating average price.
- **FR-022**: The system MUST update holding values after a virtual sell fill by decreasing quantity, increasing remaining budget, and updating realized profit.
- **FR-023**: The system MUST leave holdings unchanged when a pending virtual order is canceled.
- **FR-024**: The system MUST record a decision log for every evaluation attempt, including the input price, holding average price, holding quantity, decision result, reason, and creation time.
- **FR-025**: The system MUST prevent duplicate virtual buy creation for the same strategy, same calendar date, and same round number.
- **FR-026**: The system MUST provide a strategy detail view that combines strategy settings, holding status, current evaluation actions, and related decision history.
- **FR-027**: The system MUST provide a daily chart view for the selected stock using retrieved daily price data.
- **FR-028**: The system MUST provide a virtual order history view for the selected strategy.
- **FR-029**: The system MUST make it clear that real trading is unavailable in MVP by omitting real-order actions or rendering them unavailable.
- **FR-030**: The system MUST continue operating for strategy CRUD, holdings, logs, and virtual order management even when market-data retrieval is temporarily unavailable.

### Key Entities *(include if feature involves data)*

- **Strategy**: A user-defined investment rule set for one stock, including budget, split-buying settings, target profit settings, current round progression, and lifecycle status.
- **Holding**: The current virtual position state for a strategy, including quantity owned, average acquisition price, money invested, remaining budget, and realized profit.
- **Virtual Order**: A simulated buy or sell instruction created from an evaluation result, including side, target price, quantity, amount, status, round reference, and rationale.
- **Decision Log**: An audit record of each evaluation attempt, including the market price used, holding context, resulting decision, and explanation.
- **Daily Price Record**: A dated price-history entry for a stock containing open, high, low, close, and volume values used to render historical charts.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can create a new strategy and reach the strategy detail view with calculated split-buying values in under 2 minutes on the first attempt.
- **SC-002**: In at least 95% of evaluations where valid market price input is available, the system returns a decision and stores its log within 5 seconds.
- **SC-003**: When external current-price retrieval fails, the user can continue evaluation by manually entering a price without restarting the workflow in 100% of tested failure cases.
- **SC-004**: In 100% of tested duplicate-buy scenarios for the same strategy, date, and round, the system prevents creation of a second buy order.
- **SC-005**: In 100% of tested virtual order fill and cancel scenarios, holding totals and order statuses remain internally consistent with the final virtual order state.
- **SC-006**: In usability review, a user can distinguish virtual trading from real trading without guidance in at least 9 out of 10 test sessions.

## Assumptions

- The MVP is for a single operator managing only their own strategies, so multi-user behavior, login, and permissions are excluded.
- Each strategy tracks one stock at a time and uses one active holding record.
- The user manually triggers evaluations; there is no background scheduling or automatic trade execution.
- External market-data access is used only for current-price and daily-price retrieval, and evaluation may proceed with manual current-price input when retrieval fails.
- Virtual orders represent the only order workflow in MVP; no real brokerage order request, confirmation, or reconciliation is part of this feature.
- Daily chart data is used for viewing recent price history and not for backtesting, screening, or automated signal generation.
