# Infinite Buying

라오어의 무한매수법을 보조하기 위한 웹앱 MVP입니다. 서비스 이름은 **무한매수 해죠**입니다.

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
- 전략 생성 시 키움 REST API 또는 mock 데이터를 통해 종목을 검색하고 선택합니다.
- 키움 계좌 예수금/주문가능금액을 조회해 총 투자금 입력값으로 가져올 수 있습니다.
- 현재가 조회가 실패하면 사용자가 현재가를 직접 입력해 평가를 계속할 수 있습니다.
- 이메일/비밀번호 회원가입, 로그인, httpOnly session cookie 인증을 제공합니다.
- 사용자별 전략, 보유, 주문, 판단 로그, 키움 credential, 시세 cache를 분리합니다.
- GitHub Actions, ECR, k3s, Argo CD 기반 배포 자동화를 사용합니다.

## 하지 않는 일

이 MVP는 전략 판단과 가상 기록만 다룹니다.

- 실주문을 하지 않습니다.
- 키움 주문 API를 호출하지 않습니다.
- 자동매매를 하지 않습니다.
- LIVE 모드를 제공하지 않습니다.
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
- `KiwoomMarketDataProvider`: 키움 REST API 기반 현재가/일봉/종목검색/예수금 조회 provider
- `strategyCalculator`: 전략 판단을 담당하는 순수 계산 함수
- `auth`: 회원가입, 로그인, httpOnly session cookie 인증
- `kiwoomCredentialService`: 사용자별 App Key / Secret Key 암호화 저장
- `repositories`: SQLite 테이블별 데이터 접근 계층
- `services`: 전략 생성, 평가, 가상 주문 체결/취소 로직

### Frontend

Frontend는 React, Vite, Recharts로 구현되어 있습니다.

주요 화면은 다음과 같습니다.

- 전략 목록 및 전략 생성 화면
- 회원가입/로그인 화면
- 키움 REST API 설정 화면
- 종목 검색 dropdown 및 선택 UI
- 키움 예수금 불러오기 버튼
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
- `users`: 로그인 사용자
- `kiwoom_credentials`: 사용자별 키움 App Key / Secret Key 암호화 저장
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
ENABLE_LIVE_ORDER=false
```

mock mode에서는 키움 인증정보 없이 현재가와 일봉 차트 데이터를 테스트할 수 있습니다.
키움 설정 화면에서 `Mock API` 환경을 선택한 경우에도 종목 검색과 예수금 조회는 앱 내부 mock 데이터를 사용합니다. 외부 `mockapi.kiwoom.com`이 특정 조회 API를 제공하지 않아도 전략 생성 흐름을 테스트할 수 있게 하기 위함입니다.

운영 배포에서는 다음 값을 반드시 설정합니다.

```text
EC2_ELASTIC_IP=<backend EC2 Elastic IP>
KIWOOM_API_BASE_URL=https://api.kiwoom.com
KIWOOM_MOCK_API_BASE_URL=https://mockapi.kiwoom.com
SECRET_ENCRYPTION_KEY=<base64 32-byte key>
SESSION_SECRET=<32 chars or longer random string>
ENABLE_LIVE_ORDER=false
```

`SECRET_ENCRYPTION_KEY`는 Secret Key와 access token 암호화에 사용합니다. 다음처럼 32바이트 키를 base64로 만들 수 있습니다.

```bash
openssl rand -base64 32
```

`SESSION_SECRET`은 session cookie 서명에 사용하는 긴 난수 문자열입니다. 운영에서는 반드시 별도 값으로 설정하고 커밋하지 않습니다.

Kubernetes 배포에서는 backend pod가 `infinite-buying-secrets` Secret에서 두 값을 읽습니다.

```bash
kubectl -n infinite-buying create secret generic infinite-buying-secrets \
  --from-literal=SECRET_ENCRYPTION_KEY="$(openssl rand -base64 32)" \
  --from-literal=SESSION_SECRET="$(openssl rand -base64 48)"
