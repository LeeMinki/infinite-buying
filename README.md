# Infinite Buying

라오어의 미국주식 무한매수법을 보조하기 위한 로컬 웹앱 MVP입니다.

이 프로젝트는 사용자가 직접 만든 전략을 기준으로 현재가, 보유 상태, 전략 설정을 계산해 `BUY`, `SELL`, `HOLD`, `PAUSE` 판단을 보여줍니다. 실제 주문은 절대 실행하지 않으며, 모든 주문은 앱 내부의 가상 주문인 `VirtualOrder`로만 저장됩니다.

## 이 프로젝트가 하는 일

- 전략을 생성, 조회, 수정, 삭제합니다.
- 전략별 가상 보유 상태를 관리합니다.
- 현재가를 기준으로 매수, 매도, 보류, 일시정지 판단을 계산합니다.
- 판단 결과를 `DecisionLog`로 저장합니다.
- 매수 또는 매도 조건이 맞으면 실제 주문이 아닌 가상 주문을 생성합니다.
- 가상 주문을 체결 또는 취소 처리할 수 있습니다.
- 가상 주문 체결 시 보유 수량, 평균단가, 잔여 예산, 실현 손익을 갱신합니다.
- 키움 REST API 또는 mock 데이터를 통해 현재가와 일봉 차트 데이터를 조회합니다.
- 현재가 조회가 실패하면 사용자가 현재가를 직접 입력해 평가를 계속할 수 있습니다.

## 하지 않는 일

이 MVP는 전략 판단과 가상 기록만 다룹니다.

- 실주문을 하지 않습니다.
- 키움 주문 API를 호출하지 않습니다.
- 자동매매를 하지 않습니다.
- LIVE 모드를 제공하지 않습니다.
- 로그인이나 다중 사용자 기능을 제공하지 않습니다.
- 배포 자동화를 포함하지 않습니다.
- 복잡한 백테스트를 제공하지 않습니다.

## 구현 방식

프로젝트는 `backend`와 `frontend`로 나뉘어 있습니다.

```text
backend/
  src/
    app.js
    server.js
    config/
    db/
    market-data/
    repositories/
    routes/
    services/
  tests/

frontend/
  src/
    api/
    components/
    pages/
```

### Backend

Backend는 Node.js, Express, SQLite로 구현되어 있습니다.

주요 구성은 다음과 같습니다.

- `Express`: REST API 서버
- `better-sqlite3`: 로컬 SQLite DB 접근
- `MarketDataProvider`: 시장 데이터 provider 인터페이스
- `MockMarketDataProvider`: 키움 인증정보가 없어도 동작하는 mock provider
- `KiwoomMarketDataProvider`: 키움 REST API 기반 현재가/일봉 조회 provider
- `strategyCalculator`: 전략 판단을 담당하는 순수 계산 함수
- `repositories`: SQLite 테이블별 데이터 접근 계층
- `services`: 전략 생성, 평가, 가상 주문 체결/취소 로직

### Frontend

Frontend는 React, Vite, Recharts로 구현되어 있습니다.

주요 화면은 다음과 같습니다.

- 전략 목록 및 전략 생성 화면
- 전략 상세 화면
- Holding 상태 패널
- 현재가 조회 및 수동 입력 영역
- evaluate 실행 영역
- 일봉 차트
- 가상 주문 이력
- 판단 로그

## 전략 계산 규칙

기본 규칙은 다음과 같습니다.

- 기본 분할 회차는 `40회`입니다.
- 기본 목표수익률은 평균단가 대비 `+10%`입니다.
- 1회 매수금액은 `총 투자금 / 분할 회차`입니다.
- 매수 수량은 `floor(1회 매수금액 / 현재가)`입니다.
- 현재가가 `평균단가 * 1.1` 이상이면 보유 수량 전량 매도 예정으로 판단합니다.
- 매도 조건이 충족되지 않으면 매수 가능 여부를 판단합니다.
- 매수 수량이 `0`이면 `HOLD`입니다.
- 전략 상태가 `PAUSED`이면 `PAUSE`입니다.
- 같은 전략, 같은 날짜, 같은 회차의 `BUY` 가상 주문은 중복 생성되지 않습니다.

## 데이터 모델

SQLite에는 다음 테이블이 생성됩니다.

- `strategies`: 전략 설정
- `holdings`: 전략별 가상 보유 상태
- `virtual_orders`: 가상 주문
- `decision_logs`: 평가 판단 로그
- `market_price_cache`: 일봉 가격 캐시

DB 스키마는 [backend/src/db/schema.sql](/home/hyerin/speckit/infinite-buying/backend/src/db/schema.sql)에 있습니다.

## 클론 후 실행 방법

### 1. 저장소 클론

```bash
git clone https://github.com/LeeMinki/infinite-buying.git
cd infinite-buying
```

### 2. 의존성 설치

루트에서 한 번에 설치할 수 있습니다.

```bash
npm install
```

또는 backend/frontend를 따로 설치할 수도 있습니다.

```bash
cd backend
npm install

cd ../frontend
npm install
```

### 3. 환경변수 설정

backend 환경변수 파일을 만듭니다.

```bash
cd backend
cp .env.example .env
```

기본값은 mock mode입니다.

```text
MARKET_DATA_PROVIDER=mock
```

mock mode에서는 키움 인증정보 없이 현재가와 일봉 차트 데이터를 테스트할 수 있습니다.

### 4. DB 초기화

