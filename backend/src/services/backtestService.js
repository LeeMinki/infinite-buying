import * as runsRepo from '../repositories/backtestRunsRepository.js';
import * as tradesRepo from '../repositories/backtestTradesRepository.js';
import { CachedMarketDataProvider } from '../market-data/CachedMarketDataProvider.js';
import { BacktestExecutionProvider } from '../execution/BacktestExecutionProvider.js';

const NOTICE = '투자 수익을 보장하지 않습니다.';

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
  const stockCode = String(input.stockCode || '').trim();
  if (!stockCode) throw badRequest('종목 코드를 입력하세요.');
  const fromDate = String(input.fromDate || '');
  const toDate = String(input.toDate || '');
  if (!ISO_DATE.test(fromDate) || !ISO_DATE.test(toDate)) {
    throw badRequest('기간은 YYYY-MM-DD 형식이어야 합니다.');
  }
  if (fromDate > toDate) throw badRequest('시작일은 종료일보다 이전이어야 합니다.');
  const totalBudget = Number(input.totalBudget);
  if (!Number.isFinite(totalBudget) || totalBudget <= 0) throw badRequest('총 투자금은 0보다 큰 정수여야 합니다.');
  const splitCount = Number(input.splitCount);
  if (!Number.isInteger(splitCount) || splitCount <= 0) throw badRequest('분할 회차는 1 이상의 정수여야 합니다.');
  const targetProfitRate = Number(input.targetProfitRate);
  if (!Number.isFinite(targetProfitRate) || targetProfitRate <= 0) throw badRequest('목표 수익률은 0보다 커야 합니다.');
  return {
    stockCode,
    stockName: input.stockName ? String(input.stockName).trim() : null,
    fromDate,
    toDate,
    totalBudget: Math.floor(totalBudget),
    splitCount,
    targetProfitRate,
    restartAfterSell: input.restartAfterSell !== false
  };
}

function publicRun(run) {
  if (!run) return null;
  return {
    id: run.id,
    stockCode: run.stockCode,
    stockName: run.stockName,
    fromDate: run.fromDate,
    toDate: run.toDate,
    totalBudget: run.totalBudget,
    splitCount: run.splitCount,
    buyAmountPerRound: run.buyAmountPerRound,
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

export function createRun(userId, input) {
  const params = validateInput(input);
  const run = runsRepo.createRun(userId, params);
  try {
    const cache = new CachedMarketDataProvider(userId);
    const dailyRows = cache.listDailyPrices(params.stockCode, {
      from: params.fromDate,
      to: params.toDate
    });
    if (!dailyRows || dailyRows.length === 0) {
      runsRepo.failRun(userId, run.id, '선택한 기간의 실제 가격 데이터가 없습니다. 기간을 조정하거나 키움 설정을 확인해 주세요.');
      throw badRequest('선택한 기간의 실제 가격 데이터가 없습니다. 기간을 조정하거나 키움 설정을 확인해 주세요.');
    }
    if (dailyRows.some((row) => !isKiwoomSource(row.source))) {
      const message = '선택한 기간의 실제 가격 데이터를 다시 불러와야 합니다. 키움 설정을 확인한 뒤 백테스트를 다시 실행해 주세요.';
      runsRepo.failRun(userId, run.id, message);
      throw badRequest(message);
    }
    const provider = new BacktestExecutionProvider();
    const { trades, summary } = provider.run({
      params: {
        totalBudget: params.totalBudget,
        splitCount: params.splitCount,
        buyAmountPerRound: run.buyAmountPerRound,
        targetProfitRate: params.targetProfitRate,
        restartAfterSell: params.restartAfterSell
      },
      dailyRows
    });
    tradesRepo.bulkInsert(userId, run.id, trades);
    const completed = runsRepo.completeRun(userId, run.id, summary);
    return publicRun(completed);
  } catch (error) {
    if (error.status) throw error;
    runsRepo.failRun(userId, run.id, error.message);
    throw error;
  }
}

function isKiwoomSource(source) {
  return String(source || '').toUpperCase() === 'KIWOOM';
}
