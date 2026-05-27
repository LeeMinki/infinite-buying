## 1. Data Preservation

- [x] 1.1 Add a migration for soft-delete support on `kr_rank_strategies` and `us_rank_strategies` without deleting linked orders, decisions, entries, or trades.
- [x] 1.2 Update 한국장·미국장 랭킹 repository delete/list/get-running queries so deleted strategies disappear from normal lists and scheduler targets while their records remain queryable by owner.

## 2. Rank History APIs

- [x] 2.1 Add 한국장 왕복 주문 이력 read model that returns buy time, symbol, buy price, sell time, sell price, sell reason, and profit rate.
- [x] 2.2 Add 미국장 왕복 주문 이력 read model with the same response shape and USD price formatting inputs.
- [x] 2.3 Add or extend 한국장·미국장 판단 로그 APIs to support 10-item paging with `limit` and `offset` or an equivalent cursor.

## 3. Frontend Navigation

- [x] 3.1 Change the 자동매매 tab order to 한국 국장 상승률, 미국장 상승률, 라오어 무한매수법 and make 한국장 탭 the first default.
- [x] 3.2 Rebuild the main screen by removing the left-side guide/common draft panels and adding direct entry cards for 백테스트, 자동매매, and KIS 설정.

## 4. Rank Detail UI

- [x] 4.1 Replace 한국장 랭킹 detail records with 주문 이력 followed by 판단 로그; remove the separate 진입 기록 table from the default view.
- [x] 4.2 Replace 미국장 랭킹 detail records with 주문 이력 followed by 판단 로그; remove the separate 매매 사이클 table from the default view.
- [x] 4.3 Render the 주문 이력 table as 왕복 거래 rows with columns `매수 시각(KST)`, `종목`, `매수가`, `매도 시각`, `매도가`, `사유`, `손익`.
- [x] 4.4 Show only the first 10 판단 로그 rows and add a 더보기 control that appends the next page.

## 5. Tests

- [x] 5.1 Add backend tests proving 한국장·미국장 strategy deletion preserves orders, decisions, entries/trades, and excludes deleted strategies from scheduler queries.
- [x] 5.2 Add backend tests for 한국장·미국장 round-trip order history response shape and userId scoping.
- [x] 5.3 Add frontend tests or focused component checks for tab order, home entry cards, rank order-history columns, and decision-log 더보기 behavior.

## 6. Documentation

- [x] 6.1 Update README or OpenSpec baseline notes if implementation changes user-visible automatic trading navigation or deletion semantics.
