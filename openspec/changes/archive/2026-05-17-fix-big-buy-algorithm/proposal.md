## Why

현재 `LAOR_INFINITE_V2`의 "큰수 매수"는 라오어 무한매수법의 "큰 수" 개념과 어긋난다. 두 가지가 문제다.

1. **기준 가격**: 큰수 매수 지정가를 `전일 종가 × (1 + 여유율)`로 잡는다. 라오어의 "큰 수" LOC는 내 **평단가**에 앵커된 가격이며(평단가보다 한참 높은 값), 평단가 매수와 같은 기준을 공유해야 두 절반이 상호보완으로 동작한다.
2. **기본 여유율**: 비워두면 `0.1 / 분할 회차`로 계산한다. 40분할이면 +0.25%다. "큰 수"의 핵심은 평단가보다 **충분히 높은 가격**에 주문을 걸어 상승장에서도 거의 매일 체결되게 하는 것인데, +0.25%로는 조금만 올라도 체결되지 않는다. 그 결과 큰수 매수가 평단가 매수처럼 하락·보합일에만 체결되어 두 절반이 사실상 같은 매수가 되고, "상승장에서도 산다"는 큰수 매수의 존재 이유가 사라진다.

이전 change(`2026-05-15-change-buy-algorithm`)가 "정통 V2는 `+0.1/N`"이라는 출처 없는 전제로 도입한 산식이며, 이를 라오어 원형에 맞게 바로잡는다.

## What Changes

- **BREAKING**: 큰수 매수 지정가 기준 가격을 `전일 종가` → `평단가`로 변경. 큰수 매수 지정가 = `평단가 × (1 + 큰수 매수 여유율)`. 평단가 매수와 동일하게 평단가에 앵커된다.
- **BREAKING**: 큰수 매수 여유율 기본값을 산식 `0.1 / splitCount` → **고정 `0.1`(10%)** 로 변경. 분할 회차와 무관해진다. 사용자가 명시적으로 값을 넣으면 그 값을 그대로 쓰는 override 동작은 유지한다.
- 백테스트 엔진(`strategyEngine.js`)과 자동매매 엔진(`autoTradingStrategyEngine.js`) 모두 동일하게 적용. 단일가 평가 경로(`evaluate`)도 포함.
- 알고리즘 설명 화면(`LaorStrategyGuide`)과 큰수 매수 여유율 입력 도움말(백테스트·자동매매 폼)을 새 동작에 맞게 수정.
- `README.md`와 openspec baseline(`backtest`, `auto-trading`)의 큰수 매수 설명을 새 동작에 맞게 갱신.
- DB 스키마 변경 없음. `big_buy_premium_rate` 컬럼 의미("NULL이면 산식, 값이면 override")는 그대로이며 산식만 바뀐다.

## Capabilities

### New Capabilities
<!-- 없음 — 기존 capability의 동작 변경 -->

### Modified Capabilities

- `backtest`: 큰수 매수 지정가 기준을 평단가로, 기본 여유율을 고정 10%로 변경.
- `auto-trading`: 큰수 매수 지정가 기준을 평단가로, 기본 여유율을 고정 10%로 변경.

## Impact

- **코드**:
  - `backend/src/services/buyAlgorithm.js` — `resolveBigBuyPremiumRate`의 기본값 `0.1 / count` → `0.1`.
  - `backend/src/services/strategyEngine.js` — 백테스트 일봉/단일가 평가의 큰수 매수 지정가 `prevClose × (1+rate)` → `평단가 × (1+rate)`. 첫 매수 외 경로.
  - `backend/src/services/autoTradingStrategyEngine.js` — 자동매매 평가의 큰수 매수 지정가를 평단가 기준으로.
- **프론트엔드**:
  - `frontend/src/components/LaorStrategyGuide.jsx` — 큰수 매수 단계 설명(기준 가격·여유율).
  - `frontend/src/pages/BacktestPage.jsx`, `frontend/src/pages/AutoTradingPage.jsx` — 큰수 매수 여유율 입력 도움말.
- **문서**:
  - `README.md` — 큰수 매수 설명.
  - `openspec/specs/backtest.md`, `openspec/specs/auto-trading.md` — baseline 갱신(본 change 아카이브 시 반영).
- **테스트**: `backend/tests/` — 큰수 매수 지정가가 평단가 기준임을 검증하는 케이스로 갱신·추가. `prevClose` 기준 기대값을 쓰던 기존 테스트 수정.
- **기존 데이터/전략**: `big_buy_premium_rate`에 `0.1`이 명시 저장된 행은 그대로 override(10%)로 동작. NULL 행은 새 기본값(고정 10%)을 받는다. 마이그레이션 불필요.
- **운영**: RUNNING 자동매매 전략의 큰수 매수 체결 빈도·가격이 달라진다(상한이 넓어져 더 자주 체결). 행위 변경이므로 공지 필요.
