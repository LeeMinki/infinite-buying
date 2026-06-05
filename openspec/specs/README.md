# OpenSpec Baseline

본 디렉터리는 `infinite-buying` 레포의 **현재 구현 상태**를 OpenSpec 형식으로 정리한 baseline 문서 모음입니다. Spec Kit 산출물(`/specs/001~005`)은 그대로 유지되며, 본 baseline은 그 위에 "지금 코드가 무엇을 하는가"를 기준으로 작성되었습니다.

## 작성 원칙

- **현재 코드 기준**: README, route, service, repository, migration, frontend 페이지를 직접 확인하여 정리. 미구현이거나 코드에 없는 항목은 별도로 표시.
- **한국어 본문**: 파일명은 영어를 유지하되 본문은 한국어로 작성.
- **사실 위주**: "어떻게 동작하는가"만 정리하고, 향후 개선 제안은 [next-change-candidates.md](next-change-candidates.md)로 분리.

## 목차

| 영역 | 파일 |
| --- | --- |
| 제품 개요 | [product-overview.md](product-overview.md) |
| 사용자 인증 | [user-authentication.md](user-authentication.md) |
| KIS API 설정과 token 처리 | [kis-credentials-and-token.md](kis-credentials-and-token.md) |
| 종목 검색 / 시장 데이터 조회 | [market-data.md](market-data.md) |
| 백테스트 | [backtest.md](backtest.md) |
| 자동매매 | [auto-trading.md](auto-trading.md) |
| 주문 / 체결 / 포지션 기록 | [orders-fills-positions.md](orders-fills-positions.md) |
| 데이터베이스 모델 | [database-model.md](database-model.md) |
| Backend API | [backend-api.md](backend-api.md) |
| Frontend 화면 | [frontend-screens.md](frontend-screens.md) |
| 보안 / 민감정보 처리 | [security.md](security.md) |
| 현재 제한사항 | [current-limitations.md](current-limitations.md) |
| 남은 검증 / 운영 개선 후보 | [implementation-verification-needed.md](implementation-verification-needed.md) |
| Spec Kit ↔ OpenSpec 매핑 | [spec-kit-to-openspec-mapping.md](spec-kit-to-openspec-mapping.md) |
| 다음 change 후보 | [next-change-candidates.md](next-change-candidates.md) |
