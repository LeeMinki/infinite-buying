# Feature Specification: 증거 기반 랭킹 자동매매와 주문 복구

**Feature Branch**: `007-improve-trading-retries`
**Created**: 2026-08-20
**Status**: In progress
**Input**: `test3@test.com`의 전체 실전 기록과 KIS 과거 시세를 분석하고, 익절 +2%·손절 -5%를 유지하면서 수익성 검증을 통과한 후보 선정 규칙과 안전한 주문 재시도를 배포한다.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - 재현 가능한 성과 검증 (Priority: P1)

운영자는 사용자 실전 체결, 매수하지 않은 랭킹 구간, KIS 분봉을 함께 사용한 시간순 백테스트에서 후보 규칙별 표본 수, 순손익, profit factor, 최대 낙폭을 비교할 수 있다.

**Why this priority**: 수익을 보장할 수 없는 실주문 시스템에서 같은 과거 자료에 맞춘 규칙을 곧바로 라이브로 승격하면 실제 돈을 위험에 노출한다.

**Independent Test**: 고정된 운영 DB snapshot과 KIS 응답 fixture로 분석을 다시 실행했을 때 동일한 결과가 나오고, 미래 데이터가 과거 후보 선택에 섞이지 않는지 확인한다.

**Acceptance Scenarios**:

1. **Given** `test3@test.com`의 전체 KR 거래와 랭킹 관찰, **When** 분석을 실행하면, **Then** 매수·무매수 구간과 KIS 시세 출처, 비용·슬리피지 가정, 데이터 한계를 함께 기록한다.
2. **Given** 여러 후보 규칙, **When** 성과를 비교하면, **Then** 익절 +2%와 손절 -5%는 모든 규칙에 동일하게 적용되고 후보 규칙만 달라진다.
3. **Given** 시간순 검증에서 표본 또는 기대수익 근거가 부족한 규칙, **When** 배포 승격을 평가하면, **Then** 실주문이 아니라 shadow 모드만 허용한다.

---

### User Story 2 - 실패 후 안전한 재시도 (Priority: P1)

사용자는 일시적인 후보 부재나 KIS의 명시적인 주문 거절 한 번으로 해당 진입 기회가 영구 종료되지 않되, 접수 여부가 불명확한 주문이 중복 전송되지 않기를 기대한다.

**Why this priority**: 주문번호 없는 명시적 거절은 재시도할 수 있지만 timeout·gateway 오류는 실제 접수 가능성이 있어 동일하게 취급하면 중복 주문이 된다.

**Independent Test**: KIS business rejection, EGW/429/5xx, network timeout, 주문 접수, 부분 체결 fixture를 각각 주입해 허용된 경우에만 재시도되는지 검증한다.

**Acceptance Scenarios**:

1. **Given** 후보가 한 tick에서 없거나 필터에서 제외됨, **When** 진입 시작 후 5분 이내 다음 tick이 오면, **Then** 최신 rolling 관찰로 다시 평가하고 첫 실패를 terminal `NO_CANDIDATE`로 만들지 않는다.
2. **Given** HTTP 200 응답에서 주문번호 없이 명시적인 비일시 business rejection, **When** 다음 tick이 오면, **Then** 최신 랭킹·가격·분봉을 다시 확인한 뒤 bounded retry한다.
3. **Given** timeout, network 오류, EGW, HTTP 429 또는 5xx, **When** 주문 접수 여부를 확정할 수 없으면, **Then** 상태를 `UNKNOWN`으로 두고 주문 이력·미체결·잔고로 확인하기 전에는 재전송하지 않는다.
4. **Given** 매수 주문이 90초 동안 0주 체결로 남음, **When** KIS에서 주문이 열린 상태임을 확인하면, **Then** 취소 완료를 확인한 뒤 다음 tick에서만 최신 가격으로 다시 시도한다.

---

### User Story 3 - 고정 손익 기준과 체결 확인 (Priority: P1)

사용자는 랭킹 전략이 평균 체결가 대비 +2% 목표와 -5% 하드 손절을 기준으로 운영되고, 주문 접수만으로 보유·청산을 확정하지 않기를 기대한다.

**Why this priority**: KIS의 `ACCEPTED`는 체결이 아니며 미국 지정가 손절은 미체결 동안 손실이 커질 수 있다.

