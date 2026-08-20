# Tasks: 증거 기반 랭킹 자동매매와 주문 복구

**Input**: Design documents from `/specs/007-improve-trading-retries/`
**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts)

## Phase 1: 운영 사실과 재현 기준

- [X] T001 [US1] `test3@test.com`의 KR/US/LAOR 전략·주문·체결·판단·잔고를 read-only snapshot과 KIS GET으로 감사하고 `test3-trading-audit-2026-08-19.md`에 기록한다.
- [X] T002 [US1] 최근 30일 923개 관찰/44구간에 현재 rolling 후보·분봉 필터를 재현하는 `backend/scripts/backtestKrRankRecent.js`와 `kr-rank-current-backtest-2026-08-19.md`를 만든다.
- [ ] T003 [US1] 백테스트 종료를 +2%/-5%로 고정하고 deterministic KIS fixture, 비용, slippage, same-candle stop-first, PF/MDD 계산 테스트를 먼저 추가한다. (운영 snapshot/KIS time-split 실행은 완료, fixture 자동화는 미완료)
- [X] T004 [US1] 현재 구현과 지속성·분봉·점수 변형을 chronological train/validation로 비교하고 누수·표본 한계를 `kr-rank-timesplit-validation-2026-08-20.md`에 남긴다.

## Phase 2: 주문 상태 안전성

- [X] T005 [US2] KIS POST의 HTTP 200 business rejection만 `REJECTED`, EGW/429/5xx/network/parse ambiguity는 `UNKNOWN`임을 검증하는 실패 테스트를 추가한다.
- [X] T006 [US2] `backend/src/services/kisTradingService.js`의 결과 분류와 주문번호 없는 성공 응답 fail-closed를 구현해 T005를 통과시킨다.
- [X] T007 [US2] KR의 5분 bounded rolling 탐색, next-tick 확인, 명시 거절 최대 5회 재시도, 90초 0-fill BUY 취소 확인 후 재호가 테스트와 구현을 추가한다.
- [X] T008 [US2] US의 명시 거절 전 최신 top3/분봉/±2% 재검증과 25초 stale 방어 SELL 취소·재호가 테스트와 구현을 추가한다.
- [X] T009 [US2] LAOR의 `ACCEPTED != FILLED`·외부 동일종목 provenance blocker가 남아 있는 동안 `LAOR_LIVE_ORDER_ENABLED=false`에서 사용자 토글과 무관하게 DRY_RUN만 남기는 회귀 테스트와 production 잠금을 추가한다.

## Phase 3: +2/-5 종료 불변조건

- [X] T010 [US3] KR/US의 +2% target, -5% hard stop 경계와 구조적 조기 종료 사유 분리 테스트를 먼저 추가한다.
- [X] T011 [US3] 현재 dirty diff의 -4% hard stop을 -5% 고정 기준과 일치시키고 UI·baseline spec·백테스트를 함께 갱신한다.
- [X] T012 [US3] KR/US의 partial fill, stale defensive sell, accepted-only 상태에서 position을 확정하지 않는 회귀 테스트를 통과시킨다. (gap 체결가는 보장하지 않고 문서화)

## Phase 4: Clean shadow validation

- [ ] T013 [US4] experiment/signal/virtual trade migration과 repository user-scope 테스트를 먼저 추가한다.
- [ ] T014 [US4] 실제 top30·30초 quote·완성 분봉과 V0~V5 판단을 저장하는 shadow evaluator를 구현한다.
- [X] T014a [US4] 별도 migration 없이 기존 user-scoped `kr_rank_observations`에 첫 live 판단 뒤 5분 실제 top 30을 저장하고 KIS 주문 POST가 0건임을 회귀 테스트한다.
- [ ] T015 [US4] +2/-5/time virtual exit와 cost/slippage 성과 집계를 구현한다.
- [ ] T016 [US4] 최소 20 validation trades, expectancy > 0, PF > 1, MDD ≤ 10% gate와 threshold freeze를 구현한다.
- [X] T017 [US4] 신규 5분 재탐색 규칙이 gate 전 KIS 주문 POST를 호출하지 않고 raw shadow 관찰만 저장하는 integration test를 통과시킨다.

## Phase 5: 문서·검증·배포

- [X] T018 README, openspec baseline, KR/US UI를 실제 동작·고정 +2/-5·shadow 한계와 일치시킨다.
- [X] T019 backend 전체 test 320건, frontend production build, syntax, LF, `git diff --check`를 통과시킨다.
- [X] T020 보안·user isolation·secret masking·예약주문 비활성·diff를 최종 감사한다.
- [ ] T021 feature branch를 commit/push하고 상세한 한국어 PR을 생성해 green CI와 review를 확인한 뒤 merge한다.
- [ ] T022 운영 DB backup과 기존 image SHA를 기록하고 global live-off 상태에서 Argo CD rollout한다.
- [ ] T023 production image/pod/DB/scheduler/shadow signal/의도하지 않은 주문 0건을 검증한 뒤 허용된 기존 설정만 복원한다.

## Dependencies & Execution Order

- T003→T004가 수익성 판단의 근거다.
- T005→T006, T010→T011, T013→T014→T015→T016→T017은 테스트 우선 순서다.
- T009와 T012가 끝나기 전 전체 자동매매의 주문 안전 완료를 주장하지 않는다.
- live 알고리즘 승격은 T016 gate 통과 뒤 별도 명시적 승인으로만 가능하다. T021~T023은 gate 미달 시 shadow 배포로 수행한다.
