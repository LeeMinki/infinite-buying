# KIS API 설정과 Token 처리

## 책임

사용자별 KIS App Key / App Secret / 계좌번호 / 계좌상품코드를 암호화 저장하고, 시장 데이터·주문 호출에 필요한 access token을 발급·재사용·재발급한다.

## 주요 파일

- `backend/src/routes/kisSettingsRoutes.js` — 라우트 (`/api/settings/kis`)
- `backend/src/services/kisCredentialService.js` — 저장/조회/삭제, masked App Key 변환
- `backend/src/services/kisAuthService.js` — token 발급, `testConnection`, `getAuthContext`(서비스 호출자가 사용하는 표준 컨텍스트)
- `backend/src/services/kisTokenManager.js` — `getValidAccessToken` 인메모리/DB 캐싱
- `backend/src/crypto/` — AES-256-GCM 헬퍼
- `backend/src/repositories/kisCredentialsRepository.js`

## API

| Method | Path | 설명 |
| --- | --- | --- |
| GET | `/api/settings/kis` | 현재 저장된 KIS 설정 메타 조회 (App Key는 masked, App Secret 원문은 절대 반환하지 않음). |
| POST | `/api/settings/kis` | App Key / App Secret / 계좌번호 / 계좌상품코드 저장 또는 업데이트. |
| DELETE | `/api/settings/kis` | KIS 설정 삭제. |
| POST | `/api/settings/kis/test` | 저장된 자격증명으로 access token 발급을 시도, 성공/실패와 토큰 만료 시각을 반환. |

## 데이터 모델

`kis_credentials` (`migrations/0012_kis_credentials.sql`):

- `id`, `user_id` (unique, FK)
- `app_key_masked` (예: `PSxxxxx****`)
- `app_key_encrypted`, `app_secret_encrypted`, `access_token_encrypted` — AES-256-GCM
- `token_expires_at`
- `account_number_encrypted`, `account_product_code_encrypted`
- `status`: `NOT_CONFIGURED` / `CONFIGURED` / `TOKEN_VALID` / `TOKEN_ERROR`
- `last_token_issued_at`, `last_token_error_message`

## Token 발급 흐름

1. KIS 호출 직전에 `kisAuthService.getAuthContext(userId)` 또는 `kisTokenManager.getValidAccessToken(userId)` 호출.
2. 저장된 token이 유효하면 그대로 사용. 만료 임박 또는 없음이면 저장된 App Key/Secret으로 KIS `/oauth2/tokenP`에 재요청.
3. 발급 성공 시 `access_token_encrypted`, `token_expires_at`, `status=TOKEN_VALID` 갱신. 실패 시 `status=TOKEN_ERROR` + `last_token_error_message` 기록.
4. 자동매매 스케줄러도 평가 직전 동일 함수를 호출하므로, 사용자가 웹에 접속하지 않아도 token이 자동 재발급된다 (저장된 자격증명이 유효한 한).

## 환경

- `KIS_API_BASE_URL` 환경변수 (기본 `https://openapi.koreainvestment.com:9443`). 모의투자 분기는 사용하지 않음.

## 보안

- App Secret과 access token은 frontend로 절대 반환하지 않음.
- App Key는 masked 표시만, App Secret 원문은 최초 저장 시점에만 사용자가 입력한 값을 받고 저장 후 다시 표시하지 않음.
- 계좌번호는 암호화 저장하며 응답에는 일부 마스킹된 형태로만 노출 (`kisCredentialService.toSafeSettings`).
- 모든 KIS 요청/응답에 민감 필드를 마스킹한 후에만 로그 또는 DB의 `request_payload_masked` / `response_payload_masked`에 저장한다.
