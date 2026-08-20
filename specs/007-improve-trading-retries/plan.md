# Implementation Plan: 증거 기반 랭킹 자동매매와 주문 복구

**Branch**: `007-improve-trading-retries` | **Date**: 2026-08-20 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/007-improve-trading-retries/spec.md`

## Summary

운영 DB snapshot과 KIS 공식 과거 분봉으로 기존·대안 후보 규칙을 시간순 검증한다. clean validation이 부족하면 신규 규칙은 shadow로만 배포한다. 동시에 확정적 주문 거절만 재시도하고 ambiguous 결과는 조회로 해소하는 상태 머신, 5분 bounded 후보 재탐색, +2%/-5% 종료, stale 지정가 취소·재호가를 테스트 우선으로 구현한다.

## Technical Context

**Language/Version**: Node.js 24, JavaScript ES modules; React 19
**Primary Dependencies**: Express, better-sqlite3, 내장 fetch, Vite
**Storage**: SQLite production volume, migration files in `backend/src/db/migrations/`
**Testing**: Node `--test`, deterministic KIS fixtures, frontend production build
**Target Platform**: OCI Ampere A1 단일 노드 k3s, Argo CD
**Project Type**: Backend API/scheduler + React SPA + offline research scripts
**Performance Goals**: 30초 scheduler 안에서 사용자별 KIS rate limit을 지키며 평가 완료
**Constraints**: 실제 돈, user isolation, live default-off, no blind POST retry, no secret leakage, `ENABLE_RESERVED_ORDER=false`
**Scale/Scope**: 3개 독립 전략 중 KR/US 랭킹 진입·청산과 공통 KIS 주문 결과 분류; LAOR 위험은 별도 차단 또는 상태 머신 보강 없이는 live 완료로 간주하지 않음

## Constitution Check

- AGENTS.md의 feature branch→한국어 PR→review/merge 규칙을 따른다.
- KIS TR과 필드는 `KIS/한국투자증권_오픈API_전체문서_20260512_030000.xlsx`를 1차 기준으로 검증한다.
- live order는 전역·사용자 설정, 미체결·중복·매수가능금액·보유수량 검사를 모두 통과해야 한다.
- `ACCEPTED`를 체결로 취급하지 않는다.
- 테스트를 먼저 추가하고 실패를 확인한 뒤 구현하며 전체 backend test와 frontend build를 배포 gate로 둔다.
- 현재 constitution 파일이 템플릿 상태이므로 저장소의 AGENTS.md와 baseline spec의 더 엄격한 안전 규칙을 적용한다.

## Project Structure

### Documentation (this feature)

```text
specs/007-improve-trading-retries/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── shadow-experiment.md
└── tasks.md
```

### Source Code (repository root)

```text
backend/
├── scripts/
│   └── backtestKrRankRecent.js
├── src/
│   ├── db/migrations/
│   ├── repositories/
│   └── services/
│       ├── kisTradingService.js
│       ├── krRankService.js
│       ├── krRankStrategyEngine.js
│       └── usRankService.js
└── tests/
    ├── krRankService.test.js
    └── usRankService.test.js

frontend/src/pages/
├── KrRankAutoTradingPanel.jsx
└── UsRankAutoTradingPanel.jsx

infra/
└── manifests managed by Argo CD
```

**Structure Decision**: 기존 route→service→repository 구조와 독립적인 전략 scheduler를 유지한다. 백테스트는 운영 서비스 코드를 import하는 read-only script로 두되 KIS와 시간은 fixture로 재현 가능하게 분리한다.

## Design Phases

1. 전체 실전 및 30일 무매수 자료를 snapshot으로 감사하고 KIS 공식 분봉으로 재현한다.
2. +2/-5 라벨을 고정해 해석 가능한 후보 규칙들을 chronological train/validation으로 비교한다.
3. 주문 결과 분류와 bounded retry를 TDD로 보강한다.
4. 검증 gate 통과 규칙이 없으면 실제 30초 top 30/quote를 저장하는 shadow 실험을 배포한다.
5. feature PR CI 뒤 global live off 상태에서 rollout하고 read-only 검증 뒤 기존 승인 범위만 복원한다.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
| --- | --- | --- |
| 후보 규칙 여러 개를 shadow로 병렬 평가 | 과거에 없는 post-entry 실제 랭킹을 수집해야 clean 비교 가능 | 하나를 즉시 live로 고르면 같은 과거 데이터 과최적화와 실제 자금 손실 위험이 큼 |
| 주문 결과 상태를 세분화 | KIS POST 응답 유실과 명시 거절은 재시도 안전성이 다름 | FAILED 하나로 합치면 기회를 영구 종료하거나 중복 주문을 만듦 |
