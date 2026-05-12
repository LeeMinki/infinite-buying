# Infinite Buying

라오어 무한매수법 스타일 전략을 한국투자증권(Korea Investment & Securities Co., Ltd., 이하 KIS) Open API 실제 일봉 데이터로 백테스트하는 웹앱입니다. 기본 예시는 `TQQQ`이며, 국내 종목은 KRW, 해외 종목은 KIS 응답 통화 기준으로 계산합니다.

## 현재 지원 범위

- 이메일/비밀번호 회원가입, 로그인, httpOnly session cookie 인증
- 사용자별 전략, 가상 보유, 가상 주문, 판단 로그 분리
- 사용자별 KIS App Key / App Secret 암호화 저장
- KIS Open API access token 발급 및 재사용
- 국내/해외 종목 현재가 조회
- 국내/해외 종목 일봉 조회 및 `market_price_cache` 저장
- KIS 일봉 시가·고가·종가 기준 백테스트
- 백테스트 요약, 거래 이력, 자산 변화 차트, 평균단가 vs 종가 차트

## 지원하지 않는 범위

- 실주문
- 예약주문
- 자동매매
- KIS 주문 API 호출
- KIS 예약주문 API 호출
- 수수료, 세금, 환율, 슬리피지 계산

`ENABLE_LIVE_ORDER=false`와 `ENABLE_RESERVED_ORDER=false`를 유지해야 합니다.

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

현재 사용하는 주요 API는 국내 현재가, 국내 기간별시세, 국내 주식기본조회, 해외 현재체결가, 해외 기간별시세, 해외 상품기본정보입니다.
해외 상품기본정보 응답의 소수점매매 가능 여부(`mint_dcpt_trad_psbl_yn`)는 종목 검색 결과에서 참고 정보로 표시합니다. 이 앱은 주문 기능을 구현하지 않습니다.

## 백테스트

1. 로그인합니다.
2. `KIS 설정`에서 App Key / App Secret을 저장합니다.
3. `백테스트` 화면을 엽니다.
4. 종목 검색에서 `TQQQ`, `005930` 같은 심볼 또는 종목코드를 입력하고 KIS 조회 결과를 선택합니다.
5. 기간, 총 투자금, 분할 회차, 목표 수익률을 입력합니다.
6. 실행하면 backend가 KIS Open API로 해당 기간의 일봉 데이터를 조회하고 캐시에 저장합니다.
7. 백테스트는 각 거래일의 `open`, `high`, `close` 가격으로 매수·매도 체결을 계산합니다.

현재 백테스트 알고리즘은 `LAOR_INFINITE_V2`입니다.

- 총 시드 ÷ 분할 회차로 회차당 예산을 계산합니다. 예: 4,000 USD / 40분할 = 100 USD.
- 보유 수량이 없으면 해당 거래일 시가로 첫 매수를 계산합니다.
- 이후에는 회차당 예산을 큰수/작은수 LOC 매수로 나눠 종가 기준 체결 여부를 계산합니다.
- 장중 고가가 `평단가 × (1 + 목표 수익률)`에 닿으면 목표가에 전량 매도한 것으로 계산합니다.
- 분할 회차를 모두 썼는데 목표 매도가 나오지 않으면 일부 보유 수량을 종가에 매도해 다음 회차를 이어갑니다.

해외 종목 백테스트는 소수점 수량을 계산합니다. 예를 들어 회차 예산이 100 USD이고 시가가 150 USD이면 `0.666666`주 매수로 처리합니다. 국내 종목은 정수 주 단위로 계산합니다.

국내 종목은 KRW, 해외 종목은 KIS 응답 통화 기준으로 표시합니다. 수수료, 세금, 환율, 슬리피지는 계산에서 제외합니다. 결과는 투자 수익을 보장하지 않습니다.

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
- broker 주문/예약주문 API는 구현하지 않습니다.

## 배포

GitHub Actions, ECR, k3s, Argo CD 기반 배포 자동화를 사용합니다. `main`에 머지되면 배포 파이프라인이 실행됩니다.
