# Design: Dashboard Main Workspace Redesign

## Current Problem

현재 화면은 시각적으로 중앙 영역이 가장 큰 비중을 차지하지만, 실제 기능 진입점은 왼쪽 사이드바에 있다.

문제는 사용자가 중앙을 메인 작업 공간으로 인식하는데, 중앙에는 실제 행동 버튼이나 상태 정보가 부족하다는 점이다. App.jsx는 기본 view에서 `<StrategiesPage>`(사이드바)와 `<StrategyDetailPage>`(중앙)를 함께 렌더링하며, 중앙은 선택된 라오어 전략 상세 또는 빈 안내 카드만 보여준다.

## Proposed Layout

```text
Left Sidebar (StrategiesPage)
- 브랜드
- 네비게이션: 대시보드 / 백테스트 / 자동매매 / KIS 설정
- 하단 상태 요약(이메일 / KIS 연결 / 자동매매 상태 / 로그아웃)

Main Dashboard (DashboardPage, section.content)
- 헤더(제목 + 목적 문구)
- 현재 상태 요약 카드
- 주요 액션 카드(KIS 설정 / 백테스트 / 자동매매)
- 설정 체크리스트
- 최근 활동(최근 백테스트 / 자동매매 상태)
```

## Main Dashboard Structure

### 1. Header

중앙 상단에 화면 목적을 명확히 보여준다. 예: "자동매매 대시보드 — KIS 연결 상태를 확인하고, 백테스트 또는 자동매매를 시작하세요."

### 2. Status Summary

현재 시스템 상태를 카드로 표시한다: KIS 연결 상태, 자동매매 상태(정지/실행 중 N개), 운용 전략, 최근 백테스트 결과, 실주문 설정(ON/OFF).

데이터 소스: `getKisSettings`(configured), `getKrRankOverview`/`getUsRankOverview`(liveOrderEnabled, strategies[].status), `listBacktests`.

### 3. Primary Action Cards

중앙에 3개의 주요 액션 카드(KIS 설정 / 백테스트 실행 / 자동매매 시작)를 배치한다. 우선순위:

1. KIS 미연결이면 `KIS 설정`을 가장 강조(primary-card).
2. KIS 연결 완료면 `백테스트`와 `자동매매`를 강조.

### 4. Setup Checklist

설정 미완료 사용자를 위해 체크리스트를 표시한다: KIS API 키 등록 / 계좌 연결 확인 / 전략 선택 / 백테스트 실행 / 자동매매 시작. 각 항목은 완료/미완료를 구분하고 클릭 시 관련 화면으로 이동한다. 모든 항목이 완료면 체크리스트는 접거나 완료 메시지를 표시한다.

### 5. Recent Activity

최근 백테스트 결과(종목·수익률·상태)와 자동매매 상태(실행 중 전략 또는 빈 상태)를 보여준다. 기록이 없으면 단순 "없음"이 아니라 다음 행동(백테스트 실행 / 자동매매 설정)으로 연결하는 empty state를 표시한다.

## Sidebar Design

사이드바는 기능 설명 카드·라오어 초안 목록을 제거하고 네비게이션과 하단 상태 요약만 둔다. 활성 화면(대시보드 등)을 시각적으로 표시한다.

## Removed Elements

- 라오어 초안 목록
- 사이드바의 home-action 카드(중앙 대시보드로 이동)
- 중앙의 큰 안내 전용 empty card

## Visual Direction

기존 테마를 유지하되, 가장 중요한 버튼은 primary 강조, 카드 중요도 차이를 두고, 중앙 영역 밀도를 높여 빈 느낌을 줄인다. 설명보다 상태·행동을 우선하고, 빈 상태도 다음 행동을 안내한다.

## Notes

- 라오어 전략 상세(`StrategyDetailPage`)는 기본 메인에서 더 이상 중앙 기본 화면이 아니다. 라오어 전략은 백테스트 흐름에서 계속 사용할 수 있다.
- 자동매매 전략 로직·백테스트 계산·KIS 연동·주문 실행은 변경하지 않는다(UI 한정).
