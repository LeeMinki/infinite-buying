# Quickstart: Manual & Automated Test Plan

**Feature**: 002-user-auth-and-kiwoom-market-data
**Purpose**: After implementation, run these checks (in this order) to confirm the feature works end-to-end on the deployed EC2 instance and locally.

---

## 0. Prerequisites

- Node.js 22+ on the dev machine and on EC2.
- The following environment values populated **on EC2** (e.g., in the systemd unit's `EnvironmentFile=/etc/infinite-buying.env`):
  ```
  PORT=4000
  DB_PATH=data/app.db
  EC2_ELASTIC_IP=<the EC2 instance's stable outbound public IP>
  KIWOOM_API_BASE_URL=https://api.kiwoom.com
  KIWOOM_MOCK_API_BASE_URL=https://mockapi.kiwoom.com
  SECRET_ENCRYPTION_KEY=<base64 of 32 random bytes>
  SESSION_SECRET=<32+ random chars>
  ENABLE_LIVE_ORDER=false
  ```
  Generate the encryption key once with:
  ```bash
  node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
  ```
  Store it once in the EC2 env file; do NOT commit it.

- One Kiwoom REST API account, App Key + Secret Key already issued, and the EC2 Elastic IP **already registered** on the Kiwoom "계좌 App Key 관리" screen.

---

## 1. Backend boots and refuses bad config

```bash
# Missing SECRET_ENCRYPTION_KEY → expect non-zero exit + clear error
SECRET_ENCRYPTION_KEY= SESSION_SECRET=abc EC2_ELASTIC_IP=1.2.3.4 \
  node backend/src/server.js
# stderr: "SECRET_ENCRYPTION_KEY must be a base64-encoded 32-byte key."

# Missing SESSION_SECRET → expect non-zero exit
SECRET_ENCRYPTION_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))") \
  SESSION_SECRET= EC2_ELASTIC_IP=1.2.3.4 \
  node backend/src/server.js
# stderr: "SESSION_SECRET is required"

# All required values present → expect "listening on :4000"
```

✅ Pass criterion: backend refuses to start unless all 3 critical secrets (`SECRET_ENCRYPTION_KEY`, `SESSION_SECRET`, `EC2_ELASTIC_IP`) are present and the encryption key is 32 bytes after base64 decode.

---

## 2. Auth happy path (User Story 1)

```bash
# Register
curl -i -c jarA.txt -H 'Content-Type: application/json' \
  -d '{"email":"alice@example.com","password":"alicepass123"}' \
  http://localhost:4000/api/auth/register
# Expect: 201, Set-Cookie ib.sid=...

# Logout
curl -i -b jarA.txt -c jarA.txt -X POST http://localhost:4000/api/auth/logout
# Expect: 204

# Login (re-establishes session)
curl -i -b jarA.txt -c jarA.txt -H 'Content-Type: application/json' \
  -d '{"email":"alice@example.com","password":"alicepass123"}' \
  http://localhost:4000/api/auth/login
# Expect: 200 with {"user":{"id":1,"email":"alice@example.com"}}

# Me
curl -i -b jarA.txt http://localhost:4000/api/auth/me
# Expect: 200 with {"user":{...}}

# Wrong password (use a fresh empty jar — DO NOT reuse jarA.txt because its cookie is still valid)
curl -i -c jarBad.txt -H 'Content-Type: application/json' \
  -d '{"email":"alice@example.com","password":"WRONG"}' \
  http://localhost:4000/api/auth/login
# Expect: 401, {"error":"Invalid email or password"}

# Unknown email → SAME response shape
curl -i -c jarBad.txt -H 'Content-Type: application/json' \
  -d '{"email":"nope@example.com","password":"whatever1"}' \
  http://localhost:4000/api/auth/login
# Expect: 401, {"error":"Invalid email or password"}

# Email collision (case-insensitive)
curl -i -c jarTmp.txt -H 'Content-Type: application/json' \
  -d '{"email":"ALICE@example.com","password":"another1234"}' \
  http://localhost:4000/api/auth/register
# Expect: 409, {"error":"Email is already registered"}
```

✅ Pass criteria: 201/204/200/200/401/401/409 in that order. Wrong-password and unknown-email responses are **byte-identical**.

---

## 3. Cross-user isolation (User Story 1)

```bash
# Register Bob
curl -i -c jarB.txt -H 'Content-Type: application/json' \
  -d '{"email":"bob@example.com","password":"bobsecret123"}' \
  http://localhost:4000/api/auth/register

# As Alice, create a strategy
curl -i -b jarA.txt -H 'Content-Type: application/json' \
  -d '{"name":"테스트","stockCode":"005930","stockName":"삼성전자","totalBudget":4000000,"splitCount":40,"targetProfitRate":0.10}' \
  http://localhost:4000/api/strategies
# Expect: 201, note returned id (call it ALICE_STRAT)

# As Bob, list strategies
curl -i -b jarB.txt http://localhost:4000/api/strategies
# Expect: 200, [] — ZERO strategies, none of Alice's

# As Bob, GET Alice's strategy directly
curl -i -b jarB.txt http://localhost:4000/api/strategies/$ALICE_STRAT
# Expect: 404, {"error":"Strategy not found"}

# As Bob, PUT Alice's strategy
curl -i -b jarB.txt -X PUT -H 'Content-Type: application/json' \
  -d '{"name":"hijack"}' http://localhost:4000/api/strategies/$ALICE_STRAT
# Expect: 404

# As Bob, DELETE Alice's strategy
curl -i -b jarB.txt -X DELETE http://localhost:4000/api/strategies/$ALICE_STRAT
# Expect: 404

# As Bob, evaluate Alice's strategy
curl -i -b jarB.txt -X POST -H 'Content-Type: application/json' \
  -d '{"currentPrice":71000}' \
  http://localhost:4000/api/strategies/$ALICE_STRAT/evaluate
# Expect: 404

# As Alice, GET her strategy (sanity)
curl -i -b jarA.txt http://localhost:4000/api/strategies/$ALICE_STRAT
# Expect: 200, full strategy with name="테스트"
```

✅ Pass criteria: every cross-user attempt returns 404 (NOT 403, NOT 401). Alice's row is intact at the end.

---

## 4. Kiwoom credential setup (User Story 2)

```bash
# As Alice, GET settings — no credential yet
curl -i -b jarA.txt http://localhost:4000/api/settings/kiwoom
# Expect: 200, {"configured":false,"status":"NOT_CONFIGURED","appKeyMasked":"","environment":"production","ec2ElasticIp":"<your IP>",...}

# Save credential
curl -i -b jarA.txt -H 'Content-Type: application/json' \
  -d '{"appKey":"<real App Key>","secretKey":"<real Secret Key>","environment":"production"}' \
  http://localhost:4000/api/settings/kiwoom
# Expect: 200, configured=true, status="NOT_TESTED", appKeyMasked="UKnw****fan6", NO secretKey, NO plain appKey

# Re-GET settings — Secret Key MUST NOT appear
curl -i -b jarA.txt http://localhost:4000/api/settings/kiwoom \
  | grep -i 'secret\|secretKey'
# Expect: zero matches in the JSON body

# Connection test (assumes EC2 IP IS registered on Kiwoom)
curl -i -b jarA.txt -X POST http://localhost:4000/api/settings/kiwoom/test
# Expect: 200, {"ok":true,"status":"TOKEN_VALID",...}

# Connection test failure simulation: temporarily un-register IP from Kiwoom side, then:
curl -i -b jarA.txt -X POST http://localhost:4000/api/settings/kiwoom/test
# Expect: 200 with {"ok":false,"status":"TOKEN_ERROR",...}; message contains "EC2 Elastic IP" and the actual IP value

# Delete credential
curl -i -b jarA.txt -X DELETE http://localhost:4000/api/settings/kiwoom
# Expect: 204

# GET settings again — back to NOT_CONFIGURED
curl -i -b jarA.txt http://localhost:4000/api/settings/kiwoom
# Expect: 200, status="NOT_CONFIGURED"
```

✅ Pass criteria: Secret Key never appears in any response body. Connection test failure message names the EC2 Elastic IP.

---

## 5. Market data through Kiwoom (User Story 3)

(Re-save Alice's credential before running this section.)

```bash
# Current price
curl -i -b jarA.txt http://localhost:4000/api/market/005930/price
# Expect: 200, {"stockCode":"005930","price":<number>,"source":"KIWOOM","fetchedAt":"..."}

# First daily-chart load
curl -s -b jarA.txt "http://localhost:4000/api/market/005930/daily" | jq '.[0]'
# Expect: {"stockCode":"005930","date":"YYYY-MM-DD","open":...,"high":...,"low":...,"close":...,"volume":...,"source":"KIWOOM"}

# Second load (same range)
curl -s -b jarA.txt "http://localhost:4000/api/market/005930/daily" | jq 'length'
# Expect: rows are returned from the user-scoped SQLite cache if Kiwoom is unavailable; successful Kiwoom calls refresh the cache.

# Cache row uniqueness check
sqlite3 backend/data/app.db \
  "SELECT user_id, stock_code, date, COUNT(*) FROM market_price_cache GROUP BY 1,2,3 HAVING COUNT(*) > 1;"
# Expect: zero rows
```

✅ Pass criteria: first load is mostly Kiwoom-sourced; second load is fully cache-served; SQL group-by check returns zero duplicate `(user_id, stock_code, date)` triples.

---

## 6. Manual fallback when Kiwoom is unavailable (FR-031)

In the browser:
1. Sign in as Alice.
2. Open a strategy detail page.
3. Click "현재가 조회" — confirm the price field auto-fills and the source label says `KIWOOM`.
4. Now break the credential: `DELETE /api/settings/kiwoom`.
5. Click "현재가 조회" again — confirm the UI shows a friendly Korean error AND the manual current-price input remains usable.
6. Type a price manually and click "평가 실행" — confirm an evaluation runs and a virtual order / decision log appears.

✅ Pass criterion: manual evaluation works end-to-end with no Kiwoom credential present.

---

## 7. Frontend bundle audit (FR-032)

```bash
cd frontend
npm run build
grep -REn 'KIWOOM_APP_KEY|KIWOOM_SECRET_KEY|SECRET_ENCRYPTION_KEY|SESSION_SECRET' dist/ \
  || echo "✅ no env-name leaks"
grep -REn '<your real App Key>|<your real Secret Key>' dist/ \
  || echo "✅ no key value leaks"
# Optional: ensure no "Bearer" tokens were string-baked in
grep -REn '"Bearer ' dist/ || echo "✅ no Bearer strings"
```

✅ Pass criterion: every grep returns no matches in `frontend/dist/`. (The `frontend/dist/index.html` references runtime API calls; secrets must come from the backend, never the bundle.)

---

## 8. Automated tests

From `backend/`:
```bash
npm test
```

Should run, and pass the current automated backend suite. The suite currently includes strategy-calculator coverage and secret encryption/redaction coverage; the curl sections above are the MVP integration checks for auth, isolation, Kiwoom settings, and market data.

✅ Pass criterion: all green. None of the test files contain real Kiwoom keys.

---

## 9. Production smoke (after EC2 deploy)

1. `curl -i https://infinite-buying.yuna-pa.com/api/health` → `{ "ok": true }`
2. Open the public URL in a private browser window. Expect the login screen first.
3. Register, log in, open Kiwoom Setup. Verify the displayed EC2 Elastic IP matches `EC2_ELASTIC_IP` in the EC2 env file.
4. Save the credential, run "연결 테스트", confirm success.
5. Open a strategy, click "현재가 조회", confirm the price auto-fills.

✅ Pass criterion: the entire flow works without any console errors and without a single network response containing `appKey`, `secretKey`, `accessToken`, or `Authorization: Bearer …`.

---

## Sign-off

If all sections above pass, the feature satisfies SC-001 through SC-010 in `spec.md` and is ready for the operator to take live for additional test users.