**Independent Test**: 목표·손절 경계, 갭 하락, 목표와 손절이 같은 분봉에 닿은 경우, 부분 체결, 오래된 매도 주문을 fixture로 검증한다.

**Acceptance Scenarios**:

1. **Given** 보유 평균가가 있음, **When** 수익률이 +2% 이상이면, **Then** 전체 전략 관리 수량의 목표 매도를 시도한다.
2. **Given** 보유 평균가가 있음, **When** 수익률이 -5% 이하이면, **Then** 흔들기 유예 없이 방어 매도를 시도한다.
3. **Given** 목표·손절이 같은 1분봉 안에서 모두 닿음, **When** 백테스트가 체결 순서를 알 수 없으면, **Then** 손절 우선으로 계산한다.
4. **Given** 미국 방어 매도가 오래 미체결, **When** 주문 상태를 확인할 수 있으면, **Then** 기존 주문 취소 완료 후 더 공격적인 지정가로 재호가한다.
5. **Given** 주문 API가 `ACCEPTED`를 반환함, **When** 별도 체결 확인이 아직 없으면, **Then** 앱의 보유 또는 청산 완료 상태를 확정하지 않는다.

---

### User Story 4 - 관찰 후 단계적 승격 (Priority: P2)

운영자는 실제 전체 랭킹과 30초 현재가로 여러 후보 규칙을 shadow 평가하고, 미리 고정한 기준을 통과한 단 하나의 규칙만 실주문 후보로 승격할 수 있다.

**Why this priority**: 2026-07-17 이후 기존 배포는 첫 진입 평가 뒤 랭킹을 저장하지 않아 5분 재탐색을 정확히 소급 재현할 수 없다.

**Independent Test**: live order가 꺼진 shadow 평가가 실제 주문 없이 관찰·후보·필터·가상 종료를 저장하고, 승격 gate가 불충분한 표본을 거절하는지 확인한다.

**Acceptance Scenarios**:

1. **Given** 진입 관찰 시간, **When** 30초 scheduler가 실행되면, **Then** 실제 top 30, 현재가, 완성 분봉, 후보별 통과·탈락 사유를 저장한다.
2. **Given** shadow 규칙, **When** 가상 +2% 또는 -5% 종료가 발생하면, **Then** 비용과 슬리피지를 반영한 성과를 기록하되 KIS 주문 API는 호출하지 않는다.
3. **Given** 최소 표본, 양의 검증 기대수익, profit factor, 최대 낙폭 기준 중 하나라도 미달, **When** 승격을 요청하면, **Then** 실주문 활성화를 거부한다.

### Edge Cases

