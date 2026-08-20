# Research: 증거 기반 랭킹 자동매매와 주문 복구

## 운영 사실

- `test3@test.com` KR 전략은 2026-05-21~07-16 왕복 75건, 41승/34패, KIS 순실현 `-78,052원`이다.
- 평균 이익 `+1,984원`, 평균 손실 `-4,688원`으로 승률 54.7%여도 손실이다.
- 2026-07-17 이후 22거래일 44개 구간은 전부 `NO_CANDIDATE`, 주문 0건이다. scheduler 중단이나 주문 실패가 원인이 아니다.
- 최근 30일 923개 저장 관찰을 현재 rolling 12/50% 방식으로 재평가하면 안정 후보는 11구간이지만 저장 마지막 시점의 분봉·slippage를 통과한 거래는 0건이다.
- KIS 분봉으로 5분을 엄격 근사한 유일 잠정 후보는 화신정공이며 quote에 따라 미진입 또는 손실이다. 알려진 종목끼리만 순위를 매긴 낙관 민감도는 3건 모두 손실, 비용 후 -9.06%다.
- 점심 시장 전체 10위 등락률 평균은 +21.48%이며 22일 중 1일만 +15% 미만이다. `raw top 10`과 `점심 <15%`는 구조적으로 대부분 빈 집합이다.
- US 실전 2건은 극단 급등 저가주 추격으로 합계 `-$22.5385`다.
- LAOR에는 `UNKNOWN` 주문과 실제 잔고 증가가 함께 있어 접수와 체결 상태 불일치 흔적이 있다.

## KIS 자료 결정

공식 workbook의 `주식일별분봉조회`를 사용한다.

- TR: `FHKST03010230`
- path: `/uapi/domestic-stock/v1/quotations/inquire-time-dailychartprice`
- 분석은 GET만 호출하며 운영 주문·취소 API와 DB write를 사용하지 않는다.
- 계좌 인증정보, token, 계좌번호, 주문번호 원문은 산출물에 남기지 않는다.

## 후보 규칙

- **V0 Control**: raw top 10, 오전 15~20%/점심 <15%, rolling 12 중 50%+latest, 기존 분봉 필터, 5분 search, next-tick 확인.
- **V1 Band-neutral persistence**: 절대 등락률 밴드를 없애고 top 10 지속성과 과열 방지만 남겨 band 효과를 격리한다.
- **V2 Pullback-reclaim**: VWAP 위 저거래량 눌림 뒤 다음 봉의 고가 회복과 거래량 증가를 요구한다.
- **V3 Volatility-compression breakout**: VWAP 위 3봉 변동성 압축 뒤 3봉 고점·median 거래량 돌파를 요구한다.
- **V4 Rank-acceleration**: 최근 6 snapshot 중 4회 이상, latest 포함, 최근 rank 비악화와 등락률 증가, 단기 수직 급등 제외를 요구한다.
- **V5 Consensus**: V2 또는 V3과 V4가 동시에 통과한 경우만 신호를 낸다.

모든 후보는 동일한 +2% target, -5% stop, 시간 청산, 비용·slippage를 사용한다. 후보 선택과 exit를 동시에 튜닝하지 않는다.

## 검증 결정

- 이미 PR #99/#100/#101과 이번 연구에 사용한 75건 및 2026-07-20~08-19 자료는 train으로만 본다.
- clean validation에는 실제 post-entry 30초 market-wide ranking이 필요하다.
- threshold는 shadow 시작 전에 고정한다.
- 첫 20개 확인 가능한 가상 거래를 validation으로, 그 다음 20개를 untouched final test로 둔다.
- validation winner 한 개만 final test에서 평가한다.
- 같은 candle이 target과 stop을 모두 건드리면 stop-first, 비용 후 성과를 사용한다.
- 최소 20 validation 거래, 양의 기대수익, PF > 1, MDD ≤ 10%를 모두 만족하지 못하면 live 승격하지 않는다.

2026-08-20 time-split 경쟁 결과는 [검증 보고서](../../kr-rank-timesplit-validation-2026-08-20.md)에 기록했다. 실제 75건과 최근 43구간에서 위 gate를 통과한 변형은 0개였다.

## 주문 복구 결정

- HTTP 200의 비일시 business rejection이고 주문번호가 없는 응답만 `REJECTED`다.
- EGW, 429, 5xx, timeout, network/parse failure는 `UNKNOWN`이다. 조회로 미접수를 확정하기 전 blind retry하지 않는다.
- stale BUY는 주문 이력·open order·잔고를 먼저 확인하고, 열린 주문만 취소하며 취소 완료 후 다음 tick에서 신호를 재검증한다.
- `ACCEPTED`는 체결이 아니다. `FILLED` 또는 잔고/체결 내역의 동등한 확인 뒤에만 position 상태를 바꾼다.

## 수익성 결론

현재 30일 자료에서 V0은 거래 0건이고 5분 합성 근사도 수익 근거가 없다. 따라서 현재 개선안을 live 수익 전략으로 승인하지 않는다. 이번 배포의 정당한 범위는 주문 안전성 수정과 clean shadow 자료 수집이다. 수익을 보장한다는 표현은 사용하지 않는다.
