## Why

한국 국장 상승률 랭킹 전략은 진입 구간당 1회만 매수하지만, 미국장은 같은 날 안에서 반복 회전 매매가 가능하다. 사용자는 ET 10:00~16:00 동안 "상승률 상위 → 2% 익절 → 다시 상승률 상위 매수"를 계속 돌리는 자동매매를 원한다. 하루 한 번이라도 5% 손실로 매도가 발생하면 그날 추가 매수는 중단하고, KST 04:30에는 보유분을 강제 청산해 다음 날을 깨끗한 현금으로 시작한다.

## What Changes

- 미국 정규장 시간 안에서 30초 간격 평가 스케줄러로 동작하는 **새 자동매매 전략 타입**(`US_RANK_MOMENTUM`) 추가.
- 한 거래일 안에서 **반복 회전 매매**: 보유 없음 → 미국 상승률 상위 1위 매수 → 2% 도달 시 매도 → 다시 1위 매수 (한국 랭킹은 진입 구간당 1회였던 점과 가장 큰 차이).
- **하루 종료 트리거 두 가지**:
  - 어느 매매든 손절(-5%) 도달 → 매도 후 그날 신규 매수 정지(`day_locked_out`).
  - KST 04:30 도달 → 보유분 현재가 지정가 매도, 신규 매수 정지.
- **DST 자동 감지**: 미국 동부 기준 시각으로 ET 10:00~16:00 평가 시간을 자동 판정.
- 매수 금액은 **평가 시점 KIS 매수가능금액 전액**(USD 잔고 또는 통합증거금 환산)을 한 종목에 투입한다.
- 자동매매 화면에 **"미국장 상승률 랭킹 전략" 탭**을 추가 (라오어·한국 랭킹과 같은 위치).
- 미국장은 가격제한폭이 없으므로 코드 상수 기반 과열 필터를 둔다. 현재 구현은 등락률 +50% 이상, 현재가 5 USD 미만, 거래량 1,000만 주 미만, 거래대금 5천만 USD 미만, VWAP 대비 과도한 이탈 후보를 제외하고 상위 최대 3개 후보의 분봉 흐름을 확인한다. 익절 기준에 닿으면 랭킹 순위와 관계없이 전량 매도하고, 누적 목표 수익률을 설정하면 시작 자본 대비 목표에 닿았을 때 전략을 종료한다. 주문은 1주 단위 정수 매수, 30초 간격 평가, 판단 로그·주문 이력·진입 기록 저장 패턴을 한국 랭킹과 맞춘다.

## Capabilities

### New Capabilities
- `us-rank-auto-trading`: 미국장 상승률 랭킹 자동매매 전략의 진입 조건·반복 매매·하루 종료·DST 처리·KIS 연동·실주문 안전 검증 명세.

### Modified Capabilities
- `frontend-screens`: 자동매매 페이지에 "미국장 상승률 랭킹" 탭이 추가됨(라오어·한국 랭킹과 같은 자리). 폼·연결 계좌 패널·전략 목록·상세·판단 로그·주문 이력 패턴은 한국 랭킹과 동일.

## Impact

- **Backend**
  - 새 테이블: `us_rank_strategies`, `us_rank_trades`(반복 매매 1건당 한 행), `us_rank_orders`, `us_rank_decision_logs`, `us_rank_locks`.
  - 새 모듈: `usRankRepository.js`, `usRankService.js`, `usRankStrategyEngine.js`, `usRankRoutes.js`.
  - `autoTradingScheduler.js`에 3번째 timer(usRankTick) 추가.
  - `kisTradingService.js`에 해외 등락률 상위 랭킹 조회 추가 (현재 한국만 있음).
  - `marketDataService.js`에 미국 등락률 랭킹 헬퍼 추가.
- **Frontend**
  - 새 컴포넌트: `UsRankAutoTradingPanel.jsx` (한국 랭킹 패널 기반).
  - `AutoTradingPage.jsx`에 탭 추가.
  - `api/client.js`에 US 랭킹 API 함수 추가.
- **DB 마이그레이션**: `0029_us_rank_auto_trading.sql`.
- **외부 의존**
  - KIS Open API 해외주식 등락률 순위 엔드포인트 (TR ID 확인 필요).
  - KIS Open API 해외주식 현재가·잔고·매수가능금액·주문(기존 라오어 미국 종목에서 이미 사용 중).
- **공유 설정**: 실주문 실행 설정(`user_trading_settings.live_order_enabled`)을 라오어·한국 랭킹·미국장 랭킹이 모두 공유.