- 갭 하락, 거래정지, 호가 공백 때문에 -5%에서의 실제 체결은 보장할 수 없다. 시스템은 트리거와 재호가를 보장하고 결과를 사실대로 기록한다.
- 운영 DB 분석은 snapshot의 read-only 연결만 사용하고, KIS 과거 시세 조회는 GET만 사용한다.
- 장중 현재가가 분봉 OHLC 안에서 움직인 순서를 알 수 없으면 낙관적인 체결 순서를 가정하지 않는다.
- 외부 HTS/MTS 주문과 전략 관리 주문을 주문번호와 수량 provenance로 구분한다.
- 사용자 또는 전역 실주문 설정이 꺼져 있으면 취소를 포함한 모든 KIS 주문성 POST를 금지한다.
- 비밀 값과 계좌번호·주문번호 원문은 보고서, 로그, 브라우저 응답에 남기지 않는다.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: 시스템은 `test3@test.com`의 KR·US·LAOR 전략, 체결, 주문 상태, 판단, 랭킹 관찰을 사용자 격리 상태로 분석해야 한다.
- **FR-002**: 분석 도구는 운영 DB를 직접 수정하지 않고 read-only snapshot만 사용해야 한다.
- **FR-003**: KIS 과거 시세는 로컬 공식 문서의 TR·파라미터·응답 필드를 기준으로 GET 조회해야 한다.
- **FR-004**: 모든 후보 규칙의 종료 라벨은 +2% 익절과 -5% 손절로 고정해야 한다.
- **FR-005**: 백테스트는 시간순 train/validation을 사용하고 random split과 validation 재튜닝을 금지해야 한다.
- **FR-006**: 백테스트는 거래 비용, 지정가 슬리피지, same-candle stop-first 결과를 보고해야 한다.
- **FR-007**: 후보 규칙은 검증 표본 수, 승률, 순손익, 기대수익, profit factor, 최대 낙폭을 함께 보고해야 한다.
- **FR-008**: 깨끗한 검증 자료가 없거나 gate를 통과하지 못한 규칙은 live가 아니라 shadow로만 배포해야 한다.
- **FR-009**: KR 후보 검색은 5분의 bounded window에서 rolling 관찰을 갱신하되 다음 tick 확인을 통과해야 한다.
- **FR-010**: 주문 결과는 `REJECTED`, `UNKNOWN`, `ACCEPTED`, `PARTIALLY_FILLED`, `FILLED`, `CANCELED`를 구분해야 한다.
- **FR-011**: HTTP 200의 확정적 비일시 business rejection만 bounded retry 대상으로 분류해야 한다.
- **FR-012**: EGW, 429, 5xx, network timeout, 비JSON 응답은 주문 접수 여부가 불명확하므로 `UNKNOWN`이어야 한다.
- **FR-013**: BUY 재시도 전에는 최신 랭킹·분봉·가격 이탈·매수가능금액을 다시 검사해야 한다.
- **FR-014**: 0주 체결 stale BUY는 KIS 미체결 확인, 취소, 취소 확인 뒤에만 재호가해야 한다.
- **FR-015**: `ACCEPTED`만으로 보유·청산·회차 상태를 갱신해서는 안 된다.
- **FR-016**: 랭킹 전략의 hard stop 판단 기준은 평균 체결가 대비 -5%여야 하며 구조적 약화에 따른 별도 조기 종료는 사유를 구분해 기록해야 한다.
- **FR-017**: 미국 방어 매도는 stale 주문을 확인한 뒤 취소 완료 후 더 공격적인 지정가로 재호가해야 한다.
- **FR-018**: shadow 수집은 실제 top 30, 30초 quote, 완성 분봉, 후보 규칙별 판단과 가상 결과를 보존해야 한다.
- **FR-019**: 전역·사용자 실주문 설정 중 하나라도 false이면 주문과 취소 POST를 실행하지 않아야 한다.
- **FR-020**: 배포는 feature branch, 한국어 PR, green CI, Argo CD 동기화, production image SHA와 pod/DB/scheduler 검증을 거쳐야 한다.
- **FR-021**: 예약주문은 구현하지 않고 `ENABLE_RESERVED_ORDER=false`를 유지해야 한다.

### Key Entities

- **Strategy Experiment**: 고정된 버전의 후보 선정 규칙, 파라미터, train/validation 경계와 상태를 나타낸다.
- **Shadow Signal**: 한 진입 tick의 실제 랭킹, quote, 분봉, 후보별 판단과 탈락 이유를 나타낸다.
- **Virtual Trade**: shadow signal의 가상 매수와 +2/-5/시각 청산 결과, 비용·슬리피지를 나타낸다.
- **Broker Order Attempt**: 전략 주문의 요청 전 상태, KIS 결과 분류, 체결·취소 확인과 retry lineage를 나타낸다.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 같은 snapshot과 fixture로 백테스트를 반복하면 후보·거래·손익 결과가 동일하다.
- **SC-002**: 주문 결과 분류와 stale 주문 복구 테스트가 timeout/EGW/429/5xx에서 중복 POST 0건을 보장한다.
- **SC-003**: 신규 후보 규칙은 최소 20개의 확인 가능한 validation 거래와 비용 후 양의 기대수익, profit factor > 1, 검증 최대 낙폭 10% 이하를 모두 충족하기 전에는 live로 승격되지 않는다.
- **SC-004**: hard stop 판단은 -5% 경계 테스트를 통과하고, 갭·미체결로 실제 손실이 이를 넘으면 원인과 실제 체결을 보존한다.
- **SC-005**: 배포 뒤 backend/frontend pod가 Ready이고 DB migration·scheduler 오류가 없으며 의도하지 않은 KIS 주문이 0건이다.

## Assumptions

- 과거 75건과 2026-07-20~08-19 자료는 이미 규칙 발굴에 사용됐으므로 train 자료로 취급하며 독립적인 미래 성과 증거로 주장하지 않는다.
- 완전한 5분 재탐색 검증에는 배포 뒤 실제 30초 전체 랭킹 자료가 필요하다.
- 수익, 손실 상한, 특정 가격 체결은 보장할 수 없다. 이 기능의 gate는 불리한 가정을 포함해 위험한 규칙의 실주문 승격을 막는다.
