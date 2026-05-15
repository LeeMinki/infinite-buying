# 사용자 인증

## 책임

사용자 회원가입, 로그인, 세션 발급, 로그인 상태 확인. 모든 보호 API는 세션의 `userId`로 사용자별 데이터를 격리한다.

## 주요 파일

- `backend/src/routes/authRoutes.js` — 라우트 (`/api/auth`)
- `backend/src/auth/authService.js` — `register` / `login` 비즈니스 로직 (이메일 정규화, bcrypt hash 검증)
- `backend/src/auth/authMiddleware.js` — `requireAuth` 미들웨어
- `backend/src/auth/sessionStore.js` — `better-sqlite3-session-store` 기반 세션 미들웨어. 쿠키 이름 `ib.sid`.
- `backend/src/repositories/usersRepository.js`

## API

| Method | Path | 설명 |
| --- | --- | --- |
| POST | `/api/auth/register` | 회원가입. 성공 시 세션에 `userId` 저장 후 201 응답. |
| POST | `/api/auth/login` | 로그인. 성공 시 세션에 `userId` 저장. |
| POST | `/api/auth/logout` | 세션 파기 후 `ib.sid` 쿠키 제거, 204. |
| GET | `/api/auth/me` | 로그인된 사용자 정보 반환 (`requireAuth` 적용). |

## 세션

- 저장소: `data/app.db`의 `sessions` 테이블 (세션 미들웨어가 자동 관리).
- 쿠키: `ib.sid`, `httpOnly`, 환경변수 `SESSION_COOKIE_SECURE`가 true면 `secure` + `app.set('trust proxy', 1)`.
- 서명: `SESSION_SECRET` 환경변수 (운영에서는 32자 이상 임의 문자열).

## 데이터 모델

- `users(id, email, password_hash, created_at, updated_at)` — `email`은 `COLLATE NOCASE` + UNIQUE. (`migrations/0001_users.sql`)

## 사용자별 격리 원칙

- 모든 도메인 테이블(`strategies`, `holdings`, `virtual_orders`, `decision_logs`, `backtest_runs`, `backtest_trades`, `kis_credentials`, `market_price_cache`, `user_trading_settings`, `auto_trading_*`, `daily_order_limit_usages`)에 `user_id` 컬럼 존재.
- 보호 API는 모두 `requireAuth`를 거쳐 `req.userId`를 service 계층에 전달.
- 다른 사용자의 자원에는 접근 불가 — service/repository 레벨에서 `userId` 필터 적용.

## 비밀번호

- `bcrypt` 해시로만 저장. 평문은 로그에 남기지 않음.
- 해시 검증 실패 시 generic한 인증 실패 메시지 반환.
