## ADDED Requirements

### Requirement: 전략 종류와 분리

시스템은 라오어 무한매수법(`LAOR_INFINITE_V2`)·한국 국장 상승률 랭킹(`KR_RANK_MOMENTUM`)과 독립적으로 운용되는 새 전략 종류 `US_RANK_MOMENTUM`을 제공해야 한다(MUST). 새 전략의 생성·시작·종료·조회는 다른 두 전략의 동작에 영향을 주어서는 안 되며, 새 전략 전용 테이블 세트(`us_rank_strategies`, `us_rank_trades`, `us_rank_orders`, `us_rank_decision_logs`, `us_rank_locks`)에 기록되어야 한다. `user_trading_settings.live_order_enabled`(실주문 실행 설정), KIS 토큰/잔고/주문 모듈, 자동매매 스케줄러 프로세스는 세 전략이 공유한다.

#### Scenario: 새 전략 종류 추가
- **WHEN** 사용자가 `US_RANK_MOMENTUM` 전략을 생성
- **THEN** `us_rank_strategies` 행이 만들어져야 하고, 기존 두 전략의 RUNNING 상태와 평가에는 영향이 없어야 한다

#### Scenario: 같은 사용자가 세 종류 동시 RUNNING
- **WHEN** 한 사용자가 라오어·한국 랭킹·미국장 랭킹 전략을 모두 RUNNING으로 둠
- **THEN** 세 스케줄러가 각자 자기 전략만 평가해야 하며, 한 종류의 오류가 다른 종류의 평가를 막지 않아야 한다

### Requirement: 미국 정규장 시간 + DST 자동 감지

시스템은 매 평가에서 현재 시각이 미국 정규장 중 ET 10:00~16:00 안인지 자동으로 판정해야 한다(MUST). 미국 서머타임으로 인한 시차 변경은 OS의 IANA 시간대 데이터(`America/New_York`)에 위임해 코드에서 별도 분기를 두지 않아야 한다(MUST). 정규장 외에는 매수·매도 평가를 하지 않고 idle SKIP으로 종료한다.

#### Scenario: 표준시(겨울) 정규장
- **WHEN** UTC-5 시기, 미국 동부 시각 10:00(KST 00:00)에 평가 실행
- **THEN** 정규장으로 판정되어 평가를 진행해야 한다

#### Scenario: 서머타임(여름) 정규장
- **WHEN** UTC-4 시기, 미국 동부 시각 10:00(KST 23:00)에 평가 실행
- **THEN** 정규장으로 판정되어 평가를 진행해야 한다

#### Scenario: 장 외 시간 SKIP
- **WHEN** 미국 동부 시각 17:00(장 종료 1시간 후) 또는 토/일에 평가 실행
- **THEN** 정규장 외로 판정되어 SKIP 처리하고 판단 로그를 만들지 않아야 한다(매분 폴링 노이즈 방지)

### Requirement: 30초 간격 전용 스케줄러

시스템은 미국장 랭킹 전략 전용 30초 간격 스케줄러를 운용해야 한다(MUST). 이 스케줄러는 라오어 10분·한국 랭킹 30초 스케줄러와 독립된 타이머로 동작하며, 한 종류의 평가 오류가 다른 종류의 평가를 중단시키지 않아야 한다.

#### Scenario: 30초 간격 평가
- **WHEN** 미국 정규장 시간에 RUNNING 전략이 있음
- **THEN** 30초 이내의 다음 평가 tick에서 평가가 실행되어야 한다

#### Scenario: 장 외·idle tick은 로그 미생성
- **WHEN** 스케줄러 평가에서 정규장 외 또는 day_locked_out·보유 없음으로 SKIP
- **THEN** 판단 로그를 새로 만들지 않아야 한다(매분 폴링 노이즈 방지). 매수·매도·오류와 사용자 수동 평가는 그대로 기록한다

### Requirement: 상승률 상위 랭킹 매수

