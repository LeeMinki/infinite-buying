# 구현 확인 필요 항목

본 baseline 작성 시 **코드를 끝까지 추적하지 못해 확신할 수 없었던 항목** 목록. 각 항목은 다음 OpenSpec change에서 (a) 코드를 정리해 baseline에 통합하거나, (b) 명세를 보강해 진실의 원천을 정하거나, (c) 실제로 구현해야 한다.

## 인증 / 세션

- [ ] `SESSION_SECRET` 누락 시 부팅 실패 또는 경고 동작 — `backend/src/auth/sessionStore.js` 및 `config/env.js`.
- [ ] 회원가입 이메일 검증 정책(중복, 형식, 길이) — `backend/src/auth/authService.js`.
- [ ] 비밀번호 정책(최소 길이, 복잡도) — 같은 파일.
- [ ] 로그인 실패 횟수 제한·계정 잠금 여부.

## KIS 자격증명·Token

- [ ] `SECRET_ENCRYPTION_KEY` 길이/형식 검증 위치와 실패 동작 — `backend/src/crypto/` 또는 `config/env.js`.
- [ ] Token 만료 임박 판단 기준 (분 단위?) — `kisTokenManager.js`.
- [ ] 토큰 발급 실패 시 `last_token_error_message` 보관 형식과 PII 마스킹.
- [ ] `kis_credentials.status` 변경 로직: 어떤 사건에서 `TOKEN_VALID` → `TOKEN_ERROR`로 전환되는지.
- [ ] 계좌번호 응답 마스킹 형식 (`kisCredentialService.toSafeSettings`).

## 시장 데이터

- [ ] KIS 일봉 응답 → 캐시 정합성 (휴장일, 분할/배당 보정 여부, 통화 일관성).
- [ ] 종목 검색 응답 형식 (국내/해외 통합 인터페이스, exchange 필드).
- [ ] Rate limit (220ms 간격·EGW00201/429/5xx backoff)이 시장 데이터 호출에도 적용되는지 — README는 자동매매 주문에서만 언급.

## 백테스트

- [ ] 큰수 매수 여유율의 백테스트 적용 정확도: 첫 거래일에 전일 종가가 없으면 어떻게 처리하는지.
- [ ] 회차 소진 후 4분의 1 매도가 동일 거래일 매수와 중복 발생하지 않는지.
- [ ] `restart_after_sell` 플래그가 결과 컬럼(`final_*`)에 어떻게 반영되는지.
- [ ] DST/시간대 변경이 일봉 `date` 필드 계산에 영향을 주는지.

## 자동매매

- [ ] 평가 락(`auto_trading_locks`) 만료 정책과 정리 주기.
- [ ] 스케줄러 중복 실행 방지(여러 backend 인스턴스 가정 시) — `AUTO_TRADING_SCHEDULER_ENABLED`가 true인 인스턴스가 둘 이상일 때 안전한지.
- [ ] 장 운영 시간 판정 로직(`isMarketSessionOpen`)과 휴장일 처리.
- [ ] `evaluateRunningStrategies` 한 tick에서 처리 가능한 전략 수와 KIS rate limit 대응.
- [ ] 자동 취소 실패 시 fallback: cancel 호출이 실패하면 SafetyGuard가 그대로 차단하는지 / 다음 tick에서 다시 시도하는지.
- [ ] `auto_trading_orders.idempotency_key` 생성 규칙(`makeIdempotencyKey`)이 같은 날 동일 결정에 대해 안정적인지.
- [ ] `position_snapshot.decision` 값이 `BUY`/`SELL`/`HOLD`/`SKIP`/`ERROR`/`COMPLETED` 외의 케이스를 만들 수 있는지.

## 주문 / 체결

- [ ] `refreshOrder`가 KIS 주문/체결 조회 응답을 어떤 컬럼으로 매핑하는지 (특히 `PARTIALLY_FILLED` → `FILLED` 전환 조건).
- [ ] `kis_order_no`와 `kis_original_order_no`의 사용 시점 분리 (정정/취소 시 원주문 추적).
- [ ] 자동 취소 후 `decision_reason`에 추가되는 노트 형식이 UI에 그대로 노출 가능한 안전한 문자열인지.

## Frontend

- [ ] `frontend/src/api/client.js`의 정확한 함수 집합과 에러 처리 인터페이스.
- [ ] 세션 만료 시 frontend 동작(자동 로그아웃 / 401 처리).
- [ ] `LaorStrategyGuide` 본문의 문구가 spec 문서와 항상 일치하도록 강제하는 메커니즘.

## 보안

- [ ] CSRF 보호 정책 (현재 `cors({ origin: true, credentials: true })`로 자격증명 허용. SameSite/CSRF token 여부).
- [ ] 로그 보존·수집기.
- [ ] 운영 환경의 시크릿 주입 방식(GitHub Actions, k3s secret 등)과 본 baseline에 적힌 환경변수 이름의 일치 여부.

## 배포 / 인프라

- [ ] `[skip deploy]` 커밋 컨벤션의 워크플로 매칭 규칙.
- [ ] Argo CD 동기화 상태 확인 방법과 롤백 절차.
- [ ] DB 마이그레이션 적용 순서 (운영 환경에서 `npm run migrate` 실행 시점/자동화).

## 테스트 커버리지

- [ ] 자동 취소 동작에 대한 백엔드 단위/통합 테스트 추가 여부 — 현재는 51 tests pass 상태이며 자동 취소 시나리오의 테스트 존재 여부를 본 baseline에서 확인하지 못함.
- [ ] `removedRoutes.test.js`가 보장하는 부재 라우트 목록과 현재 mount 코드의 일관성.
