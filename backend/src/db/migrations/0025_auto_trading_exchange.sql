-- 자동매매 전략·주문에 거래소 코드(exchange)를 저장한다.
-- 그동안 자동매매 전략은 symbol/market/currency만 저장해, 해외 주문·잔고·미체결 조회 시
-- 거래소 코드가 비어 기본값(NASD)으로 처리됐다. SPY·VOO 같은 NYSE Arca(AMEX) 종목은
-- 거래소 코드가 틀리면 KIS가 "상품이 없습니다"로 거절할 수 있다.
-- 종목 검색에서 고른 거래소 코드를 전략·주문까지 이어 주기 위한 컬럼.
ALTER TABLE auto_trading_strategies ADD COLUMN exchange TEXT;
ALTER TABLE auto_trading_orders ADD COLUMN exchange TEXT;
