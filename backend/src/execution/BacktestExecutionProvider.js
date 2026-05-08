import { Decision, TradingMode } from '../domain/tradingMode.js';
import { evaluate as evaluateStrategy, initialState } from '../services/strategyEngine.js';

export class BacktestExecutionProvider {
  constructor() {
    this.mode = TradingMode.BACKTEST;
  }

  run({ params, dailyRows }) {
    if (!Array.isArray(dailyRows) || dailyRows.length === 0) {
      throw new Error('일봉 데이터가 없습니다.');
    }
    const initial = initialState(params);
    let state = initial;
    let peakAsset = params.totalBudget;
    let maxDrawdownRate = 0;
    let maxInvested = 0;
    let totalBuyCount = 0;
    let totalSellCount = 0;
    const trades = [];

    for (const row of dailyRows) {
      const decision = evaluateStrategy({
        mode: TradingMode.BACKTEST,
        price: row.close,
        tradeDate: row.date,
        params,
        state
      });
      const ns = decision.nextState;
      const evaluationAmount = Math.floor(ns.holdingQuantity * row.close);
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
        price: row.close,
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

      state = ns;
      if (decision.decision === Decision.COMPLETED) break;
      if (state.completed) break;
    }

    const lastRow = dailyRows[Math.min(dailyRows.length, trades.length) - 1];
    const lastClose = lastRow ? lastRow.close : 0;
    const evaluationAmount = Math.floor(state.holdingQuantity * lastClose);
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
