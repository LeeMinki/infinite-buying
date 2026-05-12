# infinite-buying Development Guidelines

Auto-generated from all feature plans. Last updated: 2026-05-12

## Active Technologies
- JavaScript on Node.js 22+ for backend; React 19-compatible JavaScript frontend.
- Express, better-sqlite3, dotenv, cors, bcrypt, express-session, Vite, React, Recharts.
- Built-in `fetch` for 한국투자증권(Korea Investment & Securities Co., Ltd., 이하 KIS) Open API calls and `node:crypto` for AES-256-GCM encryption.
- SQLite on the backend volume with ordered SQL migrations.

## Project Structure

```text
backend/
frontend/
specs/
```

## Commands

Backend and frontend commands are run from their own package directories after implementation.

## Code Style

JavaScript on Node.js 22+; React 19-compatible frontend: Follow standard conventions

## Recent Changes
- 005-kis-auto-trading: Added JavaScript on Node.js 22+ backend; React 19-compatible JavaScript frontend + Express, better-sqlite3, dotenv, cors, bcrypt, express-session, built-in fetch, node:crypto, Vite, React, Recharts
- KIS Open API is the single read-only market data integration.
- Backtests use user-scoped KIS daily prices. Domestic symbols use KRW and overseas symbols use their KIS response currency, normally USD for US ETFs.

<!-- MANUAL ADDITIONS START -->
- Do not push directly to `main`; use a feature branch, detailed pull request, review, then merge.
- Use Linux line endings only (`LF`), never Windows `CRLF`.
- KIS integration must use the local Excel reference in `KIS/` first. Current reference file: `KIS/한국투자증권_오픈API_전체문서_20260512_030000.xlsx`.
- Pull request descriptions must be written in Korean.
- Real broker orders are only allowed for explicitly approved live-order specs. For 005 and later auto-trading work, live order execution must default to disabled, require the user's `liveOrderEnabled=true` setting, pass safety guards, and never expose raw App Secret, access token, or account number.
<!-- MANUAL ADDITIONS END -->
