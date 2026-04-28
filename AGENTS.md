# infinite-buying Development Guidelines

Auto-generated from all feature plans. Last updated: 2026-04-28

## Active Technologies

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

- 001-virtual-trade-mvp: Added JavaScript on Node.js 22+; React 19-compatible frontend + Express, better-sqlite3, dotenv, cors, Vite, React, Recharts

<!-- MANUAL ADDITIONS START -->
- Do not push directly to `main`; use a feature branch, detailed pull request, review, then merge.
- Use Linux line endings only (`LF`), never Windows `CRLF`.
- This MVP must not implement or call real broker order APIs. Kiwoom integration is read-only market data for price and daily chart retrieval.
<!-- MANUAL ADDITIONS END -->
