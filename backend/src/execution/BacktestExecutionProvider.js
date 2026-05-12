import { Decision, TradingMode } from '../domain/tradingMode.js';
import { evaluateDay, initialState } from '../services/strategyEngine.js';

export class BacktestExecutionProvider {
  constructor() {
    this.mode = TradingMode.BACKTEST;
  }

  run({ params, dailyRows }) {
    if (!Array.isArray(dailyRows) || dailyRows.length === 0) {
      throw new Error('일봉 데이터가 없습니다.');
    }
    let state = initialState(params);
    let peakAsset = params.totalBudget;
    let maxDrawdownRate = 0;
    let maxInvested = 0;
    let totalBuyCount = 0;
    let totalSellCount = 0;
    let prevClose = null;
    const trades = [];
    let lastClose = 0;
    let shouldStop = false;

    for (const row of dailyRows) {
      if (shouldStop) break;
      const ohlc = {
        open: row.open || row.close,
        high: row.high || row.close,
        low: row.low || row.close,
        close: row.close
      };
      const { decisions, nextState } = evaluateDay({
        mode: TradingMode.BACKTEST,
        ohlc,
        prevClose,
        params,
        state,
        tradeDate: row.date
      });
      for (const decision of decisions) {
        const ns = decision.nextState;
        const evaluationAmount = ns.holdingQuantity * row.close;
        const totalAsset = ns.cash + evaluationAmount;
        const unrealizedProfit = evaluationAmount - ns.investedAmount;
        if (totalAsset > peakAsset) peakAsset = totalAsset;
        const drawdownRate = peakAsset > 0 ? (peakAsset - totalAsset) / peakAsset : 0;
        if (drawdownRate > maxDrawdownRate) maxDrawdownRate = drawdownRate;
        if (ns.investedAmount > maxInvested) maxInvested = ns.investedAmount;
        if (decision.decision === Decision.BUY) totalBuyCount += 1;
        if (decision.decision === Decision.SELL) totalSellCount += 1;
        trades.push({
          tradeDate: row.date,
          side: decision.decision,
          price: decision.price,
          quantity: decision.quantity,
          amount: decision.amount,
          roundNo: decision.roundNo,
          cash: ns.cash,
          holdingQuantity: ns.holdingQuantity,
          averagePrice: ns.averagePrice,
          investedAmount: ns.investedAmount,
          realizedProfit: ns.realizedProfit,
          unrealizedProfit,
          evaluationAmount,
          totalAsset,
          drawdownRate,
          reason: decision.reason
        });
        if (decision.decision === Decision.COMPLETED) shouldStop = true;
        if (ns.completed) shouldStop = true;
      }
      state = nextState;
      prevClose = row.close;
      lastClose = row.close;
    }

    const evaluationAmount = state.holdingQuantity * lastClose;
    const finalAsset = state.cash + evaluationAmount;
    const unrealizedProfit = evaluationAmount - state.investedAmount;

    return {
      trades,
      summary: {
        finalAsset,
        realizedProfit: state.realizedProfit,
        unrealizedProfit,
        returnRate: params.totalBudget > 0
          ? (finalAsset - params.totalBudget) / params.totalBudget
          : 0,
        maxInvestedAmount: maxInvested,
        maxDrawdownRate,
        totalBuyCount,
        totalSellCount,
        finalHoldingQuantity: state.holdingQuantity,
        finalAveragePrice: state.averagePrice
      }
    };
  }
}