```

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

## 회원가입/로그인

처음 접속하면 회원가입 또는 로그인 화면이 표시됩니다.

1. 이메일과 8자 이상 비밀번호로 회원가입합니다.
2. 로그인 후 전략 화면을 사용할 수 있습니다.
3. 모든 전략, 보유, 가상 주문, 판단 로그, 키움 credential, 일봉 cache는 현재 로그인한 사용자 `userId` 기준으로 분리됩니다.
4. 다른 사용자의 데이터 id를 직접 요청해도 조회, 수정, 삭제할 수 없습니다.

비밀번호는 bcrypt hash로만 저장하며 평문으로 저장하지 않습니다.

## 키움 REST API 설정

키움 REST API를 사용하려면 사용자가 키움 REST API 사이트에서 App Key / Secret Key를 미리 직접 발급받아야 합니다. 이 값은 frontend가 키움 API를 직접 호출하는 데 사용하지 않고, EC2 backend가 사용자의 credential을 복호화한 뒤 키움 REST API를 호출하는 구조입니다.

사용 흐름은 다음과 같습니다.

1. 로그인 후 `키움 설정` 화면을 엽니다.
2. 키움 REST API 사용 신청과 App Key / Secret Key 발급을 완료합니다.
3. 키움 REST API 사이트의 계좌 App Key 관리 화면에서 IP를 등록합니다.
4. 등록할 IP는 브라우저 사용자 PC IP가 아니라 EC2 backend 서버의 outbound public IP, 즉 `EC2_ELASTIC_IP`입니다.
5. 앱 화면에 표시되는 `현재 등록해야 할 서버 IP`를 키움에 등록합니다.
6. App Key / Secret Key를 저장하고 연결 테스트를 실행합니다.

Secret Key와 access token은 frontend로 반환하지 않습니다. 저장 후 Secret Key 원문도 다시 화면에 표시하지 않으며, App Key는 masked 형태로만 표시합니다.

연결 테스트의 의미는 선택한 환경에 따라 다릅니다.

- `운영 REST API`: 저장된 사용자의 App Key / Secret Key로 실제 키움 token 발급을 확인합니다.
- `키움 Mock API`: 실제 계정 연결 검증 대신 앱 내부 mock token을 발급해 설정 흐름을 확인합니다.

전략 생성 화면에서는 종목 검색과 예수금 조회도 backend를 통해서만 실행합니다.

- 종목 검색: 운영 환경에서는 키움 REST API의 종목정보 리스트를 조회해 backend에서 종목코드/종목명으로 필터링합니다. 결과는 dropdown 목록으로 표시되고, 선택하면 `stockCode`와 `stockName`이 함께 저장됩니다.
- 예수금 조회: 운영 환경에서는 키움 계좌 API를 통해 예수금/주문가능금액을 조회하고, `총 투자금` 입력값으로 가져옵니다.
- Mock 환경: 외부 키움 mock endpoint가 404를 반환할 수 있으므로 앱 내부 mock 종목/예수금 데이터를 반환합니다.

backend 환경변수 예시는 다음과 같습니다.

```text
PORT=4000
DB_PATH=data/app.db
MARKET_DATA_PROVIDER=kiwoom
EC2_ELASTIC_IP=<backend EC2 Elastic IP>
KIWOOM_API_BASE_URL=https://api.kiwoom.com
KIWOOM_MOCK_API_BASE_URL=https://mockapi.kiwoom.com
KIWOOM_TIMEOUT_MS=5000
KIWOOM_USE_MOCK=false
SECRET_ENCRYPTION_KEY=<base64 32-byte key>
SESSION_SECRET=<32 chars or longer random string>
SESSION_COOKIE_SECURE=true
ENABLE_LIVE_ORDER=false
```

주의할 점:

- 사용자의 App Key와 Secret Key는 `.env`가 아니라 로그인 후 키움 설정 화면에서 등록합니다.
- `.env` 파일은 `.gitignore`에 포함되어 있습니다.
- 키움 연동은 현재가 조회와 일봉 차트 조회까지만 사용합니다.
- 키움 계좌 API는 예수금/주문가능금액 조회에만 사용합니다.
- 키움 주문 API는 구현하지 않습니다.
- 실주문은 아직 지원하지 않습니다. `ENABLE_LIVE_ORDER=false`를 유지해야 합니다.
- 키움 access token 발급이 실패하면 키움 사이트에서 EC2 Elastic IP 등록 여부를 확인해야 합니다.

## 배포와 GitOps

`main`에 PR이 merge되면 GitHub Actions의 `Deploy Main` workflow가 실행됩니다.

1. backend/frontend Docker image를 빌드합니다.
2. Amazon ECR에 image를 push합니다.
3. `infra/kubernetes/infinite-buying/overlays/mvp/kustomization.yaml`의 image tag를 merge commit SHA로 갱신합니다.
4. `[skip deploy]`가 포함된 GitOps commit을 main에 추가합니다.
5. Argo CD가 해당 GitOps commit을 감지하고 k3s 클러스터에 자동 sync합니다.

현재 Argo CD는 `argocd-server`와 GitHub webhook 없이 core 컴포넌트 poll 기반으로 동작합니다. GitHub webhook이 없기 때문에 GitOps commit 직후 몇 분간 이전 revision을 볼 수 있었고, 이를 줄이기 위해 다음 운영 설정을 적용했습니다.

- `timeout.reconciliation=30s`
- `timeout.reconciliation.jitter=5s`
- `reposerver.repo.cache.expiration=30s`
- `controller.app.state.cache.expiration=30s`

관련 문서는 `infra/kubernetes/argocd/README.md`, 설정 예시는 `infra/kubernetes/argocd/runtime-tuning.yaml`에 있습니다.

## 주요 API

```text
GET    /api/health
POST   /api/auth/register
POST   /api/auth/login
POST   /api/auth/logout
GET    /api/auth/me
GET    /api/settings/kiwoom
POST   /api/settings/kiwoom
DELETE /api/settings/kiwoom
POST   /api/settings/kiwoom/test
GET    /api/account/deposit
GET    /api/strategies
POST   /api/strategies
GET    /api/strategies/:id
PUT    /api/strategies/:id
DELETE /api/strategies/:id
GET    /api/strategies/:id/holding
POST   /api/strategies/:id/evaluate
GET    /api/market/stocks/search?q=<query>
GET    /api/market/:stockCode/price
GET    /api/market/:stockCode/daily
GET    /api/strategies/:id/orders
POST   /api/orders/:id/fill
POST   /api/orders/:id/cancel
GET    /api/strategies/:id/logs
```

## 기본 사용 흐름

1. 웹앱에 접속합니다.
2. 회원가입 또는 로그인을 합니다.
3. 키움 설정 화면에서 EC2 Elastic IP 안내를 확인하고 App Key / Secret Key를 등록합니다.
4. 전략명을 입력합니다.
5. 종목 검색 dropdown에서 종목코드/종목명을 선택합니다.
6. 총 투자금, 분할 회차, 목표수익률을 입력합니다.
7. 필요하면 `키움 예수금 불러오기`로 총 투자금을 채웁니다.
8. 전략을 저장합니다.
9. 전략 상세 화면에서 현재가 조회를 실행합니다.
10. 현재가 조회가 실패하면 현재가를 직접 입력합니다.
11. `Evaluate`를 실행합니다.
12. 판단 결과와 가상 주문 생성 여부를 확인합니다.
13. 생성된 가상 주문을 체결 또는 취소합니다.
14. Holding, 주문 이력, 판단 로그를 확인합니다.

## 개발 원칙

- 모든 줄바꿈은 Linux 기준 `LF`를 사용합니다.
- `main` 브랜치에 직접 push하지 않습니다.
- 작업 브랜치에서 개발하고 Pull Request를 만든 뒤 검토 후 merge합니다.
- PR description에는 구현 내용, 테스트 결과, 남은 제약을 상세히 적습니다.
- 실주문 관련 코드는 추가하지 않습니다.

## 현재 MVP의 한계

- 미국주식 실제 시세 provider는 아직 별도로 붙어 있지 않습니다.
- 현재 Kiwoom provider는 한국 주식 REST API 연동을 위한 구조입니다.
- 키움 종목명 검색은 키움 종목정보 리스트를 backend에서 조회/캐시한 뒤 앱에서 필터링하는 방식입니다.
- 키움 계좌 연동은 예수금/주문가능금액 조회까지만 지원합니다.
- 라오어 무한매수법의 모든 세부 변형을 구현한 것은 아니며, MVP 규칙 중심으로 구현되어 있습니다.
- 자동 스케줄링이나 알림 기능은 없습니다.
- 데이터는 로컬 SQLite 파일에 저장됩니다.
