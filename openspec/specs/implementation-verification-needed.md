# 남은 검증 / 운영 개선 후보

이 파일은 과거 baseline 작성 때 남겨 둔 미확인 목록을 현재 코드 확인 기준으로 정리한 것이다. 코드와 문서가 불일치하는 항목은 본 baseline 문서에 반영했고, 여기에는 운영 정책 결정이나 외부 환경 확인이 필요한 항목만 남긴다.

## 인증 / 세션

- 회원가입 이메일 검증은 단순 정규식(`/^[^\s@]+@[^\s@]+\.[^\s@]+$/`)이며 별도 길이 제한은 없다.
- 비밀번호 정책은 최소 8자만 요구한다. 복잡도 제한, 로그인 실패 횟수 제한, 계정 잠금은 구현되어 있지 않다.
- 세션 쿠키는 `ib.sid`, `httpOnly`, `sameSite: 'lax'`, 14일 만료다. 운영에서 `SESSION_COOKIE_SECURE=true`이면 `Secure` 플래그와 `trust proxy`가 켜진다.
- 별도 CSRF token은 구현되어 있지 않다. 현재 보호는 SameSite=Lax 쿠키와 인증 API의 사용자별 격리에 의존한다.

## KIS 자격증명 / Token

- 시장 데이터용 `kisAuthService`는 만료 60초 전부터 재발급한다.
- 주문/계좌용 `kisTokenManager`는 만료 5분 전부터 재발급한다.
- 토큰 발급 성공 시 `kis_credentials.status`는 `TOKEN_VALID`, 실패 시 `TOKEN_ERROR`로 저장한다.
- `kisCredentialService.toSafeSettings()` 응답은 `configured`, `status`, `appKeyMasked`, `accountConfigured`, `lastTokenIssuedAt`, `lastTokenErrorMessage`만 반환한다. 계좌번호 원문이나 마스킹된 계좌번호 문자열도 반환하지 않는다.
- 토큰 실패 메시지는 표준 안내 문구 중심으로 저장하되, `kisTokenManager`는 KIS 오류 코드/메시지/HTTP status를 괄호 안에 덧붙일 수 있다. 이 값이 UI에 노출될 수 있으므로 KIS 응답에 민감정보가 섞이지 않는지 운영 중 계속 확인해야 한다.

## 시장 데이터

- 종목 검색 응답은 국내/해외를 하나의 검색 API(`/api/market/stocks/search`)로 반환하고, 결과에는 가능한 경우 `market`, `exchange`, 통화/소수점매매 가능 여부 같은 보조 정보가 포함된다.
- KIS 일봉 캐시는 `(user_id, market, symbol, date)` UNIQUE로 저장한다. 휴장일, 분할/배당 보정, KIS 원천 데이터의 통화 정합성은 KIS 응답에 의존한다.
- KIS rate limit/backoff는 호출 경로별 구현이 다르다. 주문/랭킹 경로는 재시도·재호가·idle tick 절감 로직이 있지만, 모든 시장 데이터 호출에 동일한 글로벌 throttle이 적용되는 구조는 아니다.

## 자동매매 / 주문

- 라오어 평가 락은 `auto_trading_locks(strategy_id, lock_key)` UNIQUE와 `locked_until`로 획득하며, 같은 strategy/lock_key의 동시 평가를 막는다. 다만 production은 SQLite 단일 writer와 scheduler 때문에 backend replica 1개를 전제로 한다.
- `AUTO_TRADING_SCHEDULER_ENABLED=true`인 backend 인스턴스를 둘 이상 동시에 띄우면 단일 노드/단일 replica 전제 밖이다. 운영에서는 backend replica 1개와 live order OFF 기본값을 유지해야 한다.
- 라오어 자동취소는 우리 시스템이 만든 이전 거래일 미체결 주문만 대상으로 한다. 오늘 접수한 주문과 사용자가 HTS/MTS로 직접 만든 외부 주문은 취소하지 않는다.
- 미국 랭킹 실주문 매도는 KIS 접수(`ACCEPTED`)만으로 청산 확정하지 않고 체결조회/잔고 확인 후 상태를 바꾼다. 방어 매도 미체결이 오래 남으면 취소 후 공격적 지정가로 재호가한다.
- KIS `kis_order_no`는 주문 접수 번호, `kis_original_order_no`는 정정/취소 등 원주문 추적용 값이다. 현재 라오어·랭킹 주문 테이블은 두 값을 모두 저장할 수 있다.

## 배포 / 운영

- `[skip deploy]`는 `.github/workflows/deploy-main.yml`의 job 조건 `!contains(github.event.head_commit.message, '[skip deploy]')`로 처리된다. 마지막 커밋 메시지에 해당 문자열이 있으면 이미지 빌드/푸시와 GitOps tag 업데이트를 건너뛴다.
- production은 Oracle Cloud Ampere A1 단일 노드 k3s + Argo CD + OCIR 구조다. 운영 DB는 hostPath SQLite(`/var/lib/infinite-buying/backend/app.db`)라 노드/디스크 장애에 대한 별도 백업 체계가 필요하다.
- DB 마이그레이션은 backend 서버 시작 시와 `npm run migrate`에서 `backend/src/db/migrate.js`가 실행한다. `schema.sql` 적용 후 `backend/src/db/migrations/`의 미적용 SQL 파일을 파일명 순서로 적용한다.
- 별도 로그 수집/관측 매니페스트는 현재 레포에 없다. 컨테이너 로그, `/api/health`, 판단 로그/주문 테이블, Argo CD/Kubernetes 상태 확인이 기본 운영 관측 수단이다.

## 테스트 커버리지

- 현재 backend 테스트는 `node --test` 기반이며, 루트 `npm test`는 backend workspace 테스트만 실행한다.
- 자동취소, 체결동기화, 랭킹 전략, 백테스트, 인증/라우트 제거 회귀 테스트가 존재하지만, 실제 KIS 실계좌 체결은 테스트가 아닌 운영 검증 절차로 확인해야 한다.