미국 정규장 시간에 보유 종목이 없고 새 매매 사이클을 시작할 수 있는 상태이면, 시스템은 KIS 해외주식 상승률 상위 랭킹을 조회해 유효 후보를 매수 대상으로 선택해야 한다(MUST). 현재가 5 USD 미만, 거래량 1,000만 주 미만, 거래대금 5천만 USD 미만, 등락률 +50% 이상, VWAP 대비 과열 후보는 제외해야 한다(MUST). 1차 필터를 통과한 상위 최대 3개 후보에 당일 분봉 흐름 필터를 적용하고, 첫 통과 종목을 선택한다. 선택된 종목이 없으면 매수하지 않고 판단 기록을 남긴다. 매수는 현재가 지정가 1주 단위 정수 주문이며, KIS 매수가능금액 전액으로 매수 가능 수량을 계산한다.

#### Scenario: 첫 유효 종목 선택
- **WHEN** 평가 시점 랭킹 1위 등락률 +35%, 2위 +18%, 3위 +12%이고 1위 종목의 종목코드·현재가·거래량·거래대금·분봉 흐름이 유효함
- **THEN** 1위 종목이 매수 대상으로 선택되어야 한다

#### Scenario: 선택 가능 종목 없음
- **WHEN** 모든 랭킹 종목의 종목코드가 없거나 현재가가 5 USD 미만이거나 거래량·거래대금 기준에 미달하거나 등락률 +50% 이상이거나 등락률 파싱에 실패함
- **THEN** 매수하지 않고 "선택 종목 없음" 판단 기록을 남겨야 한다

#### Scenario: 현재가 지정가 정수 1주 매수
- **WHEN** 선택 종목 현재가 50 USD, 매수 한도 1,000 USD
- **THEN** 20주 현재가 지정가 매수 주문이 만들어져야 한다(소수점 매수 미지원)

### Requirement: 매수 금액 — 매수가능금액 전액

시스템은 미국장 랭킹 전략의 매수 금액을 사용자가 별도 입력하지 않게 하고, 평가 시점의 KIS USD 매수가능금액 전액을 한 종목에 투입해야 한다(MUST). 기존 요청에 고정 USD 값이 들어와도 매수 수량 계산에는 사용하지 않아야 한다(MUST). 주문 수량은 정수 1주 단위다.

#### Scenario: 매수가능금액 전액 사용
- **WHEN** 전략 평가 시점의 매수가능금액이 5,000 USD, 종목 현재가 100 USD
- **THEN** 50주 매수가 계산되어야 한다

#### Scenario: 익절 매도 후 재매수
- **WHEN** 100주를 사 +2% 익절 매도 → 그 직후 평가
- **THEN** 매도 결제잔액을 포함한 최신 매수가능금액으로 새 매매 사이클을 시작해야 한다(사용자 개입 없음)

### Requirement: 반복 회전 매매 (Trade Cycle)

미국 정규장 시간에 보유 종목이 없고 `day_locked_out=false`이며 강제 청산 시각 전이면, 시스템은 새 매매 사이클(`us_rank_trades` 행, `trade_seq` 증가)을 시작해야 한다(MUST). 한 매매 사이클은 (a) 종목 선택, (b) 매수, (c) 매도(익절/손절/강제 청산)로 끝난다. 매도 후 위 조건이 다시 만족되면 즉시 다음 매매 사이클을 시작한다.

#### Scenario: 매도 후 즉시 다음 매매
- **WHEN** 1번째 매매에서 +2% 익절 매도가 체결됨
- **THEN** 다음 평가 tick에서 새 매매 사이클(`trade_seq=2`)을 시작해 상승률 랭킹을 다시 조회·매수해야 한다

#### Scenario: 보유 중에는 새 매매 사이클 시작 안 함
- **WHEN** 보유 종목이 있고 매도가 아직 안 일어남
- **THEN** 새 매매 사이클을 시작하지 않고 매도 평가만 한다

### Requirement: 익절·손절·강제 청산 매도

