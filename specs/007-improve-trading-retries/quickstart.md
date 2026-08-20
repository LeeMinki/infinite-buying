# Quickstart: 재현·검증·배포

## 1. 안전한 자료 준비

```bash
sqlite3 /var/lib/infinite-buying/backend/app.db ".backup '/tmp/infinite-buying-backtest.db'"
sqlite3 /tmp/infinite-buying-backtest.db "PRAGMA quick_check;"
```

운영 DB에서 분석 SQL을 직접 실행하지 않는다. 계좌번호·token·secret은 shell output이나 보고서에 남기지 않는다.

## 2. 최근 30일 재현

```bash
DB_PATH=/tmp/infinite-buying-backtest.db \
BACKTEST_USER_EMAIL=test3@test.com \
BACKTEST_START_DATE=2026-07-20 \
BACKTEST_END_DATE=2026-08-19 \
BACKTEST_START_CAPITAL_KRW=98139 \
npm --workspace backend exec -- node scripts/backtestKrRankRecent.js
```

KIS GET만 호출되는지 확인하고 결과의 call count, 데이터 기간, 비용 가정과 ambiguous stop-first 정책을 보존한다.

## 3. 테스트

```bash
npm --workspace backend test -- --test-name-pattern='KR rank|US rank|KIS'
npm test
npm run build
git diff --check
```

주문 분류 fixture에는 HTTP 200 business rejection, EGW, 429, 5xx, timeout/network error, accepted/partial fill을 모두 포함한다.

## 4. 배포 gate

1. 후보 규칙 threshold와 experiment version을 freeze한다.
2. clean validation이 없거나 gate 미달이면 shadow만 활성화한다.
3. feature branch를 push하고 한국어 PR을 만든다.
4. CI green과 review 뒤 merge한다.
5. rollout 전 DB backup, 현재 image SHA, global live setting을 기록한다.
6. global live를 끈 상태에서 Argo CD sync와 pod Ready를 확인한다.
7. migration, scheduler, shadow signal, 주문 0건을 확인한다.
8. 기존 승인 범위의 live setting만 명시적으로 복원한다. 신규 후보 규칙은 승격 gate 전까지 복원하지 않는다.

## 5. 운영 검증

- backend/frontend image SHA가 merge commit 산출물과 일치한다.
- pod restart loop와 migration error가 없다.
- `test3@test.com` 외 사용자 데이터가 섞이지 않는다.
- `ENABLE_RESERVED_ORDER=false`다.
- shadow mode가 KIS 주문·취소 POST를 호출하지 않는다.
- 주문번호/계좌번호/token/secret 원문이 로그에 없다.
