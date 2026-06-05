# 보안 / 민감정보 처리

## 비밀번호

- bcrypt 해시 저장 (`backend/src/auth/authService.js`).
- 로그/응답에 평문 비밀번호를 출력하지 않는다.

## 세션

- httpOnly 쿠키 `ib.sid` (`backend/src/auth/sessionStore.js`).
- `SESSION_SECRET` 환경변수로 서명.
- `sameSite: 'lax'`, `maxAge: 14일`.
- 운영(`SESSION_COOKIE_SECURE=true`)이면 `Secure` 플래그 + `trust proxy` 활성.
- 세션 저장소는 SQLite의 `sessions` 테이블 (자동 관리).

## KIS 자격증명 / Token

- **저장**: App Key, App Secret, access token, 계좌번호, 계좌상품코드는 `kis_credentials` 테이블에 AES-256-GCM 암호화로 저장.
- **암호화 키**: `SECRET_ENCRYPTION_KEY` (32바이트 base64).
- **노출 정책**:
  - App Secret 원문: **frontend로 절대 반환하지 않음**.
  - access token: **frontend로 절대 반환하지 않음**. KIS 호출은 backend에서만.
  - App Key: 응답은 masked (`app_key_masked`).
  - 계좌번호: 응답은 일부 마스킹 (`kisCredentialService.toSafeSettings`).
- **로깅**: KIS 요청/응답을 DB의 `request_payload_masked` / `response_payload_masked`에 저장할 때 민감 필드(`appkey`, `appsecret`, `Authorization`, 계좌번호 등)는 마스킹된 사본을 만든 후 저장.

## Broker API 호출 위치

Frontend는 broker API(KIS)를 직접 호출하지 않는다. 모든 KIS 호출은 backend의 `KisMarketDataProvider`, `kisAuthService`, `kisTradingService`를 통한다.

## 실주문 가드

`backend/src/services/autoTradingSafetyGuard.js`:

- 전략이 `RUNNING`이 아니면 차단.
- 결정이 BUY 또는 SELL이어야 진행.
- `expectedQuantity > 0`.
- 미체결 주문 0개 (자동 취소 후 재조회한 미체결 기준).
- 라오어 자동매매의 중복 주문·실패 재시도 한도는 service 레이어가 `idempotency_key`로 검사한다(`hasNonFailedOrder`, `countFailedOrders`). SafetyGuard는 상태·수량·미체결·잔액·정수주 조건만 검사한다.
- BUY: `cashAvailable ≥ expectedAmount`.
- SELL: `balance.quantity ≥ expectedQuantity`.
- 실주문 + 해외 BUY + `expectedQuantity < 1`이면 차단 (KIS 표준 해외주문은 정수 주만 허용).
- `liveOrderEnabled=false`이면 항상 `DRY_RUN` 상태로 분기.

## 예약주문 정책

- `ENABLE_RESERVED_ORDER=false` 유지가 원칙.
- KIS 예약주문 API는 호출하지 않는다.
- 본 baseline 시점에 코드 상 예약주문 분기는 구현되어 있지 않다.

## 데이터 격리

모든 보호 라우트는 `requireAuth`를 거치고 service 계층에서 `userId`로만 조회·수정·삭제. 다른 사용자 자원에 접근하면 404 또는 검증 실패로 처리.

## 비밀 환경변수 요구

- `SECRET_ENCRYPTION_KEY` (32바이트 base64) — `backend/src/config/env.js`의 `validateEnv()`에서 길이를 검증한다. 운영 환경에서는 값이 없으면 부팅 단계에서 실패한다.
- `SESSION_SECRET` — `validateEnv()`에서 32자 이상을 요구한다. 운영 환경에서는 값이 없으면 부팅 단계에서 실패한다.
