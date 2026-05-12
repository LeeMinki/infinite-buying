# Infinite Buying

라오어 무한매수법 스타일 전략을 한국투자증권(Korea Investment & Securities Co., Ltd., 이하 KIS) Open API 데이터로 백테스트하고 자동매매까지 실행할 수 있는 웹앱입니다. 기본 예시는 `TQQQ`이며, 국내 종목은 KRW, 해외 종목은 KIS 응답 통화 기준으로 계산합니다.

## 현재 지원 범위

- 이메일/비밀번호 회원가입, 로그인, httpOnly session cookie 인증
- 사용자별 전략, 가상 보유, 가상 주문, 판단 로그 분리
- 사용자별 KIS App Key / App Secret 암호화 저장
- KIS Open API access token 발급 및 재사용
- 국내/해외 종목 현재가 조회
- 국내/해외 종목 일봉 조회 및 `market_price_cache` 저장
- KIS 일봉 시가·고가·종가 기준 백테스트
- 백테스트 요약, 거래 이력, 자산 변화 차트, 평균단가 vs 종가 차트
- 자동매매 전략 생성, 시작, 종료
- 실주문 실행 설정 토글
- 실주문 실행 꺼짐: 현재가·잔고·매수가능금액 조회, 전략 판단, 모의 주문 기록, 포지션 스냅샷 저장
- 실주문 실행 켜짐: 미체결·중복·주문 한도·매수가능금액·보유 수량 검사를 통과한 경우 KIS 주문 API로 실제 매수/매도 주문 전송
- 서버 스케줄러 기반 RUNNING 전략 주기 평가와 access token 자동 발급/갱신

## 지원하지 않는 범위

- 예약주문
- KIS 예약주문 API 호출
- 수수료, 세금, 환율, 슬리피지 계산
- 주문 실패 자동 재시도
- 미체결 주문 자동 취소

`ENABLE_RESERVED_ORDER=false`를 유지해야 합니다. 실주문은 사용자별 `liveOrderEnabled` 설정이 켜져 있고 미체결·중복·주문 한도·매수가능금액·보유 수량 검사를 통과한 경우에만 실행됩니다.

## 구조

```text
backend/
  src/
    auth/
    config/
    crypto/
    db/
    execution/
    market-data/
    repositories/
    routes/
    services/
  tests/

frontend/
  src/
    api/
    auth/
    components/
    pages/
```

Backend는 Node.js, Express, SQLite(`better-sqlite3`)로 구성됩니다. Frontend는 React, Vite, Recharts를 사용합니다.

## 환경변수

Backend에서 사용하는 주요 환경변수입니다.

```bash
PORT=4000
DB_PATH=data/app.db
KIS_API_BASE_URL=https://openapi.koreainvestment.com:9443
SECRET_ENCRYPTION_KEY=<base64-encoded 32-byte key>
SESSION_SECRET=<32 characters or longer>
ENABLE_LIVE_ORDER=false
ENABLE_RESERVED_ORDER=false
AUTO_TRADING_SCHEDULER_ENABLED=true
AUTO_TRADING_SCHEDULER_INTERVAL_MS=600000
```

`SECRET_ENCRYPTION_KEY`는 32바이트 난수를 base64로 인코딩한 값이어야 합니다.

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

`SESSION_SECRET`은 httpOnly session cookie 서명에 사용합니다. 운영 환경에서는 충분히 긴 임의 문자열로 설정합니다.

## KIS 설정

사용자는 로그인 후 `KIS 설정` 화면에서 본인의 KIS App Key와 App Secret을 등록합니다.

1. 한국투자증권 계좌와 KIS Developers 계정을 준비합니다.
2. KIS Developers에서 Open API 앱을 생성합니다.
3. App Key와 App Secret을 입력하고 저장합니다.
4. 연결 테스트로 access token 발급 가능 여부를 확인합니다.

App Secret과 access token은 frontend로 반환하지 않습니다. App Key는 masked 형태로만 표시하고, App Secret 원문은 저장 후 다시 표시하지 않습니다.

### KIS API 문서 기준

KIS REST API 구현은 프로젝트에 포함된 로컬 엑셀 문서를 우선 기준으로 확인합니다.

```text
KIS/한국투자증권_오픈API_전체문서_20260512_030000.xlsx
```

현재 사용하는 주요 API는 국내 현재가, 국내 기간별시세, 국내 주식기본조회, 해외 현재체결가, 해외 기간별시세, 해외 상품기본정보, 잔고, 매수가능금액, 미체결 주문, 주문/체결 조회, 현금 매수·매도 주문입니다.
해외 상품기본정보 응답의 소수점매매 가능 여부(`mint_dcpt_trad_psbl_yn`)는 종목 검색 결과에서 참고 정보로 표시합니다.

## 백테스트

