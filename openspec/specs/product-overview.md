# 제품 개요

## 한 줄 요약

라오어 무한매수법 스타일의 단일 종목 분할 매수 전략을 한국투자증권(이하 KIS) Open API 일봉 데이터로 **백테스트**하고, KIS Open API 주문으로 **자동매매**까지 실행할 수 있는 사용자별 웹 애플리케이션. 자동매매는 라오어 무한매수법(`LAOR_INFINITE_V2`) 외에 한국 국장 상승률 랭킹(`KR_RANK_MOMENTUM`)·미국장 상승률 랭킹(`US_RANK_MOMENTUM`) 전략을 독립적으로 지원한다. 백테스트는 라오어 알고리즘 기준이다.

## 사용자 시나리오

1. 사용자가 이메일/비밀번호로 회원가입 후 로그인한다.
2. `KIS 설정` 화면에서 자신의 KIS App Key / App Secret / 계좌번호 / 계좌상품코드를 저장한다.
3. 메인 화면(공통 전략 초안)에서 종목, 총 예산, 분할 회차, 목표 수익률, 큰수 매수 여유율을 입력해 **전략 초안**을 만든다.
4. 전략 상세에서 **백테스트로 검증** 버튼을 누르면 같은 설정이 백테스트 화면에 자동으로 채워지고, KIS 일봉으로 LAOR_INFINITE_V2 알고리즘 결과를 본다.
5. **자동매매 전략 만들기** 버튼을 누르면 같은 설정으로 자동매매 전략을 생성한다.
6. 자동매매 화면에서 `시작`을 누르면 상태가 `RUNNING`이 되고, backend 서버 스케줄러(최대 10분 간격)가 RUNNING 전략을 평가한다.
7. 사용자별 `실주문 실행 설정`이 켜져 있고 안전 검증을 통과하면 KIS 주문 API로 실제 매수/매도 주문이 나간다. 꺼져 있으면 판단·모의 주문·포지션 스냅샷만 기록된다.

## 핵심 가치

- **분리된 두 모드**: 같은 전략 설정을 백테스트(과거 일봉 기준)와 자동매매(현재가 + KIS 주문) 양쪽에서 재사용.
- **사용자별 자원 격리**: 모든 도메인 테이블에 `user_id`가 있고, 모든 보호 API는 세션의 `userId` 기준으로만 조회/수정/삭제한다.
- **사용자별 KIS 자격증명**: App Key / Secret / access token / 계좌번호는 사용자별로 AES-256-GCM 암호화 저장.
- **실주문 안전망**: 미체결·중복·매수가능금액·보유 수량·최소 1주(해외 실주문) 검사를 통과해야 KIS로 주문 전송.

## 기술 스택

- **Backend**: Node.js, Express, `better-sqlite3` 기반 SQLite, `express-session` + `better-sqlite3-session-store`, `bcrypt`, AES-256-GCM (`backend/src/crypto/`).
- **Frontend**: React 19, Vite, Recharts. 단일 페이지 앱이며 라우팅은 `frontend/src/App.jsx`의 `view` 상태로 분기 (`kis` / `backtest` / `auto-trading` / 기본 전략 목록).
- **데이터 소스**: KIS Open API (`backend/src/market-data/KisMarketDataProvider.js`, `backend/src/services/kisTradingService.js`, `backend/src/services/kisAuthService.js`).
- **DB 마이그레이션**: `backend/src/db/migrations/`에 `0001`부터 파일명 순서로 적용. 실행은 `npm run migrate`.

## 기본 예시 종목

`TQQQ`. 해외 종목 통화는 KIS 응답 통화(주로 USD), 국내 종목은 KRW.

## 알고리즘

현재 백테스트와 자동매매 모두 동일한 `LAOR_INFINITE_V2` 의사결정 규칙을 따른다. 상세는 [backtest.md](backtest.md), [auto-trading.md](auto-trading.md) 참고.

## 비목표 (현재 버전)

- 예약주문, KIS 예약주문 API 연동
- 수수료, 세금, 환율, 슬리피지 정밀 계산
- 주문 실패 자동 재시도
- 다종목 포트폴리오 동시 운용
- 모의투자(KIS Mock) 분기 — 본 앱은 실서비스(`KIS_API_BASE_URL`) 기준만 사용
