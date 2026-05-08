# Data Model: Real-Price Backtest

## BacktestRun

- `id`
- `userId`
- `stockCode`
- `stockName`
- `fromDate`
- `toDate`
- `totalBudget`
- `splitCount`
- `buyAmountPerRound`
- `targetProfitRate`
- `restartAfterSell`
- `status`
- `initialBudget`
- `finalAsset`
- `realizedProfit`
- `unrealizedProfit`
- `returnRate`
- `maxInvestedAmount`
- `maxDrawdownRate`
- `totalBuyCount`
- `totalSellCount`
- `finalHoldingQuantity`
- `finalAveragePrice`
- `errorMessage`
- `createdAt`
- `completedAt`

## BacktestTrade

- `id`
- `userId`
- `runId`
- `tradeDate`
- `side`
- `price`
- `quantity`
- `amount`
- `roundNo`
- `cash`
- `holdingQuantity`
- `averagePrice`
- `investedAmount`
- `realizedProfit`
- `unrealizedProfit`
- `evaluationAmount`
- `totalAsset`
- `drawdownRate`
- `reason`
- `createdAt`

## MarketPriceCache

- `userId`
- `stockCode`
- `date`
- `open`
- `high`
- `low`
- `close`
- `volume`
- `source`

Backtests use only current-user rows whose `source` is `KIWOOM`.
