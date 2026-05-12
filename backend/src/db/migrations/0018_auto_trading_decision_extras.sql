-- 자동매매 판단 로그에 디버깅·추적용 필드 추가:
--   target_sell_price       : 평단가 × (1+목표수익률) — "지금 종목이 얼마가 되면 자동 매도되는지"
--   distance_to_target_rate : (목표가 - 현재가) / 목표가 — 음수면 목표가 도달, 양수면 도달까지의 비율
--   open_order_count        : 평가 시점 미체결 주문 수 (검색·필터링 용도로 구조화 저장)
--   evaluation_source       : 'MANUAL' 또는 'SCHEDULED' — 사용자가 직접 누른 평가인지, 스케줄러가 자동 실행한 것인지
--   order_id                : 이 판단에서 생성된 자동매매 주문 id (DRY_RUN 포함). 매수/매도가 안 일어났으면 NULL
ALTER TABLE auto_trading_decision_logs ADD COLUMN target_sell_price REAL;
ALTER TABLE auto_trading_decision_logs ADD COLUMN distance_to_target_rate REAL;
ALTER TABLE auto_trading_decision_logs ADD COLUMN open_order_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE auto_trading_decision_logs ADD COLUMN evaluation_source TEXT NOT NULL DEFAULT 'SCHEDULED';
ALTER TABLE auto_trading_decision_logs ADD COLUMN order_id INTEGER;
