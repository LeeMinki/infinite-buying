import { getDb } from '../db/connection.js';
import { evaluateStrategy } from './strategyCalculator.js';
import { getStrategyOrThrow } from './strategiesService.js';
import * as holdingsRepository from '../repositories/holdingsRepository.js';
import * as virtualOrdersRepository from '../repositories/virtualOrdersRepository.js';
import * as decisionLogsRepository from '../repositories/decisionLogsRepository.js';
import * as strategiesRepository from '../repositories/strategiesRepository.js';

export function evaluate(strategyId, input) {
  const currentPrice = Number(input.currentPrice);
  if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
    const error = new Error('currentPrice is required and must be greater than zero');
    error.status = 400;
    throw error;
  }

  return getDb().transaction(() => {
    const strategy = getStrategyOrThrow(strategyId);
    const holding = holdingsRepository.getHoldingByStrategy(strategyId);
    const result = evaluateStrategy({ strategy, holding, currentPrice });
    const orderDate = new Date().toISOString().slice(0, 10);
    let virtualOrder = null;
    let reason = result.reason;

    if (result.decision === 'BUY') {
      const duplicate = virtualOrdersRepository.findBuy(strategyId, orderDate, result.roundNo);
      if (duplicate) {
        reason = 'Duplicate buy for the same strategy, date, and round was prevented';
      } else {
        virtualOrder = virtualOrdersRepository.createVirtualOrder({
          strategyId,
          orderDate,
          side: 'BUY',
          price: currentPrice,
          quantity: result.quantity,
          amount: result.amount,
          roundNo: result.roundNo,
          reason: result.reason
        });
      }
    }

    if (result.decision === 'SELL' && result.quantity > 0) {
      virtualOrder = virtualOrdersRepository.createVirtualOrder({
        strategyId,
        orderDate,
        side: 'SELL',
        price: currentPrice,
        quantity: result.quantity,
        amount: result.amount,
        roundNo: result.roundNo,
        reason: result.reason
      });
    }

    const log = decisionLogsRepository.createDecisionLog({
      strategyId,
      inputPrice: currentPrice,
      averagePrice: holding.averagePrice,
      quantity: holding.quantity,
      decision: virtualOrder ? result.decision : result.decision === 'BUY' && reason !== result.reason ? 'HOLD' : result.decision,
      reason
    });

    return {
      decision: log.decision,
      reason,
      virtualOrder,
      log
    };
  })();
}

export function listOrders(strategyId) {
  getStrategyOrThrow(strategyId);
  return virtualOrdersRepository.listOrders(strategyId);
}

export function listLogs(strategyId) {
  getStrategyOrThrow(strategyId);
  return decisionLogsRepository.listLogs(strategyId);
}

export function fillOrder(orderId) {
  return getDb().transaction(() => {
    const order = getPendingOrder(orderId);
    const filledOrder = virtualOrdersRepository.markFilled(orderId);
    const holding = order.side === 'BUY'
      ? holdingsRepository.updateHoldingAfterBuy(order.strategyId, order)
      : holdingsRepository.updateHoldingAfterSell(order.strategyId, order);
    if (order.side === 'BUY') {
      strategiesRepository.incrementRound(order.strategyId);
    }
    return { order: filledOrder, holding };
  })();
}

export function cancelOrder(orderId) {
  const order = getPendingOrder(orderId);
  return { order: virtualOrdersRepository.markCanceled(order.id) };
}

function getPendingOrder(orderId) {
  const order = virtualOrdersRepository.getOrder(orderId);
  if (!order) {
    const error = new Error('Virtual order not found');
    error.status = 404;
    throw error;
  }
  if (order.status !== 'PENDING') {
    const error = new Error('Virtual order is not pending');
    error.status = 409;
    throw error;
  }
  return order;
}
