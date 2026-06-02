# 현재 제한사항

본 baseline 시점에 **코드에 구현되어 있지 않거나 의도적으로 비활성화된** 항목.

## 비목표 (의도적 미구현)

- **예약주문**: `ENABLE_RESERVED_ORDER=false` 유지. KIS 예약주문 API 미연동.
- **수수료/세금/환율/슬리피지 정밀 계산**: 백테스트는 0으로 가정. 자동매매도 별도 환산·수수료 계산 없음.
- **주문 실패 자동 재시도**: 실패는 `FAILED`로 기록만 하고 자동 재시도 없음.
- **KRW → USD 자동 환전**: 본 앱은 환전 API를 호출하지 않는다. 사용자가 KIS HTS `[0867]` 통합증거금 신청 또는 직접 환전한 USD 잔고로만 매수.
- **다종목 포트폴리오**: 자동매매 전략은 단일 종목 단위. 종목간 자금 배분/리밸런싱 없음.
- **모의투자(KIS Mock) 분기**: `KIS_API_BASE_URL`을 실서비스로 고정. 모의투자 URL 분기 없음.

## 부분 구현 / 비활성

- **1회·일일 주문 한도 검사**: 컬럼(`max_order_amount`, `max_daily_order_amount`, `daily_order_limit_usages`)은 존재하지만 SafetyGuard에서 더 이상 검사하지 않는다. 컬럼은 0으로 채워 호환만 유지.
- **해외 소수점매수**: KIS Open API는 해외 소수점매수 endpoint를 제공하지 않는다(2026-05-12 자 KIS 공식 엑셀·GitHub 샘플·API 포털 전수 확인). 해외 소수점거래는 KIS MTS 앱 전용 서비스다. 따라서 자동매매·실주문은 **1주 단위 매수만** 지원한다. 회차 절반 예산이 1주 가격보다 작으면 `auto_trading_strategies.pending_avg_budget` / `pending_big_budget`에 누적(carryover)했다가 1주 값 이상이 되면 매수한다. 백테스트는 기본 1주 단위이며, `allow_fractional_shares` 옵션을 켜면 소수점 수량 시뮬레이션 결과를 참고용으로 제공한다.

## 기능적 제약

- **자동매매 평가 주기**: 기본 600,000ms (10분). 더 짧은 주기는 KIS rate limit 위반 위험.
- **장 운영 시간 체크**: `isMarketSessionOpen(market)`로 처리하지만, 휴장일/시간 외 거래/조기 폐장 같은 케이스의 정확한 처리는 **구현 확인 필요** (`backend/src/services/autoTradingService.js`).
- **자동 취소 대상**: 우리 시스템이 만든 미체결(`auto_trading_orders.kis_order_no` 매칭) 행만. 사용자가 HTS/MTS로 직접 만든 외부 주문은 SafetyGuard가 SKIP만 할 뿐 자동 취소하지 않는다.
- **DRY_RUN 모드**: 자동 취소를 수행하지 않는다.

## UI 제약

- 라우팅 라이브러리 미사용 → 딥링크/뒤로가기/다중 탭 동기화 부재.
- 단일 종목 자동매매 화면. 여러 전략 모니터링 대시보드는 칩 그룹 + 단일 상세 패널 구조.

## 운영

- 배포: GitHub Actions → GHCR → Oracle A1 k3s → Argo CD. `main` 머지 시 파이프라인 트리거. `[skip deploy]` 커밋으로 스킵.
- 로그 수집/관측: 코드 상 명시적 로그 수집기 미확인. **구현 확인 필요**.
