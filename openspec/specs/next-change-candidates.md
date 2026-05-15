# 다음 OpenSpec Change 후보

본 baseline 작성 시점에 자연스럽게 떠오르는 다음 변경 후보 5개. 각 항목은 `openspec/changes/<slug>/` 아래에 proposal + tasks + 영향 받는 spec patch 형태로 작성하면 좋다.

순위는 위험도·가치를 함께 고려한 우선순위. 실제 일정은 사용자의 우선순위에 맞춰 재조정.

## 1. baseline-with-code 무결성 점검 change

**한 문장**: 본 baseline에서 "구현 확인 필요"로 표시한 [implementation-verification-needed.md](implementation-verification-needed.md) 항목을 모두 코드 확인 → baseline 갱신으로 마감.

- **대상 spec**: 본 OpenSpec baseline 전반.
- **산출물**: 각 항목별 결론 (코드 정합 / 추가 명세 / 신규 구현 필요).
- **위험**: 낮음. 코드 변경 없음.
- **가치**: 베이스라인 신뢰도 확보. 이후 모든 change의 기준점이 된다.

## 2. 자동 취소 동작에 대한 자동화 테스트 추가

**한 문장**: PR #21에서 추가한 자동매매 미체결 자동 취소 흐름(국내 `TTTC0013U`, 해외 `TTTT1004U`)에 단위·통합 테스트를 추가해 회귀를 방지한다.

- **대상 spec**: [auto-trading.md](auto-trading.md), [orders-fills-positions.md](orders-fills-positions.md).
- **시나리오**:
  - DRY_RUN 모드에서 자동 취소가 호출되지 않음.
  - 실주문 모드 + 우리가 만든 미체결 행만 cancel API가 호출되고 `CANCELED`로 마킹됨.
  - 외부 주문(우리 DB에 없는 `kis_order_no`)은 건드리지 않음.
  - cancel 실패 시 SafetyGuard가 그대로 차단하는지 확인.
- **위험**: 낮음. 테스트 추가만.
- **가치**: 자동 취소는 신규 기능이므로 회귀 위험이 크다.

## 3. 휴장일 / 장 운영 시간 판정 통합

**한 문장**: 현재 `isMarketSessionOpen(market)`이 휴장일·조기 폐장·시간 외를 어떻게 다루는지 명세화하고, 부족하면 보강한다.

- **대상 spec**: [auto-trading.md](auto-trading.md), [current-limitations.md](current-limitations.md).
- **고려**: KR / US 두 시장의 휴장일 캘린더 소스, 시간대(서머타임 포함), SKIP 사유 표준화.
- **위험**: 중간. 잘못된 판정은 불필요한 주문 또는 누락을 부른다.
- **가치**: SKIP 로그의 신뢰도와 운영팀의 디버깅 효율이 올라간다.

## 4. CSRF 정책 정리와 cookie SameSite 명세

**한 문장**: 현재 `cors({ origin: true, credentials: true })` 설정의 위험을 정리하고, `SameSite` 쿠키 속성·CSRF 토큰 사용 여부를 명세에 못 박는다.

- **대상 spec**: [security.md](security.md), [user-authentication.md](user-authentication.md).
- **고려**: 운영 도메인이 단일인지, frontend·backend 동일 origin인지, SPA 새 탭/임베드 가능성. 코드 변경이 필요하면 그 자체로 작은 change.
- **위험**: 중간. 잘못 바꾸면 인증이 깨질 수 있다.
- **가치**: 보안 표면 정리.

## 5. 1회·일일 주문 한도 컬럼 정리

**한 문장**: 더 이상 검사하지 않는 `max_order_amount`, `max_daily_order_amount`, `daily_order_limit_usages` 사용처를 정리하고, "삭제 또는 재활용" 결정을 baseline에 반영한다.

- **대상 spec**: [database-model.md](database-model.md), [orders-fills-positions.md](orders-fills-positions.md), [current-limitations.md](current-limitations.md).
- **선택지**:
  - (a) 컬럼·테이블 제거 마이그레이션 + 코드 정리.
  - (b) 그대로 두되 명세에서 "쓰지 않음"을 명확히 (현재 baseline이 이미 그렇게 적고 있음).
  - (c) "사용자별 일일 매수 상한"을 다시 살려서 SafetyGuard에 통합.
- **위험**: (a)는 DB 변경이라 중간. (b)는 낮음.
- **가치**: 코드와 명세의 불일치를 줄여 다음 작업자의 혼란을 줄인다.
