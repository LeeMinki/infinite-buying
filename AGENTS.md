# infinite-buying 개발 가이드 (에이전트·기여자용)

이 파일은 저장소를 처음 분석하는 에이전트/기여자가 가장 먼저 읽어야 할 작업 규칙입니다. 전체 그림과 실행법은 [README.md](README.md), 영역별 구현 현황은 [openspec/specs/README.md](openspec/specs/README.md)를 참고하세요.

## 한 줄 요약

KIS Open API로 주식 전략을 백테스트하고 실제 자동매매까지 실행하는 사용자별 웹앱. **실제 돈이 오가는 라이브 매매 시스템**이므로 안전망과 사용자 자원 격리를 절대 깨지 않는다.

## 기술 스택

- **Backend**: Node.js 22+, Express, SQLite(`better-sqlite3`), `express-session` + `better-sqlite3-session-store`, `bcrypt`, AES-256-GCM(`node:crypto`), 내장 `fetch`(KIS 호출).
- **Frontend**: React 19, Vite, Recharts. 단일 페이지 앱(`frontend/src/App.jsx`의 `view` 상태로 화면 분기).
- **DB**: backend 볼륨 위 SQLite. 마이그레이션은 `backend/src/db/migrations/`에 파일명 순서로 적용(`npm run migrate`).

## 저장소 구조

```text
backend/    Express API 서버 (routes → services → repositories, market-data, crypto, db)
frontend/   React SPA
openspec/   현재 구현 기준 baseline 명세 + change 제안 (specs/ = baseline, changes/ = 진행/아카이브)
specs/      Spec Kit 산출물 (001~005 기능 단위 spec/plan/tasks)
infra/      k3s + Argo CD 배포 매니페스트
KIS/        KIS Open API 공식 엑셀 문서 (REST 구현의 1차 기준)
```

## 배포/인프라 현황

현재 production은 **Oracle Cloud Ampere A1 단일 노드 k3s + Argo CD + GHCR 이미지 배포 구조**다. 2026-06-02에 AWS EC2에서 이전했고, 운영 노드는 OCI 홈 리전인 춘천(`ap-chuncheon-1`)의 Always Free A1(`4 OCPU / 24GB RAM`)이다.

- GitHub Actions는 backend/frontend 이미지를 GHCR에 push하고, GitOps image tag 커밋 후 Argo CD가 운영 클러스터에 동기화한다.
- Route53 hosted zone은 계속 AWS에 남아 있으며, production A record는 OCI A1 public IP를 가리킨다.
- AWS EC2/ECR/VPC 런타임 리소스는 이전 완료 후 정리되었다. 예전 EC2로 즉시 롤백하는 경로는 더 이상 운영 전제로 두지 않는다.
- `infra/operations/ensure-oci-a1-region-envs.sh`, `try-create-oci-a1-all-regions.sh`, `try-create-oci-a1.sh`는 A1 capacity 확보용 재시도 스크립트였으며 현재는 비활성 보존 파일이다.
- OCI resource env, Telegram token, API key, retry env 같은 실행 값은 git에 커밋하지 않는다.

## 자동매매 전략 3종 (서로 독립)

| 전략 | 식별자 | 테이블 접두사 | 엔진/서비스 |
| --- | --- | --- | --- |
| 라오어 무한매수법 | `LAOR_INFINITE_V2` | `auto_trading_*` | `autoTradingStrategyEngine.js` / `autoTradingService.js` |
| 한국 국장 상승률 랭킹 | `KR_RANK_MOMENTUM` | `kr_rank_*` | `krRankStrategyEngine.js` / `krRankService.js` |
| 미국장 상승률 랭킹 | `US_RANK_MOMENTUM` | `us_rank_*` | `usRankStrategyEngine.js` / `usRankService.js` |

각 전략은 라우트·프론트 패널·스케줄러 타이머가 분리되어 있고, 실주문 실행 설정과 KIS 연동만 공유한다. 스케줄러 주기: 라오어 10분, 한국·미국 랭킹 30초.

## 명령

루트 `package.json`은 npm workspaces로 backend/frontend를 묶는다. 루트에서 실행:

```bash
npm install      # 전체 의존성
npm run migrate  # SQLite 마이그레이션
npm test         # backend 테스트 (node --test)
npm run build    # frontend 빌드
npm run dev      # backend + frontend dev 서버 동시 실행
```

## 작업 규칙 (반드시 준수)

- `main`에 직접 push 금지. feature 브랜치 → 상세한 PR → 리뷰 → 머지.
- Pull request 설명은 **한국어**로 작성.
- 줄바꿈은 항상 LF(Linux). Windows CRLF 금지.
- **KIS 연동은 `KIS/`의 로컬 엑셀 문서를 1차 기준으로 확인**한다. TR 코드·필수 파라미터·응답 필드를 추측하지 말 것. 현재 기준 파일: `KIS/한국투자증권_오픈API_전체문서_20260512_030000.xlsx`.
- **실주문 안전 원칙**: 실주문은 기본 비활성. 사용자별 `liveOrderEnabled=true`가 있고 미체결·중복·매수가능금액·보유 수량 안전 검사를 통과해야만 KIS 주문 API를 호출한다. App Secret·access token·계좌번호 원문을 frontend로 반환하거나 로그에 남기지 않는다. 예약주문 API는 구현하지 않으며 `ENABLE_RESERVED_ORDER=false`를 유지한다.
- UI 한국어 문구는 자연스럽게 작성한다(AI가 쓴 듯한 도구적 설명 톤 회피).

## 주의할 함정

- SQLite `datetime('now')`는 OS 벽시계를 쓴다. JS `Date`를 mock해도 DB 시각은 mock되지 않으므로, 시간 의존 테스트는 `created_at` 등을 직접 UPDATE해 정렬한다.
- 미국장 DST는 `Intl.DateTimeFormat('America/New_York')`로 OS tz 데이터에 위임한다.
- KIS 매수가능금액은 정산 지연(T+n)으로 부정확할 수 있다. 누적 손익은 현금이 아니라 (실현 + 미실현) / 기준자본으로 계산한다.
- **KIS 주문 접수(`ACCEPTED`)는 체결이 아니다.** 주문 API 응답은 주문번호만 주고 체결 여부는 모른다(체결조회/잔고로 따로 확인). 접수를 체결로 간주해 매수 보유 전환·매도 청산을 확정하면 앱 상태와 실제 계좌가 어긋난다(미국 랭킹 매수·매도 모두 체결 확인 후에만 상태를 바꾼다). 특히 미국은 시장가가 없어 손절 매도가 미체결로 떠 있으면 손실이 명목 손절선보다 커지므로, 미체결이 오래 머물면 취소 후 더 공격적인 지정가로 재호가한다.
