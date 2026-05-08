export const TradingMode = Object.freeze({
  BACKTEST: 'BACKTEST'
});

export const TRADING_MODES = Object.freeze([
  TradingMode.BACKTEST
]);

export function isTradingMode(value) {
  return TRADING_MODES.includes(value);
}

export const Decision = Object.freeze({
  BUY: 'BUY',
  SELL: 'SELL',
  HOLD: 'HOLD',
  COMPLETED: 'COMPLETED'
});
