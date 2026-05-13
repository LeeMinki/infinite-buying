import { getDb } from '../db/connection.js';
import * as strategiesRepository from '../repositories/strategiesRepository.js';
import * as holdingsRepository from '../repositories/holdingsRepository.js';

export function listStrategies(userId) {
  return strategiesRepository.listStrategies(userId);
}

export function getStrategyOrThrow(userId, id) {
  const strategy = strategiesRepository.getStrategy(userId, id);
  if (!strategy) {
    const error = new Error('Strategy not found');
    error.status = 404;
    throw error;
  }
  return strategy;
}

export function createStrategy(userId, input) {
  const normalized = normalizeStrategyInput(input);
  return getDb().transaction(() => {
    const strategy = strategiesRepository.createStrategy(userId, normalized);
    holdingsRepository.createHolding(userId, strategy.id, strategy.totalBudget);
    return strategy;
  })();
}

export function updateStrategy(userId, id, input) {
  getStrategyOrThrow(userId, id);
  const normalized = normalizeStrategyInput(input);
  const strategy = strategiesRepository.updateStrategy(userId, id, normalized);
  return strategy;
}

export function deleteStrategy(userId, id) {
  if (!strategiesRepository.deleteStrategy(userId, id)) {
    const error = new Error('Strategy not found');
    error.status = 404;
    throw error;
  }
}

export function getHolding(userId, strategyId) {
  getStrategyOrThrow(userId, strategyId);
  return holdingsRepository.getHoldingByStrategy(userId, strategyId);
}

function normalizeStrategyInput(input) {
  const totalBudget = Number(input.totalBudget);
  const splitCount = Number(input.splitCount || 40);
  const targetProfitRate = Number(input.targetProfitRate ?? 0.1);
  const bigBuyPremiumRate = Number(input.bigBuyPremiumRate ?? 0.1);
  if (!input.name || !input.stockCode || !input.stockName) {
    const error = new Error('name, stockCode, and stockName are required');
    error.status = 400;
    throw error;
  }
  if (!Number.isFinite(totalBudget) || totalBudget <= 0 || !Number.isFinite(splitCount) || splitCount <= 0) {
    const error = new Error('totalBudget and splitCount must be positive numbers');
    error.status = 400;
    throw error;
  }
  if (!Number.isFinite(bigBuyPremiumRate) || bigBuyPremiumRate < 0) {
    const error = new Error('bigBuyPremiumRate must be a non-negative number');
    error.status = 400;
    throw error;
  }
  return {
    name: input.name.trim(),
    stockCode: input.stockCode.trim(),
    stockName: input.stockName.trim(),
    totalBudget: Math.floor(totalBudget),
    splitCount: Math.floor(splitCount),
    targetProfitRate,
    bigBuyPremiumRate,
    status: input.status === 'PAUSED' ? 'PAUSED' : 'ACTIVE'
  };
}