루트에서 실행할 수 있습니다.

```bash
npm run migrate
```

또는 backend에서 직접 실행할 수 있습니다.

```bash
cd backend
npm run migrate
```

### 5. 테스트 실행

```bash
npm test
```

현재는 전략 계산 함수 테스트가 포함되어 있습니다.

### 6. 개발 서버 실행

루트에서 backend와 frontend를 함께 실행합니다.

```bash
npm run dev
```

실행 후 접속 주소는 다음과 같습니다.

```text
Frontend: http://localhost:5173
Backend:  http://localhost:4000
```

backend만 따로 실행하려면 다음을 사용합니다.

```bash
cd backend
npm run dev
```

frontend만 따로 실행하려면 다음을 사용합니다.

```bash
cd frontend
npm run dev
```

## 포트 충돌 해결

backend 기본 포트는 `4000`입니다.

이미 `4000` 포트가 사용 중이면 기존 backend 프로세스를 종료하거나 다른 포트로 실행합니다.

먼저 `4000` 포트를 점유 중인 프로세스를 확인합니다.

```bash
ss -ltnp 'sport = :4000'
```

출력 예시는 다음과 비슷합니다.

```text
LISTEN 0 511 *:4000 *:* users:(("MainThread",pid=23570,fd=23))
```

여기서 `pid=23570`이 종료할 프로세스 ID입니다. 해당 PID를 `kill`로 종료합니다.

```bash
kill 23570
```

그래도 종료되지 않으면 마지막 수단으로 강제 종료합니다.

```bash
kill -9 23570
```

Node 개발 서버가 여러 개 남아 있는지 확인하려면 다음 명령을 사용할 수 있습니다.

```bash
ps -ef | grep 'node --watch src/server.js'
```

프로젝트의 backend dev server만 종료해야 합니다. 다른 프로젝트나 시스템 프로세스의 PID를 종료하지 않도록 명령 출력의 경로를 확인하세요.

```bash
cd backend
PORT=4001 npm run dev
```

이 경우 frontend에서 다른 backend 주소를 쓰려면 frontend 실행 시 API 주소도 맞춰야 합니다.

```bash
cd frontend
VITE_API_BASE=http://localhost:4001 npm run dev
```

## 키움 REST API 설정

키움 REST API를 사용하려면 `backend/.env`에 인증정보를 설정합니다.

```text
PORT=4000
DB_PATH=data/app.db
MARKET_DATA_PROVIDER=kiwoom
KIWOOM_BASE_URL=https://api.kiwoom.com
KIWOOM_MOCK_BASE_URL=https://mockapi.kiwoom.com
KIWOOM_APP_KEY=<your app key>
KIWOOM_SECRET_KEY=<your app secret>
KIWOOM_TIMEOUT_MS=5000
KIWOOM_USE_MOCK=false
```

주의할 점:

- `KIWOOM_APP_KEY`와 `KIWOOM_SECRET_KEY`는 절대 커밋하지 않습니다.
- `.env` 파일은 `.gitignore`에 포함되어 있습니다.
- 키움 연동은 현재가 조회와 일봉 차트 조회까지만 사용합니다.
- 키움 주문 API는 구현하지 않습니다.
- 키움 인증정보가 없거나 provider 설정이 mock이면 mock 데이터로 동작합니다.

## 주요 API

```text
GET    /api/health
GET    /api/strategies
POST   /api/strategies
GET    /api/strategies/:id
PUT    /api/strategies/:id
DELETE /api/strategies/:id
GET    /api/strategies/:id/holding
POST   /api/strategies/:id/evaluate
GET    /api/market/:stockCode/price
GET    /api/market/:stockCode/daily
GET    /api/strategies/:id/orders
POST   /api/orders/:id/fill
POST   /api/orders/:id/cancel
GET    /api/strategies/:id/logs
```

## 기본 사용 흐름

1. 웹앱에 접속합니다.
2. 전략명을 입력합니다.
3. 종목코드와 종목명을 입력합니다.
4. 총 투자금, 분할 회차, 목표수익률을 입력합니다.
5. 전략을 저장합니다.
6. 전략 상세 화면에서 현재가 조회를 실행합니다.
7. 현재가 조회가 실패하면 현재가를 직접 입력합니다.
8. `Evaluate`를 실행합니다.
9. 판단 결과와 가상 주문 생성 여부를 확인합니다.
10. 생성된 가상 주문을 체결 또는 취소합니다.
11. Holding, 주문 이력, 판단 로그를 확인합니다.

## 개발 원칙

- 모든 줄바꿈은 Linux 기준 `LF`를 사용합니다.
- `main` 브랜치에 직접 push하지 않습니다.
- 작업 브랜치에서 개발하고 Pull Request를 만든 뒤 검토 후 merge합니다.
- PR description에는 구현 내용, 테스트 결과, 남은 제약을 상세히 적습니다.
- 실주문 관련 코드는 추가하지 않습니다.

## 현재 MVP의 한계

- 미국주식 실제 시세 provider는 아직 별도로 붙어 있지 않습니다.
- 현재 Kiwoom provider는 한국 주식 REST API 연동을 위한 구조입니다.
- 라오어 무한매수법의 모든 세부 변형을 구현한 것은 아니며, MVP 규칙 중심으로 구현되어 있습니다.
- 자동 스케줄링이나 알림 기능은 없습니다.
- 데이터는 로컬 SQLite 파일에 저장됩니다.
