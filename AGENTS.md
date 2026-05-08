# infinite-buying Development Guidelines

Auto-generated from all feature plans. Last updated: 2026-04-29

## Active Technologies
- JavaScript on Node.js 22+ for backend; React 19-compatible JavaScript frontend. + Express, better-sqlite3, dotenv, cors, Vite, React, Recharts. Add backend dependencies: `bcrypt`, `express-session`, `better-sqlite3-session-store`. Use built-in `node:crypto` for AES-256-GCM encryption. (002-user-auth-and-kiwoom-market-data)
- SQLite on the EC2/k3s backend volume. Existing `app.db` keeps application data; session rows use a separate SQLite-backed session store file or table. (002-user-auth-and-kiwoom-market-data)
- JavaScript on Node.js 22+ for backend; React 19-compatible JavaScript frontend. + Existing Express, better-sqlite3, dotenv, cors, bcrypt/session stack, Vite, React, Recharts. No new required runtime dependency is planned. (003-real-price-backtest)
- SQLite on the backend volume using ordered SQL migrations. New tables: `backtest_runs`, `backtest_trades`. Backtests use user-scoped daily prices fetched through Kiwoom. (003-real-price-backtest)

- JavaScript on Node.js 22+; React 19-compatible frontend + Express, better-sqlite3, dotenv, cors, Vite, React, Recharts (001-virtual-trade-mvp)

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
- 003-real-price-backtest: Keeps the app focused on Kiwoom-backed historical price backtests. Single-price mode screens and live-order scaffolding are not part of the current MVP.
- 002-user-auth-and-kiwoom-market-data: Added JavaScript on Node.js 22+ for backend; React 19-compatible JavaScript frontend. + Express, better-sqlite3, dotenv, cors, Vite, React, Recharts. Add backend dependencies: `bcrypt`, `express-session`, `better-sqlite3-session-store`. Use built-in `node:crypto` for AES-256-GCM encryption.

- 001-virtual-trade-mvp: Added JavaScript on Node.js 22+; React 19-compatible frontend + Express, better-sqlite3, dotenv, cors, Vite, React, Recharts

<!-- MANUAL ADDITIONS START -->
- Do not push directly to `main`; use a feature branch, detailed pull request, review, then merge.
- Use Linux line endings only (`LF`), never Windows `CRLF`.
- This MVP must not implement or call real broker order APIs. Kiwoom integration is read-only market data for price and daily chart retrieval unless a later explicitly approved LIVE-order spec changes this.
- Pull request descriptions must be written in Korean.
<!-- MANUAL ADDITIONS END -->
