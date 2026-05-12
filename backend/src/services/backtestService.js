import * as runsRepo from '../repositories/backtestRunsRepository.js';
import * as tradesRepo from '../repositories/backtestTradesRepository.js';
import { BacktestExecutionProvider } from '../execution/BacktestExecutionProvider.js';
import { getDailyPrices } from './marketDataService.js';

const NOTICE = '투자 수익을 보장하지 않습니다.';
const EMPTY_DAILY_MESSAGE = '해당 기간의 일봉 데이터가 없습니다';

function badRequest(message) {
  const e = new Error(message);
  e.status = 400;
  return e;
}

function notFound() {
  const e = new Error('Backtest not found');
  e.status = 404;
  return e;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function validateInput(input) {
  if (!input || typeof input !== 'object') throw badRequest('요청이 올바르지 않습니다.');
  const symbol = String(input.symbol || input.stockCode || '').trim().toUpperCase();
  if (!symbol) throw badRequest('종목코드 또는 심볼을 입력하세요.');
  const market = normalizeMarket(input.market, symbol);
  const fromDate = String(input.fromDate || '');
  const toDate = String(input.toDate || '');
  if (!ISO_DATE.test(fromDate) || !ISO_DATE.test(toDate)) {
    throw badRequest('기간은 YYYY-MM-DD 형식이어야 합니다.');
  }
  if (fromDate > toDate) throw badRequest('시작일은 종료일보다 이전이어야 합니다.');
  const totalBudget = Number(input.totalBudget);
  if (!Number.isFinite(totalBudget) || totalBudget <= 0) throw badRequest('총 투자금은 0보다 커야 합니다.');
  const targetProfitRate = Number(input.targetProfitRate);
  if (!Number.isFinite(targetProfitRate) || targetProfitRate <= 0) throw badRequest('목표 수익률은 0보다 커야 합니다.');
  const splitCountRaw = Number(input.splitCount);
  const splitCount = Number.isInteger(splitCountRaw) && splitCountRaw > 0 ? splitCountRaw : 40;
  return {
    symbol,
    market,
    currency: market === 'KR' ? 'KRW' : 'USD',
    fromDate,
    toDate,
    totalBudget,
    splitCount,
    targetProfitRate,
    restartAfterSell: input.restartAfterSell !== false
  };
}

function publicRun(run) {
  if (!run) return null;
  return {
    id: run.id,
    symbol: run.symbol,
    market: run.market,
    currency: run.currency,
    dataSource: run.dataSource,
    fromDate: run.fromDate,
    toDate: run.toDate,
    totalBudget: run.totalBudget,
    splitCount: run.splitCount,
    buyAmountPerRound: run.buyAmountPerRound,
    initialLumpRatio: run.initialLumpRatio,
    dailyAmount: run.dailyAmount,
    algorithm: run.algorithm,
    targetProfitRate: run.targetProfitRate,
    restartAfterSell: run.restartAfterSell,
    status: run.status,
    initialBudget: run.initialBudget,
    finalAsset: run.finalAsset,
    realizedProfit: run.realizedProfit,
    unrealizedProfit: run.unrealizedProfit,
    returnRate: run.returnRate,
    maxInvestedAmount: run.maxInvestedAmount,
    maxDrawdownRate: run.maxDrawdownRate,
    totalBuyCount: run.totalBuyCount,
    totalSellCount: run.totalSellCount,
    finalHoldingQuantity: run.finalHoldingQuantity,
    finalAveragePrice: run.finalAveragePrice,
    errorMessage: run.errorMessage,
    createdAt: run.createdAt,
    completedAt: run.completedAt,
    notice: NOTICE
  };
}

function getRunOrThrow(userId, id) {
  const run = runsRepo.getRun(userId, id);
  if (!run) throw notFound();
  return run;
}

export function listRuns(userId) {
  return runsRepo.listRuns(userId).map(publicRun);
}

export function getRun(userId, id) {
  return publicRun(getRunOrThrow(userId, id));
}

export function listTrades(userId, runId) {
  getRunOrThrow(userId, runId);
  return tradesRepo.listTrades(userId, runId);
}

export function deleteRun(userId, runId) {
  getRunOrThrow(userId, runId);
  runsRepo.deleteRun(userId, runId);
}

export async function createRun(userId, input) {
  const params = validateInput(input);
  const run = runsRepo.createRun(userId, params);
  try {
    // Cache-first: 같은 종목/기간을 다시 돌릴 때 KIS를 또 부르지 않고, KIS가 일시적으로
    // 불안정해도 캐시가 있으면 그대로 백테스트를 진행한다. 일봉은 하루 단위이므로 안전.
    const dailyRows = await getDailyPrices(userId, params.symbol, {
      market: params.market,
      from: params.fromDate,
      to: params.toDate
    });
    if (!dailyRows || dailyRows.length === 0) {
      runsRepo.failRun(userId, run.id, EMPTY_DAILY_MESSAGE);
      throw badRequest(EMPTY_DAILY_MESSAGE);
    }
    const provider = new BacktestExecutionProvider();
    const { trades, summary } = provider.run({
      params: {
        totalBudget: params.totalBudget,
        splitCount: params.splitCount,
        targetProfitRate: params.targetProfitRate,
        allowFractionalShares: params.market === 'US',
        restartAfterSell: params.restartAfterSell
      },
      dailyRows
    });
    tradesRepo.bulkInsert(userId, run.id, trades);
    const completed = runsRepo.completeRun(userId, run.id, summary);
    return publicRun(completed);
  } catch (error) {
    runsRepo.failRun(userId, run.id, error.message);
    if (error.status) throw error;
    throw error;
  }
}

function normalizeMarket(value, symbol) {
  const market = String(value || '').trim().toUpperCase();
  if (market === 'KR' || market === 'KOSPI' || market === 'KOSDAQ') return 'KR';
  if (market === 'US') return 'US';
  return /^\d{6}$/.test(symbol) ? 'KR' : 'US';
}