시스템은 보유분의 수익률이 익절 기준(`target_profit_rate`, 기본 +2%) 이상이면 랭킹 순위와 관계없이 전량 매도해야 한다(MUST). 손실률이 손절 기준(`stop_loss_rate`, 기본 -5%) 이상이면 전량 매도하고 `day_locked_out=true`로 설정해 그날 신규 매수를 정지해야 한다(MUST). 현재 KST 시각이 강제 청산 시각(`force_close_kst`, 기본 04:30) 이상이면 익절·손절 미도달이어도 전량 매도하고 `day_locked_out=true`로 설정해야 한다(MUST). 매도는 현재가 지정가 주문으로 만든다. 같은 평가에서 여러 조건이 동시에 만족하면 누적 목표 달성, 손절, 익절, 강제 청산 순으로 우선 적용한다.

#### Scenario: 익절 매도
- **WHEN** 보유분의 수익률이 익절 기준 이상임
- **THEN** 전량 매도 주문이 만들어져야 한다 (`sell_reason=TARGET`)

#### Scenario: 손절 매도 + 그날 잠금
- **WHEN** 보유분의 손실률이 손절 기준 이상
- **THEN** 전량 매도 주문이 만들어져야 하고(`sell_reason=STOP_LOSS`), `day_locked_out=true`로 설정되어 그날 신규 매수가 정지되어야 한다

#### Scenario: 강제 청산 매도
- **WHEN** 현재 KST 시각이 `force_close_kst` 이상이고 정규장 안
- **THEN** 보유분이 있으면 전량 매도(`sell_reason=FORCE_CLOSE`)하고 `day_locked_out=true`로 설정해야 한다

#### Scenario: 손절 우선
- **WHEN** 강제 청산 시각이 지난 평가에서 수익률이 익절 기준 이상에 도달
- **THEN** 익절 매도(`sell_reason=TARGET`)로 처리해야 한다

### Requirement: 누적 목표 수익률 종료

시스템은 사용자가 누적 목표 수익률(`cycle_target_profit_rate`)을 설정할 수 있어야 한다(MUST). 전략 시작 시점의 USD 매수가능금액을 기준 자본(`cycle_baseline_usd`)으로 저장하고, 평가 시점 총자산(`cashAvailable + holdingQuantity * currentPrice`)이 기준 자본 대비 목표 수익률에 도달하면 보유분을 `CYCLE_COMPLETE` 사유로 정리하고 전략 상태를 `STOPPED`로 바꿔야 한다(MUST). 보유 종목이 없는 상태에서 이미 목표에 도달했다면 주문 없이 전략을 `STOPPED`로 종료해야 한다.

#### Scenario: 보유 중 누적 목표 도달
- **WHEN** 기준 자본 1,000 USD, 현재 총자산 1,200 USD, 누적 목표 수익률 20%
- **THEN** 보유분을 `sell_reason=CYCLE_COMPLETE`로 매도하고 전략을 `STOPPED`로 종료해야 한다

#### Scenario: 무보유 상태에서 누적 목표 도달
- **WHEN** 기준 자본 1,000 USD, 매수가능금액 1,200 USD, 누적 목표 수익률 20%, 보유 종목 없음
- **THEN** 새 매수를 시작하지 않고 전략을 `STOPPED`로 종료해야 한다

### Requirement: 그날 잠금 (day_locked_out)

손절 매도 또는 강제 청산 매도가 한 번이라도 일어나면 시스템은 그날의 신규 매수를 정지해야 한다(MUST). 잠금은 평가 시점의 거래일이 잠금 발생 거래일과 다르면 자동 해제된다. 거래일 판정은 미국 동부(`America/New_York`) 자정 기준으로 한다.

#### Scenario: 손절 후 신규 매수 정지
- **WHEN** 손절 매도 직후, 같은 거래일에 다음 평가 실행
- **THEN** 보유 없음에도 새 매매 사이클을 시작하지 않고 SKIP 사유에 "그날 손절로 신규 매수 정지" 표시

#### Scenario: 다음 거래일 자동 해제
- **WHEN** 손절 발생 다음 미국 동부 거래일의 정규장 첫 평가
- **THEN** 자동으로 잠금이 해제되어 새 매매 사이클을 시작할 수 있어야 한다

### Requirement: KST 강제 청산 시각

