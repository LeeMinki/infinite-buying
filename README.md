# Infinite Buying

라오어의 무한매수법을 보조하기 위한 웹앱 MVP입니다. 서비스 이름은 **무한매수 해죠**입니다.

이 프로젝트는 실제 과거 가격으로 라오어 무한매수법을 백테스트하는 웹앱 MVP입니다. 실제 주문은 절대 실행하지 않으며, 결과는 전략 검증용 가상 계산으로만 저장됩니다.

## 이 프로젝트가 하는 일

- 전략을 생성, 조회, 수정, 삭제합니다.
- 전략별 가상 보유 상태와 판단 로그를 관리합니다.
- 실제 과거 일봉 종가를 기준으로 매수, 매도, 관망 판단을 날짜순으로 계산합니다.
- 키움 REST API로 현재가와 일봉 차트 데이터를 조회합니다.
- 전략 생성과 백테스트에서 종목을 검색하고 선택합니다.
- 키움 계좌 예수금/주문가능금액을 조회해 총 투자금 입력값으로 가져올 수 있습니다.
- 현재가 조회가 실패하면 사용자가 현재가를 직접 입력해 평가를 계속할 수 있습니다.
- 이메일/비밀번호 회원가입, 로그인, httpOnly session cookie 인증을 제공합니다.
- 사용자별 전략, 보유, 주문, 판단 로그, 키움 credential, 가격 데이터를 분리합니다.
- 백테스트 결과로 요약, 거래 이력, 자산 변화 차트, 평균단가 vs 종가 차트를 제공합니다.
- GitHub Actions, ECR, k3s, Argo CD 기반 배포 자동화를 사용합니다.

## 하지 않는 일

이 MVP는 전략 판단과 가상 기록만 다룹니다.

- 실주문을 하지 않습니다.
- 키움 주문 API를 호출하지 않습니다.
- 자동매매를 하지 않습니다.
- 수수료, 세금, 슬리피지 계산을 제공하지 않습니다. MVP에서는 모두 0으로 처리합니다.

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
- Backtest 화면
- 종목 검색 dropdown 및 선택 UI
- 키움 예수금 불러오기 버튼
- 전략 상세 화면
- Holding 상태 패널
- 현재가 조회 및 수동 입력 영역
- 평가 실행 영역
- 일봉 차트
- 가상 주문 이력
- 판단 로그

## 백테스트

백테스트는 실제 과거 일봉 데이터로 전략을 검증하는 기능입니다.

- 사용자는 종목, 기간, 총 투자금, 분할 회차, 목표 수익률을 입력합니다.
- 백테스트는 실제 과거 가격을 불러온 뒤 계산합니다.
- 각 거래일의 `close` 값을 해당 날짜의 가격으로 사용합니다.
- 결과로 summary, 거래 이력, 자산 변화 차트, 평균단가 vs 종가 차트를 확인할 수 있습니다.

### 일봉 가격 저장과 백테스트 입력 데이터

일봉 가격 조회 (`GET /api/market/:stockCode/daily`)는 현재 로그인 사용자의 `market_price_cache`에 실제 키움 일봉을 저장합니다.

- 백테스트 화면은 실행 직전에 `requireReal=true`로 일봉을 조회해 실제 키움 데이터가 저장되어 있는지 확인합니다.
- 저장된 사용자별 일봉이 요청 기간을 이미 충분히 덮고 있으면 backend는 그 행을 다시 사용합니다.
- 저장된 일봉이 없거나 기간이 부족하면 backend가 현재 사용자의 키움 credential로 Kiwoom REST API를 호출하고, 결과를 `(user_id, stock_code, date)` 기준으로 upsert합니다.
- `BacktestService`는 백테스트 계산 중 키움 API를 직접 호출하지 않고, 저장된 `KIWOOM` 출처의 일봉 행만 읽어 계산합니다.

이 구조는 백테스트가 실제 과거 가격으로 계산되도록 하면서도 같은 사용자가 같은 종목/기간을 반복 실행할 때 불필요한 외부 호출을 줄입니다.

### 투자 유의사항

백테스트 결과는 가상 계산이며 투자 수익을 보장하지 않습니다. 수수료, 세금, 슬리피지는 MVP에서 제외되어 실제 투자 결과와 다를 수 있습니다.

## 전략 계산 규칙

라오어 무한매수법(단기) 종가 기준 변형을 구현합니다. 매일 일봉 종가에 다음 우선순위로 판단합니다.

1. **익절 매도** — 종가 ≥ `평단가 × (1 + 목표 수익률)` 이면 보유 전량을 매도하고 새 사이클 시작 (회차 1로 리셋). `restartAfterSell=false`로 실행하면 첫 매도 시 백테스트가 종료됩니다 (기본값은 `true`).
2. **시드 재확보 매도** — 분할 회차를 모두 소진(`currentRound > splitCount`)했는데 익절이 발생하지 않았으면 보유 수량의 `1/4(올림)`을 매도해 현금을 회수하고 회차 1부터 다시 매수합니다. 잔여 보유의 평단가는 그대로 유지됩니다.
3. **종료** — 분할 회차를 모두 소진했고 보유 수량도 0이면 백테스트를 종료합니다 (`COMPLETED`).
4. **회차 매수** — 위 조건이 모두 아니면 평단가 대비 종가에 따라 수량을 다르게 매수합니다.
   - `baseQty = floor(회차예산 / 종가)`, `회차예산 = 총 투자금 / 분할 회차`.
   - 첫 매수(보유 0): `baseQty`주 매수.
   - 종가 < 평단가 (쌀 때): `baseQty × 2`주 매수 (코스트 애버리징).
   - 종가 ≥ 평단가 (비쌀 때): `max(1, floor(baseQty / 2))`주 매수.
   - 잔여 현금이 부족해 1주도 매수할 수 없으면 그날은 `HOLD`.

