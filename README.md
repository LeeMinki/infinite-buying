# Infinite Buying

한국투자증권(Korea Investment & Securities Co., Ltd., 이하 KIS) Open API를 사용해 **주식 전략을 백테스트하고 실제 자동매매까지 실행**하는 사용자별 웹 애플리케이션입니다. 기본 예시는 `TQQQ`이며, 국내 종목은 KRW, 해외 종목은 KIS 응답 통화(주로 USD) 기준으로 계산합니다.

> ⚠️ **실제 돈이 오가는 라이브 매매 시스템입니다.** 실주문은 사용자별 `liveOrderEnabled` 설정이 켜졌을 때만 실행되며, 미체결·중복·매수가능금액·보유 수량 안전 검사를 통과해야 전송됩니다. 코드를 수정할 때는 항상 이 안전망과 사용자 자원 격리를 깨지 않는지 확인하세요.

## 지원하는 전략 (3종, 서로 독립)

| 전략 | 식별자 | 요약 | 평가 주기 |
| --- | --- | --- | --- |
| 라오어 무한매수법 | `LAOR_INFINITE_V2` | 단일 종목 분할 매수·평단가/큰수 매수·목표 익절 후 재시작 | 10분 |
| 한국 국장 상승률 랭킹 전략 | `KR_RANK_MOMENTUM` | 오전/점심 진입 시 등락률 상위 종목을 단기 흐름 필터로 매수, 목표·손절·청산시각 매도 | 30초 |
| 미국장 상승률 랭킹 전략 | `US_RANK_MOMENTUM` | 미국 정규장 중 상승률 상위 종목을 유동성·과열·단기 흐름 필터로 매수, 목표·손절·강제청산·누적목표 매도(체결 확인 후 청산 확정) | 30초 |

세 전략은 테이블·서비스·스케줄러 타이머·라우트·프론트 패널이 모두 분리되어 있고, 실주문 실행 설정과 KIS 연동만 공유합니다.

## 클론 후 시작하기

```bash
# 1. 의존성 설치 (npm workspaces: 루트에서 backend·frontend 모두 설치)
npm install

# 2. backend 환경변수 준비 (아래 "환경변수" 절 참고)
cp backend/.env.example backend/.env   # 예시 파일이 없으면 직접 작성
#   - SECRET_ENCRYPTION_KEY, SESSION_SECRET 은 반드시 새로 생성

# 3. DB 마이그레이션 (SQLite, 순서대로 적용)
npm run migrate

# 4. 테스트로 동작 확인
npm test

# 5. 개발 서버 (backend:4000 + frontend dev 서버 동시 실행)
npm run dev
```