시스템은 사용자가 지정한 강제 청산 시각(`force_close_kst`, `HH:MM` 형식, 기본 `04:30`)을 KST 기준으로 저장해야 한다(MUST). 평가 시 현재 KST 시각이 이 값 이상이고 정규장 안이면 보유분을 전량 매도한다. 사용자는 폼에서 이 값을 수정할 수 있어야 하며, 형식이 잘못되거나 정규장 시간을 벗어나는 값은 거절해야 한다.

#### Scenario: 기본값 04:30 적용
- **WHEN** 사용자가 강제 청산 시각을 지정하지 않고 전략 생성
- **THEN** 기본값 `04:30`(KST)이 저장되어야 한다

#### Scenario: 잘못된 형식 거절
- **WHEN** 강제 청산 시각으로 `25:00` 같은 잘못된 형식 입력
- **THEN** 거절해야 한다

### Requirement: 안전 검증·멱등성

시스템은 실주문 모드에서 미체결 주문·중복 주문(`idempotency_key` 형식 `{YYYYMMDD}-{strategyId}-{tradeSeq}-{BUY|SELL}`)·주문 수량 0·매수가능금액 부족·보유 수량 부족을 평가 시 차단해야 한다(MUST). 주문 실패(`FAILED`/`REJECTED`)는 자동 재시도하되 같은 매매 사이클당 최대 5회를 넘기지 않아야 한다(MUST).

#### Scenario: 중복 주문 차단
- **WHEN** 같은 `idempotency_key`로 이미 ACCEPTED/FILLED 상태 주문이 있음
- **THEN** 신규 주문을 만들지 않고 SKIP

#### Scenario: 매수 재시도 한도
- **WHEN** 같은 매매 사이클의 매수가 5회 실패
- **THEN** 더 매수하지 않고 SKIP 사유에 한도 초과 명시

### Requirement: 실주문 실행 설정 공유

시스템은 `user_trading_settings.live_order_enabled` 값을 라오어·한국 랭킹·미국장 랭킹 전략이 모두 공유해 사용해야 한다(MUST). 꺼져 있으면 랭킹 조회·종목 선택·판단·`DRY_RUN` 주문 예정 기록까지 동일하게 진행하지만 KIS 주문 API는 호출하지 않는다. 켜져 있으면 안전 검증을 통과한 주문만 KIS로 전송한다.

#### Scenario: 실주문 OFF DRY_RUN 기록
- **WHEN** 실주문 OFF 상태에서 매수가 만들어짐
- **THEN** `status=DRY_RUN`으로 주문 행이 저장되고 KIS 주문 API는 호출되지 않아야 한다

#### Scenario: 실주문 ON 안전 검증 통과 시 전송
- **WHEN** 실주문 ON 상태에서 안전 검증 통과한 매수 주문
- **THEN** KIS 해외주식 매수 주문 API로 전송되어야 한다

### Requirement: 판단 로그·주문 이력·매매 사이클 기록

시스템은 매 매수·매도·오류 평가, 사용자 수동 평가를 `us_rank_decision_logs`에 기록해야 한다(MUST). 매 주문은 `us_rank_orders`에 라이프사이클(`DECIDED`/`DRY_RUN`/`REQUESTED`/`ACCEPTED`/`FILLED`/`REJECTED`/`FAILED`/`CANCELED`/`UNKNOWN`)을 저장한다. 매 매매 사이클은 `us_rank_trades`에 `trade_seq`·종목·시작/종료 시각·진입가·청산가·청산 사유(`TARGET`/`STOP_LOSS`/`FORCE_CLOSE`/`CYCLE_COMPLETE`/`ENTRY_FAILED`)·수익률을 저장한다.

#### Scenario: 매매 사이클 단위 집계
- **WHEN** 한 거래일 안에 3번 매매(2회 익절, 1회 손절)
- **THEN** `us_rank_trades`에 `trade_seq=1,2,3` 세 행이 생기고 각 행에 청산 사유와 수익률이 저장되어야 한다
- **AND** 손절이 발생한 시점에 `day_locked_out=true`로 설정되어야 한다
