# 종목 검색 / 시장 데이터 조회

## 책임

KIS Open API를 통해 국내(`KR`)·해외(주로 `US`) 종목의 현재가, 일봉, 종목 검색 결과를 제공한다. 일봉 응답은 사용자별 캐시에 저장해 재조회 비용을 줄인다.

## 주요 파일

- `backend/src/routes/marketRoutes.js`
- `backend/src/services/marketDataService.js` — `getCurrentPrice`, `getDailyPrices`, `searchSymbols`
- `backend/src/market-data/KisMarketDataProvider.js` — KIS REST 호출
- `backend/src/repositories/marketPriceCacheRepository.js`

## API

| Method | Path | 설명 |
| --- | --- | --- |
| GET | `/api/market/stocks/search?q=...` | KIS 종목 검색. 국내/해외 모두. 응답에는 소수점매매 가능 여부(`mintDcptTradPsblYn`) 등 부가 정보가 포함될 수 있음. |
| GET | `/api/market/:market/:symbol/price?exchange=...` | 단일 종목 현재가. `market`은 `KR` 또는 `US` 등. |
| GET | `/api/market/:market/:symbol/daily?from=YYYY-MM-DD&to=YYYY-MM-DD&refresh=true` | 일봉. 기본은 캐시 사용, `refresh=true`이면 KIS 재조회. |
| GET | `/api/market/us/:symbol/price` | 위 일반 경로의 US 전용 단축 경로. 동일 동작. |
| GET | `/api/market/us/:symbol/daily` | 위 일반 경로의 US 전용 단축 경로. |

## 캐시

`market_price_cache` (`migrations/0013_market_cache_us_symbol.sql`):

- `(user_id, market, symbol, date)` UNIQUE
- `open / high / low / close / volume / currency / source`
- 기본 source는 `KIS_API`

캐시 만료 정책: `marketDataService.getDailyPrices`가 요청 범위에 포함된 거래일이 모두 채워졌는지(`hasCoverage`) 확인하고, 부족하면 KIS에 재요청 후 빈 날만 추가 저장. `refresh=true`이면 무조건 KIS 재조회.

## 오류 처리

- KIS 호출 실패 시 응답은 HTTP 503 또는 KIS 응답 상태로 변환되고, body에 `error` 메시지와 `manualFallback` 플래그를 포함.
- 현재가 실패 시 `manualFallback: true`(사용자가 수동 입력으로 대체 가능), 일봉 실패 시 `manualFallback: false`(백테스트는 일봉 없이 진행 불가).