KIS App Key/Secret/계좌 정보는 코드/환경변수가 아니라, 로그인 후 웹 화면 `KIS 설정`에서 사용자별로 등록합니다(AES-256-GCM 암호화 저장). 자세한 순서는 아래 [KIS 설정](#kis-설정) 절을 참고하세요.

## 지향점 (이 프로젝트가 추구하는 것)

- **백테스트와 자동매매의 일관성**: 같은 전략 설정을 과거 일봉 백테스트와 실시간 자동매매 양쪽에서 동일한 의사결정 규칙으로 재사용합니다.
- **사용자별 완전 격리**: 모든 도메인 테이블에 `user_id`가 있고, 모든 보호 API는 세션의 `userId` 기준으로만 동작합니다. 한 사용자의 자격증명·전략·주문은 다른 사용자에게 노출되지 않습니다.
- **안전 우선의 실주문**: 실주문은 기본 비활성. 켜더라도 안전 검사를 통과해야만 전송하며, 예약주문 API는 의도적으로 구현하지 않습니다(`ENABLE_RESERVED_ORDER=false` 고정).
- **민감정보 비노출**: App Secret·access token·계좌번호 원문은 frontend로 반환하지 않고 로그에도 남기지 않습니다.
- **명세 우선 개발**: 새 기능은 `openspec/`의 change 제안 → 구현 흐름을 따릅니다.

## 저장소 구조 (top-level)

```text
backend/      Node.js + Express + SQLite(better-sqlite3) API 서버
frontend/     React 19 + Vite + Recharts 단일 페이지 앱
openspec/     현재 구현 기준 baseline 명세 + 진행 중/아카이브된 change 제안
specs/        Spec Kit 산출물 (001~005 기능 단위 spec/plan/tasks, 히스토리)
infra/        k3s + Argo CD 배포 매니페스트, GitHub Actions 연동
KIS/          KIS Open API 공식 엑셀 문서 (REST API 구현의 1차 기준)
AGENTS.md     에이전트·기여자용 개발 규칙 (브랜치·커밋·KIS 문서 기준 등)
```

## 에이전트·신규 기여자를 위한 안내

이 저장소를 처음 분석한다면 다음 순서로 읽으면 빠릅니다.

1. **이 README** — 전체 그림, 전략 3종, 실행법.
2. **[AGENTS.md](AGENTS.md)** — 작업 규칙(브랜치 전략, 커밋, KIS 엑셀 우선 원칙, 실주문 제약).
3. **[openspec/specs/README.md](openspec/specs/README.md)** — "지금 코드가 무엇을 하는가"를 영역별로 정리한 baseline. 특히 [product-overview.md](openspec/specs/product-overview.md), [auto-trading.md](openspec/specs/auto-trading.md), [database-model.md](openspec/specs/database-model.md), [backend-api.md](openspec/specs/backend-api.md).
4. **코드** — 진입점은 `backend/src/server.js`, 스케줄러는 `backend/src/services/*Scheduler.js`, 전략 판단 로직은 `backend/src/services/*StrategyEngine.js`.

KIS REST API를 다룰 때는 추측하지 말고 항상 `KIS/한국투자증권_오픈API_전체문서_*.xlsx`의 TR 코드·필수 파라미터·응답 필드를 1차 기준으로 확인하세요.

## 현재 지원 범위

- 이메일/비밀번호 회원가입, 로그인, httpOnly session cookie 인증
- 사용자별 전략, 가상 보유, 가상 주문, 판단 로그 분리
- 사용자별 KIS App Key / App Secret 암호화 저장
- KIS Open API access token 발급 및 재사용
- 국내/해외 종목 현재가 조회
- 국내/해외 종목 일봉 조회 및 `market_price_cache` 저장
- KIS 일봉 시가·고가·종가 기준 백테스트
- 계좌·손익·전략·주문·오류 상태를 한눈에 보는 운용 대시보드
- 백테스트 요약, 거래 이력, 자산 변화 차트, 평균단가 vs 종가 차트
- 자동매매 전략 생성, 시작, 종료 (라오어 무한매수법 / 한국 국장 상승률 랭킹 전략 / 미국장 상승률 랭킹 전략)
- 실주문 실행 설정 토글
- 실주문 실행 꺼짐: 현재가·잔고·매수가능금액 조회, 전략 판단, 모의 주문 기록, 포지션 스냅샷 저장
- 실주문 실행 켜짐: 미체결·중복·매수가능금액·보유 수량 검사를 통과한 경우 KIS 주문 API로 실제 매수/매도 주문 전송
- 서버 스케줄러 기반 RUNNING 전략 주기 평가와 access token 자동 발급/갱신

## 지원하지 않는 범위

- 예약주문
- KIS 예약주문 API 호출
- 수수료, 세금, 환율, 슬리피지 계산
- 주문 실패 자동 재시도
- 사용자가 HTS/MTS에서 직접 만든 주문의 취소 (앱이 접수한 미체결 주문은 다음 평가 시 자동 취소하지만, 사용자가 직접 만든 주문은 건드리지 않습니다)

`ENABLE_RESERVED_ORDER=false`를 유지해야 합니다. 실주문은 사용자별 `liveOrderEnabled` 설정이 켜져 있고 미체결·중복·매수가능금액·보유 수량 검사를 통과한 경우에만 실행됩니다.

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
KR_RANK_SCHEDULER_INTERVAL_MS=30000
US_RANK_SCHEDULER_INTERVAL_MS=30000
```

`*_SCHEDULER_INTERVAL_MS`는 각 전략 스케줄러의 평가 주기입니다. 라오어 무한매수법은 10분(600000), 한국·미국 상승률 랭킹 전략은 진입 시각을 놓치지 않도록 30초(30000)로 평가합니다.

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
7. 백테스트는 각 거래일의 `open`, `high`, `low`, `close` 가격으로 매수·매도 체결을 계산합니다.

현재 백테스트 알고리즘은 `LAOR_INFINITE_V2_NATIVE`이며, 라오어 무한매수법처럼 일봉 가격으로 계산할 수 있는 전략에 맞춰져 있습니다.

- 사이클 시작 시점의 총 시드 ÷ 분할 회차로 회차당 예산을 계산합니다. 예: 4,000 USD / 40분할 = 100 USD.
- 보유 수량이 없으면 해당 거래일 시가로 첫 매수를 계산합니다.
- 이후에는 회차당 예산을 절반씩 나눕니다. 절반은 평단가 지정가에, 나머지 절반은 큰수 지정가에 배정합니다.
- 큰수 지정가는 `평단가 × (1 + 큰수 매수 여유율)`입니다. 큰수 매수 여유율을 비워두면 분할 회차와 무관하게 기본 10%가 적용되고, 직접 입력하면 그 값을 우선합니다.
- 매수는 일봉 저가가 지정가에 닿으면 체결된 것으로 계산하고, 체결가는 시가와 지정가 중 더 낮은 값입니다.
- 장중 고가가 `평단가 × (1 + 목표 수익률)`에 닿으면 목표가에 전량 매도한 것으로 계산합니다. 목표 매도한 날에는 다시 매수하지 않고 다음 거래일부터 새 판단을 시작합니다.
- 목표 매도 후 새 사이클을 시작하면 실현 수익이나 손실이 반영된 현재 총자산을 다시 분할합니다. 예: 1,000 USD가 1,200 USD가 되었으면 다음 40분할은 30 USD씩 계산합니다.
- 분할 회차를 모두 쓰고 현금이 다음 회차 예산보다 적으면 보유 수량의 4분의 1을 종가에 매도해 다음 회차를 이어갑니다.

백테스트는 기본적으로 자동매매와 동일하게 **1주 단위**로 매수합니다. 회차(또는 절반) 예산으로 살 수 있는 정수 주만 매수하고, 남는 돈은 다음 회차로 이월하지 않습니다. 입력 폼의 "소수점 매매 시뮬레이션"을 켜면 소수점 6자리 수량으로 계산하는 결과를 참고용으로 볼 수 있습니다. 실제 KIS Open API 해외주문은 1주 단위만 지원하므로 자동매매는 항상 1주 단위입니다.

국내 종목은 KRW, 해외 종목은 KIS 응답 통화 기준으로 표시합니다. 수수료, 세금, 환율, 슬리피지는 계산에서 제외합니다. 결과는 투자 수익을 보장하지 않습니다.

한국 국장 상승률 랭킹 전략과 미국장 상승률 랭킹 전략은 특정 시각의 상승률 순위, 거래량, 장중 익절·손절에 따라 움직입니다. 과거의 랭킹 스냅샷이 없으면 일봉 종가만으로 당시 전략을 정확히 재현하기 어렵습니다. 따라서 현재 화면의 백테스트는 라오어 전략용으로 보고, 랭킹 전략은 향후 과거 랭킹 스냅샷 저장 또는 별도 리플레이 시뮬레이션으로 분리해 다루는 것이 맞습니다.

## 자동매매

자동매매는 로그인한 사용자별 KIS credential과 계좌 설정을 사용합니다. 사용자가 웹에 접속하지 않아도 backend 서버가 실행 중이면 스케줄러가 RUNNING 전략을 주기적으로 평가하고, token이 없거나 만료가 임박하면 저장된 App Key / App Secret으로 자동 재발급합니다. 자동매매 화면은 한국 국장 상승률 랭킹 전략, 미국장 상승률 랭킹 전략, 라오어 무한매수법 순서로 보여줍니다.

사용 순서:

1. `KIS 설정`에서 App Key, App Secret, 계좌번호, 계좌 상품코드를 저장합니다.
   - 계좌번호(`CANO`)는 보통 KIS 계좌의 앞 8자리 (예: `12345678-01` 의 `12345678`).
   - 계좌상품코드(`ACNT_PRDT_CD`)는 뒤 2자리. 일반 위탁계좌는 보통 `01`. KIS HTS `[0301]` 화면에서 확인 가능.
2. `자동매매` 화면에서 한국장 랭킹, 미국장 랭킹, 라오어 중 사용할 전략 탭을 선택합니다.
3. 선택한 전략의 예산, 익절·손절 기준, 종목 조건을 입력해 전략을 만듭니다.
4. 전략 상세에서 `시작`을 누르면 상태가 `RUNNING`이 되고 스케줄러 평가 대상이 됩니다.
5. `종료`를 누르면 상태가 `STOPPED`가 되어 이후 스케줄러 평가 대상에서 제외됩니다. 이미 접수된 주문은 자동 취소하지 않습니다.

### 통화·환전 동작

전략 통화는 종목 통화(국내 `KRW`, 미국 `USD`)를 그대로 따릅니다. 총 예산 입력값도 같은 통화입니다. 예: `TQQQ` 전략의 총 예산 `1000` = `1000 USD`.

미국 종목 자동매매에는 KRW → USD 자동 환전이 없습니다. 옵션은 둘 중 하나:

- **주식통합증거금 신청 (권장)** — KIS HTS `[0867] 통합증거금조회` 또는 영업점에서 신청. 신청한 계좌는 KRW 잔고가 환율 적용된 USD 매수가능금액에 자동 포함되며, 본 앱이 사용하는 KIS 매수가능금액 API(`/uapi/overseas-stock/v1/trading/inquire-psamount`, TR `TTTS3007R`)의 `frcr_ord_psbl_amt1` (외화 주문가능금액) 응답 필드에 가산되어 돌아옵니다.
- **수동 환전** — KIS HTS/MTS에서 KRW → USD 환전 후 USD 잔고로 매수. 통합증거금 미신청 계좌는 USD 잔고만 매수에 사용됩니다.

자산 평가는 종목 통화로 표시합니다. KRW 환산 가치가 필요하면 KIS 잔고조회 응답의 환율 필드(`exrt`)를 활용해 별도 계산이 필요합니다. 환율 정밀도와 환전 수수료는 현재 계산에서 제외합니다.

실주문 실행 설정:

- 꺼짐: 자동매매는 계속 평가하지만 주문은 전송하지 않습니다. 현재가, 잔고, 매수가능금액, 미체결 주문을 조회하고 판단 로그, 모의 주문 기록, 포지션 스냅샷만 저장합니다.
- 켜짐: 자동매매 화면에 연결 계좌의 매수가능금액, 보유 수량, 평단, 미체결 주문 수를 표시합니다. 미체결 주문 없음, 중복 주문 아님, 주문 수량 0 초과, 매수가능금액, 보유 수량 검사를 모두 통과한 경우 KIS 주문 API로 실제 매수/매도 주문을 전송합니다.
- 평가 로그: 전략을 시작하면 즉시 시작 로그를 남기고, 이후 스케줄러가 최대 10분 간격으로 현재가, 보유 수량, 평균단가, 매수가능금액, 회차, 미체결 주문 수, 실주문 설정을 판단 로그에 남깁니다.
- 매수 조건: 보유 수량이 없으면 회차 예산으로 현재가에 첫 매수를 합니다. 보유 중에는 회차 예산을 절반씩 나눠, 현재가가 평단가 이하이면 평단가에(평단가 매수), 현재가가 `평단가 × (1 + 큰수 매수 여유율)` 이하이면 그 지정가에(큰수 매수) 각각 주문을 판단합니다. 큰수 매수는 주가가 올라도 매수를 이어 가기 위한 절반이며, 여유율을 비워두면 분할 회차와 무관하게 기본 10%가 적용됩니다.
- 회차와 매수 횟수: 한 회차는 하루(1거래일) 단위로 진행합니다. 1회차(보유 0)는 시작가에 회차 예산을 한 번에 매수하고, 2회차부터 회차 예산을 절반씩 평단가 매수·큰수 매수로 나눠 하루 최대 두 번 매수합니다. 같은 날 이미 산 쪽은 다시 사지 않지만, 아직 안 산 쪽은 그날 조건이 맞으면 그때 매수합니다. KIS Open API는 1주 단위만 지원하므로 항상 정수 주로 매수하고, 미체결 예산은 다음 회차로 이월하지 않습니다. 전략 생성 시 종목 현재가 기준 최대 분할 회차가 자동으로 안내·제한됩니다.
- 매도와 새 사이클: 현재가가 `평단가 × (1 + 목표 수익률)` 이상이면 보유 수량 전량을 매도합니다. 분할 회차를 모두 쓰고도 목표가에 닿지 않은 상태에서 매수가능금액이 다음 회차 예산보다 적으면 보유 수량의 약 4분의 1을 매도해 자금을 확보합니다. 두 매도 모두, 접수되면 회차를 0으로 초기화하고 그 시점의 총자산(현금 + 보유 평가액)을 새 사이클 예산으로 삼아 자동매매를 이어 갑니다.
- 미체결 처리: 실주문 모드에서 이전 평가 때 앱이 접수한 미체결 주문이 남아 있으면 다음 평가 시작 전에 해당 주문을 자동 취소한 뒤 새 평가를 진행합니다. 사용자가 HTS/MTS에서 직접 만든 주문은 취소하지 않습니다.

안전 정책:

- 미체결 주문이 있으면 신규 주문하지 않습니다.
- 동일 전략·날짜·판단·회차 기준 중복 주문을 막습니다.
- 주문 실패는 자동 재시도하지 않습니다.
- 장 운영 시간이 아니거나 판단이 불확실하면 스케줄러는 `SKIP`으로 기록하고 주문하지 않습니다.
- App Secret, access token, 계좌번호 원문은 frontend로 반환하지 않고 로그에도 남기지 않습니다.

실주문은 투자 손실 위험이 있습니다. 실주문 실행 설정을 켜기 전에 전략, 계좌, 매수가능금액, 보유 수량, 미체결 주문 상태를 직접 확인해야 합니다.

메인 화면은 백테스트, 자동매매, KIS 설정으로 바로 들어가는 진입 화면입니다. 라오어 초안 목록은 기존 초안을 확인하는 용도로 남아 있고, 한국장·미국장 랭킹 전략은 자동매매 화면에서 직접 생성합니다.

### 한국 국장 상승률 랭킹 전략

자동매매 화면에는 라오어 무한매수법 탭과 별개로 **한국 국장 상승률 랭킹 전략** 탭이 있습니다. 두 전략 종류는 독립적으로 생성·시작·종료·조회되며, 실주문 실행 설정·KIS 연동을 공유합니다. 한국 랭킹 전략은 진입 시각을 놓치지 않도록 기본 30초 간격으로 평가합니다(라오어 전략의 10분 간격과 분리).

- 진입: 오전 9시 10분(선택 시 11시 30분 점심)에 한국주식 등락률 상위 랭킹을 조회합니다. 각 진입은 하루 1회, 진입 구간당 1회만 매수하며 매도했더라도 같은 구간에서 다시 매수하지 않습니다. 점심 진입을 켜면 하루 두 번까지 매수합니다.
- 진입 구간별 입력: 오전·점심 각각 매수 금액·목표 수익률·손절 기준을 따로 입력합니다. 점심 진입이 꺼져 있으면 오전 값만 입력합니다.
- 매수가능금액 자동 사용(선택): 켜면 매수 금액 입력 없이 진입 시점의 KIS 매수가능금액 전액을 한 종목에 투입합니다. 매도 후 잔액 변동이 다음 매수에 자동 반영됩니다.
- 종목 선택: 등락률 20% 이상 종목은 제외합니다(상한가까지 여유 확보). 등락률이 낮은 순서로 상위 후보를 단기 흐름 필터로 한 번 더 거릅니다.
- 매수 필터(단기 흐름 검사): 후보 종목의 당일 분봉(KIS `inquire-time-itemchartprice`)을 보고 다음을 확인합니다 — 현재가 > 시가, 현재가 > VWAP, 직전 구간 대비 거래량 유지, 거래량을 동반한 장대 음봉 부재, 직전 고점을 1% 이상 밀리지 않음. 다섯 조건을 모두 통과해야 매수합니다. 첫 후보가 떨어지면 차순위로 넘어가 최대 5개까지 본다음 모두 떨어지면 그날(또는 그 진입 구간) 매수를 건너뜁니다.
- 매수: 해당 진입 구간의 매수 금액 한도와 가용 현금 중 작은 값을 기준으로 정수 주 단위(한국주식)로 매수합니다. 빠른 모멘텀 종목의 미체결을 막기 위해 **시장가**로 주문하며, 체결가 변동에 대비해 가용 금액의 1%를 여유로 남깁니다.
- 목표가 선주문: 매수 체결이 확인되면 평균 체결가 기준 목표 수익 지정가 매도를 즉시 걸어 둡니다. 목표 수익 구간을 30초 평가 tick 사이에 지나쳤다가 내려오는 상황을 줄이기 위한 장치입니다.
- 방어 매도: 손절, 빠른 손절, 청산 시각 조건이 목표가 주문보다 먼저 필요해지면 기존 목표가 주문을 먼저 취소하고, 취소가 확인된 뒤에만 새 매도 주문을 냅니다.
- 빠른 손절: 보유 중 손실이 2% 이상이고 최근 분봉에서 VWAP 이탈, 시가 이탈, 고점 대비 급락, 거래량 감소, 거래량 동반 장대 음봉이 겹치면 고정 손절률까지 기다리지 않고 전량 매도합니다. 흐름 이탈만으로 팔지 않도록 최소 손실 기준을 둡니다.
- 매도: 목표 수익 주문이 체결되면 익절로 기록하고, 손절·빠른 손절·청산 시각 매도는 시장가로 주문해 하락장 미체결을 줄입니다.
- 청산 시각(선택): 진입 구간별로 `HH:MM` KST 청산 시각을 켜 두면 그 시각 이후 평가에서 목표·손절 미도달이어도 전량 매도합니다(매도 사유 `청산 시각`). 목표 수익·손절이 먼저 발생하면 그쪽이 우선이며, 청산 시각을 끄면 목표·손절만 적용합니다.
- 거래 복기: 주문 이력의 `거래 복기` 버튼을 누르면 해당 거래의 KIS 과거 분봉을 조회해 매수 후 최대 상승률(MFE), 최대 하락률(MAE), 목표/손절/빠른 손절 조건 도달 시각을 계산합니다. 화면을 여는 것만으로 과거 분봉을 자동 조회하지는 않습니다.
- 실주문 실행 설정이 꺼져 있으면 랭킹 조회·종목 선택·판단·목표가 주문 예정 기록은 남기되 KIS 주문 API는 호출하지 않습니다. 진입 구간·매도 사유(목표 수익/손절/빠른 손절/청산 시각)·실주문 여부를 구분해 기록합니다.
- 전략을 삭제해도 주문 이력, 판단 로그, 진입 기록은 DB에 보존됩니다. 삭제된 전략은 기본 목록과 스케줄러 평가 대상에서만 제외됩니다.

### 미국장 상승률 랭킹 전략

자동매매 화면의 **미국장 상승률 랭킹 전략** 탭은 미국 정규장 ET 10:00~16:00 동안 KIS 해외주식 상승률 랭킹을 30초마다 확인합니다. 보유 종목이 없으면 진입 필터를 통과한 상위 종목을 사고, 보유 중이면 익절·손절·강제 청산 조건만 봅니다.

- 랭킹 조회: KIS 해외주식 상승율/하락율 API(`/uapi/overseas-stock/v1/ranking/updown-rate`, TR `HHDFS76290000`)로 NASDAQ, NYSE, AMEX 상승률 상위 종목을 조회합니다.
- 진입 유니버스(1차 필터): 변동성·유동성이 위험한 종목군을 먼저 배제합니다 — ① 당일 등락률 +50% 이상은 제외(이미 수직 급등한 종목 추격 금지) ② 현재가 5 USD 미만 제외(초저가 micro-cap은 스프레드·호가 공백이 커 진입·청산 슬리피지가 큼) ③ 거래대금(가격×거래량) 5천만 USD 미만 제외(주 수만으로는 저가주가 통과하므로 달러 유동성으로 거름). 거래량 필드가 비거나 0이면 서버 필터를 신뢰해 통과합니다.
- 매수 필터(단기 흐름 검사): 상위 후보(최대 3개)의 당일 분봉(KIS 해외 분봉 `inquire-time-itemchartprice`, TR `HHDFS76950200`)을 보고 — 현재가 > VWAP, 현재가 > 최근 구간 시작가, 거래량 유지, 거래량 동반 장대 음봉 부재, 직전 고점을 밀리지 않음, **그리고 현재가가 VWAP보다 15% 넘게 높지 않음(과열 차단)** — 을 확인합니다. 1위부터 차례로 보고 모두 떨어지면 그 평가는 건너뜁니다(블로우오프 고점 추격 방지).
- 매수: 보유 종목이 없을 때 필터를 통과한 가장 높은 상승률 종목을 고릅니다. 평가 시점의 USD 매수가능금액 전액으로 1주 단위 최대 수량을 계산합니다.
- 목표가 선주문: 매수 체결이 확인되면 평균 체결가 기준 목표 수익 지정가 매도를 즉시 걸어 둡니다. 목표 수익 구간을 30초 평가 tick 사이에 놓치지 않기 위한 장치입니다.
- 익절: 목표가 주문이 체결되면 랭킹 순위와 관계없이 전량 매도한 것으로 확정합니다. 매도 후 손절·강제 청산·누적 목표 종료가 아니라면 다음 평가에서 다시 랭킹을 보고 재매수할 수 있습니다.
- 손절: 손절 기준에 닿으면 전량 매도하고 그 미국 거래일에는 더 사지 않습니다.
- 빠른 손절: 보유 중 손실이 3% 이상이고 최근 분봉에서 VWAP 이탈, 시작가 이탈, 고점 대비 급락, 거래량 감소, 거래량 동반 장대 음봉이 겹치면 고정 손절률까지 기다리지 않고 전량 매도합니다. 미국장은 변동성이 커 한국장보다 더 넓은 기준을 씁니다.
- 강제 청산: 기본 KST 04:30 이후에는 익절·손절 여부와 관계없이 전량 매도를 시도하고, 그 미국 거래일의 신규 매수는 멈춥니다.
- 매도 체결 안전장치: KIS 주문 접수(ACCEPTED)는 체결이 아닙니다. 실주문 매도는 접수만으로 청산을 확정하지 않고, 다음 평가에서 KIS 체결조회/잔고로 체결을 확인한 뒤에만 청산·보유 해제·당일 잠금을 처리하며, 실현손익은 판단 시점 현재가가 아닌 **실제 체결가**로 기록합니다. 목표가 주문이 미체결인 상태에서 손절·빠른 손절·강제 청산이 필요하면 목표가 주문을 먼저 취소하고, 취소 상태가 불확실하면 새 매도를 만들지 않습니다. 방어 매도가 45초 넘게 미체결이면 취소하고 더 공격적인 가격(현재가보다 0.5%~최대 5% 아래, 재호가일수록 깊게)으로 다시 내 손절이 명목상으로만 남지 않게 합니다.
- 누적 목표: 시작 시점의 USD 매수가능금액 대비 사용자가 정한 누적 수익률에 도달하면 보유분을 정리하고 전략을 종료합니다. 손절·강제 청산·누적 목표 종료가 발생하면 그날 미국장 사이클은 끝납니다.
- 주문 방식: KIS 미국 일반 주문은 문서상 일반 시장가가 아니라 지정가 중심입니다. 매수는 현재가 지정가, 매도는 체결 보장을 위해 호가를 가로지르는 공격적 지정가로 KIS 표준 해외 주문 경로를 사용합니다.
- 거래 복기: 주문 이력의 `거래 복기` 버튼을 누르면 해당 거래의 KIS 과거 분봉을 조회해 매수 후 최대 상승률(MFE), 최대 하락률(MAE), 목표/손절/빠른 손절 조건 도달 시각을 계산합니다. 화면 렌더링만으로 과거 분봉을 자동 조회하지는 않습니다.
- 실주문 실행 설정이 꺼져 있으면 랭킹 조회·종목 선택·판단·목표가 주문 예정 기록은 남기되 KIS 주문 API는 호출하지 않습니다.
- 전략을 삭제해도 주문 이력, 판단 로그, 매매 사이클은 DB에 보존됩니다. 삭제된 전략은 기본 목록과 스케줄러 평가 대상에서만 제외됩니다.

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

GET    /api/kr-rank/overview
GET    /api/kr-rank/strategies
POST   /api/kr-rank/strategies
GET    /api/kr-rank/strategies/:id
PUT    /api/kr-rank/strategies/:id
DELETE /api/kr-rank/strategies/:id
POST   /api/kr-rank/strategies/:id/start
POST   /api/kr-rank/strategies/:id/stop
POST   /api/kr-rank/strategies/:id/evaluate
GET    /api/kr-rank/strategies/:id/orders
GET    /api/kr-rank/strategies/:id/decisions
GET    /api/kr-rank/strategies/:id/entries

GET    /api/us-rank/overview
GET    /api/us-rank/strategies
POST   /api/us-rank/strategies
GET    /api/us-rank/strategies/:id
PUT    /api/us-rank/strategies/:id
DELETE /api/us-rank/strategies/:id
POST   /api/us-rank/strategies/:id/start
POST   /api/us-rank/strategies/:id/stop
POST   /api/us-rank/strategies/:id/evaluate
GET    /api/us-rank/strategies/:id/trades
GET    /api/us-rank/strategies/:id/orders
GET    /api/us-rank/strategies/:id/decisions
```

모든 보호 API는 로그인한 사용자의 `userId` 기준으로만 조회/수정/삭제합니다.

## 개발

루트 `package.json`은 npm workspaces로 `backend`/`frontend`를 묶습니다. 루트에서 다음 명령을 실행합니다.

```bash
npm install      # backend·frontend 의존성 모두 설치
npm run migrate  # backend SQLite 마이그레이션 적용
npm test         # backend 테스트 (node --test)
npm run build    # frontend 프로덕션 빌드 (vite build)
npm run dev      # backend(:4000)·frontend dev 서버 동시 실행
```

개별 워크스페이스만 실행하려면 `npm --workspace backend run <script>` / `npm --workspace frontend run <script>` 형식을 사용합니다.

## 보안 원칙

- 비밀번호는 bcrypt hash로 저장합니다.
- App Secret과 access token은 AES-256-GCM으로 암호화해 저장합니다.
- 비밀번호, App Secret, access token 원문을 로그에 출력하지 않습니다.
- frontend는 broker API를 직접 호출하지 않습니다.
- 실주문은 사용자별 실주문 실행 설정이 켜져 있고 미체결·중복·매수가능금액·보유 수량 검사를 통과한 경우에만 backend에서 호출합니다.
- 예약주문 API는 구현하지 않습니다.

## 배포

현재 운영 환경은 **Oracle Cloud Ampere A1(ARM64) 단일 노드 k3s + Argo CD + cert-manager + Traefik** 구성입니다(2026-06-02 AWS EC2에서 이전 완료). 노드는 홈 리전 `ap-chuncheon-1`의 Always Free A1(`4 OCPU / 24GB`)이라 컴퓨트 비용이 들지 않습니다.

`main`에 머지되면 GitHub Actions가 backend/frontend 이미지를 **multi-arch(amd64+arm64)** 로 빌드해 **GHCR**에 push하고, GitOps 매니페스트(`infra/kubernetes/infinite-buying/overlays/mvp/kustomization.yaml`)의 이미지 태그를 갱신하면 Argo CD가 운영 클러스터에 자동 동기화합니다. `[skip deploy]`가 커밋 메시지에 있으면 배포를 건너뜁니다.

- 이미지: `ghcr.io/leeminki/infinite-buying-backend`, `ghcr.io/leeminki/infinite-buying-frontend`.
- backend는 SQLite 단일 writer + scheduler라 replica 1개로 고정합니다(노드 장애 시 무중단 HA는 비목표).
- TLS는 cert-manager `letsencrypt-prod` ClusterIssuer가 HTTP-01로 발급합니다.
- `SECRET_ENCRYPTION_KEY`/`SESSION_SECRET`은 클러스터 Secret(`infinite-buying-secrets`)으로 주입하며, 노드를 옮길 때 동일 값을 보존해야 기존 KIS credential 복호화가 깨지지 않습니다.

> Oracle Always Free는 **홈 리전에서만** 무료입니다. A1 capacity가 홈 리전에 없을 때를 대비한 재시도 도구는 `infra/operations/`에 보존돼 있습니다(현재는 이전 완료로 비활성).

마이그레이션 기록은 [openspec/changes/archive/2026-06-02-migrate-aws-ec2-to-oracle-k3s](openspec/changes/archive)와 capability 스펙 [openspec/specs/oracle-k3s-migration](openspec/specs/oracle-k3s-migration)을 참고하세요. 배포 매니페스트와 Argo CD 운영 메모는 [infra/](infra/)와 [infra/kubernetes/argocd/README.md](infra/kubernetes/argocd/README.md)를 참고하세요.