기본값은 `분할 회차 = 40`, `목표 수익률 = 10%`, `restartAfterSell = true`입니다. 수수료/세금/슬리피지는 0으로 계산합니다.

실제 라오어 무한매수법은 LOC 분할지정가 등 장중 호가에 의존하지만 본 백테스트는 일봉 종가만 사용하므로, “쌀 때 2배 / 비쌀 때 1/2” 형태의 단순화된 종가 기준 변형입니다.

## 데이터 모델

SQLite에는 다음 테이블이 생성됩니다.

- `strategies`: 전략 설정
- `holdings`: 전략별 가상 보유 상태
- `virtual_orders`: 가상 주문
- `decision_logs`: 평가 판단 로그
- `users`: 로그인 사용자
- `kiwoom_credentials`: 사용자별 키움 App Key / Secret Key 암호화 저장
- `market_price_cache`: 사용자별 일봉 가격 저장소
- `backtest_runs`: 사용자별 백테스트 실행 summary
- `backtest_trades`: 사용자별 백테스트 일자별 판단/거래 기록

DB 스키마는 [backend/src/db/schema.sql](backend/src/db/schema.sql)에 있습니다.

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

시장 데이터는 키움 REST API만 사용합니다.

```text
MARKET_DATA_PROVIDER=kiwoom
ENABLE_LIVE_ORDER=false
```

운영 배포에서는 다음 값을 반드시 설정합니다.

```text
EC2_ELASTIC_IP=<backend EC2 Elastic IP>
KIWOOM_API_BASE_URL=https://api.kiwoom.com
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
3. 모든 전략, 보유, 가상 주문, 판단 로그, 키움 credential, 일봉 가격 데이터는 현재 로그인한 사용자 `userId` 기준으로 분리됩니다.
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

연결 테스트는 저장된 사용자의 App Key / Secret Key로 키움 access token 발급 가능 여부를 확인합니다.

전략 생성 화면에서는 종목 검색과 예수금 조회도 backend를 통해서만 실행합니다.

- 종목 검색: 운영 환경에서는 키움 REST API의 종목정보 리스트를 조회해 backend에서 종목코드/종목명으로 필터링합니다. 결과는 dropdown 목록으로 표시되고, 선택하면 `stockCode`와 `stockName`이 함께 저장됩니다.
- 예수금 조회: 운영 환경에서는 키움 계좌 API를 통해 예수금/주문가능금액을 조회하고, `총 투자금` 입력값으로 가져옵니다.
backend 환경변수 예시는 다음과 같습니다.

```text
PORT=4000
DB_PATH=data/app.db
MARKET_DATA_PROVIDER=kiwoom
EC2_ELASTIC_IP=<backend EC2 Elastic IP>
KIWOOM_API_BASE_URL=https://api.kiwoom.com
KIWOOM_TIMEOUT_MS=5000
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

운영 EC2는 k3s Pod CIDR와 AWS VPC DNS 대역 충돌을 피하기 위해 `infra/operations/install-ec2-runtime-guards.sh`의 DNS/swap guard를 적용합니다. CoreDNS가 `/etc/resolv.conf`를 upstream으로 사용하면 DNS loop가 생길 수 있으므로, CoreDNS upstream은 `169.254.169.253`으로 고정해야 합니다.

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
POST   /api/backtests
GET    /api/backtests
GET    /api/backtests/:id
GET    /api/backtests/:id/trades
DELETE /api/backtests/:id
```

## 기본 사용 흐름

1. 웹앱에 접속합니다.
2. 회원가입 또는 로그인을 합니다.
3. 키움 설정 화면에서 EC2 Elastic IP 안내를 확인하고 App Key / Secret Key를 등록합니다.
4. `백테스트` 화면에서 종목, 기간, 총 투자금, 분할 회차, 목표 수익률, restartAfterSell을 입력합니다.
5. 백테스트를 실행하면 실제 과거 가격을 불러와 전략 결과를 계산합니다.
6. 요약, 거래 이력, 자산 변화 차트, 평균단가 vs 종가 차트를 확인합니다.

## 개발 원칙

- 모든 줄바꿈은 Linux 기준 `LF`를 사용합니다.
- `main` 브랜치에 직접 push하지 않습니다.
- 작업 브랜치에서 개발하고 Pull Request를 만든 뒤 검토 후 merge합니다.
- PR description에는 구현 내용, 테스트 결과, 남은 제약을 상세히 적습니다.
- 실주문 관련 코드는 추가하지 않습니다.
- PR description은 한국어로 작성합니다.

## 현재 MVP의 한계

- 미국주식 실제 시세 provider는 아직 별도로 붙어 있지 않습니다.
- 현재 Kiwoom provider는 한국 주식 REST API 연동을 위한 구조입니다.
- 키움 종목명 검색은 키움 종목정보 리스트를 backend에서 조회한 뒤 앱에서 필터링하는 방식입니다.
- 키움 계좌 연동은 예수금/주문가능금액 조회까지만 지원합니다.
- 수수료, 세금, 슬리피지는 MVP 계산에서 제외합니다.
- 라오어 무한매수법의 모든 세부 변형을 구현한 것은 아니며, MVP 규칙 중심으로 구현되어 있습니다.
- 자동 스케줄링이나 알림 기능은 없습니다.
- 데이터는 로컬 SQLite 파일에 저장됩니다.