1. 로그인합니다.
2. `KIS 설정`에서 App Key / App Secret을 저장합니다.
3. `백테스트` 화면을 엽니다.
4. 종목 검색에서 `TQQQ`, `005930` 같은 심볼 또는 종목코드를 입력하고 KIS 조회 결과를 선택합니다.
5. 기간, 총 투자금, 분할 회차, 목표 수익률을 입력합니다.
6. 실행하면 backend가 KIS Open API로 해당 기간의 일봉 데이터를 조회하고 캐시에 저장합니다.
7. 백테스트는 각 거래일의 `open`, `high`, `close` 가격으로 매수·매도 체결을 계산합니다.

현재 백테스트 알고리즘은 `LAOR_INFINITE_V2`입니다.

- 사이클 시작 시점의 총 시드 ÷ 분할 회차로 회차당 예산을 계산합니다. 예: 4,000 USD / 40분할 = 100 USD.
- 보유 수량이 없으면 해당 거래일 시가로 첫 매수를 계산합니다.
- 이후에는 회차당 예산을 큰수/작은수 LOC 매수로 나눠 종가 기준 체결 여부를 계산합니다.
- 장중 고가가 `평단가 × (1 + 목표 수익률)`에 닿으면 목표가에 전량 매도한 것으로 계산합니다.
- 목표 매도 후 새 사이클을 시작하면 실현 수익이나 손실이 반영된 현재 총자산을 다시 분할합니다. 예: 1,000 USD가 1,200 USD가 되었으면 다음 40분할은 30 USD씩 계산합니다.
- 분할 회차를 모두 쓰고 현금이 다음 회차 예산보다 적으면 보유 수량의 4분의 1을 종가에 매도해 다음 회차를 이어갑니다. 해외 종목은 소수점 6자리까지, 국내 종목은 최소 1주 단위로 계산합니다.

해외 종목 백테스트는 소수점 수량을 계산합니다. 예를 들어 회차 예산이 100 USD이고 시가가 150 USD이면 `0.666666`주 매수로 처리합니다. 국내 종목은 정수 주 단위로 계산합니다.

국내 종목은 KRW, 해외 종목은 KIS 응답 통화 기준으로 표시합니다. 수수료, 세금, 환율, 슬리피지는 계산에서 제외합니다. 결과는 투자 수익을 보장하지 않습니다.

## 자동매매

자동매매는 로그인한 사용자별 KIS credential과 계좌 설정을 사용합니다. 사용자가 웹에 접속하지 않아도 backend 서버가 실행 중이면 스케줄러가 RUNNING 전략을 최대 10분 간격으로 평가하고, token이 없거나 만료가 임박하면 저장된 App Key / App Secret으로 자동 재발급합니다.

사용 순서:

1. `KIS 설정`에서 App Key, App Secret, 계좌번호, 계좌 상품코드를 저장합니다.
   - 계좌번호(`CANO`)는 보통 KIS 계좌의 앞 8자리 (예: `12345678-01` 의 `12345678`).
   - 계좌상품코드(`ACNT_PRDT_CD`)는 뒤 2자리. 일반 위탁계좌는 보통 `01`. KIS HTS `[0301]` 화면에서 확인 가능.
2. `자동매매` 화면에서 종목을 검색해 선택합니다.
3. 총 예산, 분할 회차, 목표 수익률, 1회 주문 한도, 일일 주문 한도를 입력해 전략을 만듭니다.
4. 전략 상세에서 `시작`을 누르면 상태가 `RUNNING`이 되고 스케줄러 평가 대상이 됩니다.
5. `종료`를 누르면 상태가 `STOPPED`가 되어 이후 스케줄러 평가 대상에서 제외됩니다. 이미 접수된 주문은 자동 취소하지 않습니다.

### 통화·환전 동작

전략 통화는 종목 통화(국내 `KRW`, 미국 `USD`)를 그대로 따릅니다. 총 예산 입력값도 같은 통화입니다. 예: `TQQQ` 전략의 총 예산 `1000` = `1000 USD`.

미국 종목 자동매매에는 KRW → USD 자동 환전이 없습니다. 옵션은 둘 중 하나:

- **주식통합증거금 신청 (권장)** — KIS HTS `[0867] 통합증거금조회` 또는 영업점에서 신청. 신청한 계좌는 KRW 잔고가 환율 적용된 USD 매수가능금액에 자동 포함되며, 본 앱이 사용하는 KIS 매수가능금액 API(`/uapi/overseas-stock/v1/trading/inquire-psamount`, TR `TTTS3007R`)의 `frcr_ord_psbl_amt1` (외화 주문가능금액) 응답 필드에 가산되어 돌아옵니다.
- **수동 환전** — KIS HTS/MTS에서 KRW → USD 환전 후 USD 잔고로 매수. 통합증거금 미신청 계좌는 USD 잔고만 매수에 사용됩니다.

자산 평가는 종목 통화로 표시합니다. KRW 환산 가치가 필요하면 KIS 잔고조회 응답의 환율 필드(`exrt`)를 활용해 별도 계산이 필요합니다. 환율 정밀도와 환전 수수료는 본 MVP 계산에서 제외합니다.

실주문 실행 설정:

- 꺼짐: 자동매매는 계속 평가하지만 주문은 전송하지 않습니다. 현재가, 잔고, 매수가능금액, 미체결 주문을 조회하고 판단 로그, 모의 주문 기록, 포지션 스냅샷만 저장합니다.
- 켜짐: 자동매매 화면에 연결 계좌의 매수가능금액, 보유 수량, 평단, 미체결 주문 수를 표시합니다. 미체결 주문 없음, 중복 주문 아님, 주문 수량 0 초과, 1회/일일 주문 한도, 매수가능금액, 보유 수량 검사를 모두 통과한 경우 KIS 주문 API로 실제 매수/매도 주문을 전송합니다.
- 평가 로그: 전략을 시작하면 즉시 시작 로그를 남기고, 이후 스케줄러가 최대 10분 간격으로 현재가, 보유 수량, 평균단가, 매수가능금액, 회차, 미체결 주문 수, 실주문 설정을 판단 로그에 남깁니다.

안전 정책:

- 미체결 주문이 있으면 신규 주문하지 않습니다.
- 동일 전략·날짜·판단·회차 기준 중복 주문을 막습니다.
- 주문 실패는 자동 재시도하지 않습니다.
- 장 운영 시간이 아니거나 판단이 불확실하면 스케줄러는 `SKIP`으로 기록하고 주문하지 않습니다.
- App Secret, access token, 계좌번호 원문은 frontend로 반환하지 않고 로그에도 남기지 않습니다.

실주문은 투자 손실 위험이 있습니다. 실주문 실행 설정을 켜기 전에 전략, 계좌, 주문 한도, 미체결 주문 상태를 직접 확인해야 합니다.

메인 화면의 공통 전략 초안은 백테스트와 자동매매 전략 생성의 출발점입니다. 전략 상세에서 백테스트로 검증 또는 자동매매 전략 만들기를 누르면 종목, 예산, 분할 회차, 목표 수익률이 해당 화면에 자동으로 채워집니다.

## 주요 API

```text
POST   /api/auth/register
POST   /api/auth/login
POST   /api/auth/logout
GET    /api/auth/me

GET    /api/settings/kis
POST   /api/settings/kis
DELETE /api/settings/kis
POST   /api/settings/kis/test

GET    /api/market/stocks/search?q=TQQQ
GET    /api/market/:market/:symbol/price
GET    /api/market/:market/:symbol/daily?from=YYYY-MM-DD&to=YYYY-MM-DD

POST   /api/backtests
GET    /api/backtests
GET    /api/backtests/:id
GET    /api/backtests/:id/trades
DELETE /api/backtests/:id

GET    /api/auto-trading/settings
PUT    /api/auto-trading/settings/live-order
GET    /api/auto-trading/dashboard
POST   /api/auto-trading/strategies
GET    /api/auto-trading/strategies
GET    /api/auto-trading/strategies/:id
PUT    /api/auto-trading/strategies/:id
DELETE /api/auto-trading/strategies/:id
POST   /api/auto-trading/strategies/:id/start
POST   /api/auto-trading/strategies/:id/stop
POST   /api/auto-trading/strategies/:id/evaluate
GET    /api/auto-trading/strategies/:id/orders
GET    /api/auto-trading/strategies/:id/decisions
GET    /api/auto-trading/strategies/:id/positions
GET    /api/auto-trading/orders
GET    /api/auto-trading/orders/:id
POST   /api/auto-trading/orders/:id/refresh
```

모든 보호 API는 로그인한 사용자의 `userId` 기준으로만 조회/수정/삭제합니다.

## 개발

```bash
npm install
npm test
npm run build
npm run dev
```

`npm run dev`는 backend와 frontend 개발 서버를 함께 실행합니다.

## 보안 원칙

- 비밀번호는 bcrypt hash로 저장합니다.
- App Secret과 access token은 AES-256-GCM으로 암호화해 저장합니다.
- 비밀번호, App Secret, access token 원문을 로그에 출력하지 않습니다.
- frontend는 broker API를 직접 호출하지 않습니다.
- 실주문은 사용자별 실주문 실행 설정이 켜져 있고 미체결·중복·주문 한도·매수가능금액·보유 수량 검사를 통과한 경우에만 backend에서 호출합니다.
- 예약주문 API는 구현하지 않습니다.

## 배포

GitHub Actions, ECR, k3s, Argo CD 기반 배포 자동화를 사용합니다. `main`에 머지되면 배포 파이프라인이 실행됩니다.
