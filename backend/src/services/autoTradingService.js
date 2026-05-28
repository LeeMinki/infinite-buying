import * as repo from '../repositories/autoTradingRepository.js';
import { evaluateAutoTrading } from './autoTradingStrategyEngine.js';
import { validateOrderSafety } from './autoTradingSafetyGuard.js';
import { KisTradingService, maskPayload } from './kisTradingService.js';
import { getValidAccessToken } from './kisTokenManager.js';
import { resolveBigBuyPremiumRate } from './buyAlgorithm.js';
import * as kisCredentialService from './kisCredentialService.js';
import * as krRankService from './krRankService.js';
import * as usRankService from './usRankService.js';

const LOCK_KEY = 'evaluate';
// 같은 (거래일·전략·슬롯) 주문이 실패로 누적되면 더 시도하지 않는 한도.
const ORDER_RETRY_LIMIT = 5;
const PAGE_SIZE_DEFAULT = 50;
const PAGE_SIZE_MAX = 200;
const PERIOD_RETURN_DEFS = [
  { key: '1d', label: '1일', days: 1 },
  { key: '7d', label: '7일', days: 7 },
  { key: '30d', label: '30일', days: 30 },
  { key: '90d', label: '90일', days: 90 },
  { key: '1y', label: '1년', days: 365 }
];
// 손익 집계에서 제외할 주문 상태.
// - 실패/거부/취소: 애초에 거래가 아님.
// - DRY_RUN: 실주문 OFF(모의) 기록이므로 실거래 손익에 섞으면 안 된다.
const EXCLUDED_REALIZED_ORDER_STATUSES = new Set(['FAILED', 'REJECTED', 'CANCELED', 'DRY_RUN']);
// 기간 수익률은 주문 이력(로컬 DB)만으로 계산되므로 랜딩 반복 진입 시 재계산을 줄이도록 짧게 캐시한다.
const PERIOD_RETURNS_CACHE_TTL_MS = 30 * 1000;
const periodReturnsCache = new Map();

function normalizePaging({ limit, offset } = {}) {
  const limitNum = Math.min(Math.max(Math.trunc(Number(limit)) || PAGE_SIZE_DEFAULT, 1), PAGE_SIZE_MAX);
  const offsetNum = Math.max(Math.trunc(Number(offset)) || 0, 0);
  return { limit: limitNum, offset: offsetNum };
}

export function getSettings(userId) {
  return {
    ...repo.getSettings(userId),
    histories: repo.listSettingHistories(userId, 10)
  };
}

export function updateLiveOrderSetting(userId, enabled) {
  return {
    ...repo.updateLiveOrderSetting(userId, enabled === true),
    histories: repo.listSettingHistories(userId, 10)
  };
}

export function createStrategy(userId, input) {
  const params = normalizeStrategyInput(input);
  return repo.createStrategy(userId, params);
}

export function listStrategies(userId) {
  return repo.listStrategies(userId);
}

export function getStrategy(userId, id) {
  return requireStrategy(userId, id);
}

export function updateStrategy(userId, id, input) {
  requireStrategy(userId, id);
  return repo.updateStrategy(userId, id, normalizeStrategyInput(input));
}

export function deleteStrategy(userId, id) {
  requireStrategy(userId, id);
  repo.deleteStrategy(userId, id);
}

export function startStrategy(userId, id) {
  requireStrategy(userId, id);
  const strategy = repo.startStrategy(userId, id);
  const settings = repo.getSettings(userId);
  repo.createDecisionLog(userId, {
    strategyId: strategy.id,
    symbol: strategy.symbol,
    market: strategy.market,
    currency: strategy.currency,
    currentPrice: 0,
    averagePrice: 0,
    holdingQuantity: 0,
    cashAvailable: null,
    currentRound: strategy.currentRound,
    decision: 'SKIP',
    liveOrderEnabled: settings.liveOrderEnabled,
    reason: `자동매매를 시작했습니다. 서버가 최대 10분 간격으로 현재가, 잔고, 매수가능금액, 미체결 주문을 확인합니다. 실주문 설정: ${settings.liveOrderEnabled ? '켜짐' : '꺼짐'}.`
  });
  return strategy;
}

export function stopStrategy(userId, id) {
  requireStrategy(userId, id);
  return {
    strategy: repo.stopStrategy(userId, id),
    openOrders: repo.listOrders(userId, { strategyId: id }).filter((order) => (
      ['REQUESTED', 'ACCEPTED', 'PARTIALLY_FILLED', 'UNKNOWN'].includes(order.status)
    ))
  };
}

export async function evaluateStrategy(userId, id, { scheduled = false } = {}) {
  const evaluationSource = scheduled ? 'SCHEDULED' : 'MANUAL';
  const strategy = requireStrategy(userId, id);
  const lockedUntil = new Date(Date.now() + 2 * 60 * 1000).toISOString();
  if (!repo.acquireLock(userId, id, LOCK_KEY, lockedUntil)) {
    return saveSkip(userId, strategy, '이미 평가가 진행 중입니다.', evaluationSource);
  }
  try {
    if (scheduled && !isMarketSessionOpen(strategy.market)) {
      return saveSkip(userId, strategy, '장 운영 시간이 아니거나 운영 시간 판단이 불확실해 주문하지 않습니다.', evaluationSource);
    }
    return await evaluateUnlocked(userId, strategy, evaluationSource);
  } finally {
    repo.releaseLock(id, LOCK_KEY);
  }
}

async function evaluateUnlocked(userId, strategy, evaluationSource = 'SCHEDULED') {
  const settings = repo.getSettings(userId);
  const trading = new KisTradingService(userId);
  const tradeDate = today();
  let contextReady = false;
  try {
    await getValidAccessToken(userId);
    contextReady = true;
    const price = await trading.getCurrentPrice(strategy.symbol, { market: strategy.market, exchange: strategy.exchange });
    const [balance, buyingPower, openOrdersInitial] = await Promise.all([
      trading.getBalance(strategy.symbol, { market: strategy.market, currency: strategy.currency, exchange: strategy.exchange }),
      trading.getBuyingPower(strategy.symbol, {
        market: strategy.market,
        currency: strategy.currency,
        exchange: strategy.exchange,
        price: price.price
      }),
      trading.getOpenOrders(strategy.symbol, { market: strategy.market, currency: strategy.currency, exchange: strategy.exchange })
    ]);

    // 주문 정리: 실주문 모드에서 이전 평가에 우리가 접수한 미체결 주문을 처리한다.
    //  - 오늘 접수한 주문은 건드리지 않는다 (체결 대기 중일 수 있고, 하루 1회 매수와 맞물려
    //    "오늘 낸 주문을 취소하고 재주문도 안 함"이 되는 것을 막는다).
    //  - KIS 미체결 목록에 더 이상 없는 주문은 취소하지 말고 실제 체결 상태로 갱신한다.
    //  - 이전 거래일의 미체결 주문만 실제로 취소한다.
    // 사용자가 KIS HTS/MTS에서 직접 만든 주문은 절대 건드리지 않는다.
    const autoCancelNotes = [];
    let openOrders = openOrdersInitial;
    if (settings.liveOrderEnabled) {
      const ownedOpen = repo.listOpenOwnedOrders(userId, strategy.id);
      let touchedAny = false;
      for (const own of ownedOpen) {
        if (own.createdAt && String(own.createdAt).slice(0, 10) === tradeDate) {
          continue; // 오늘 접수한 주문은 그대로 둔다.
        }
        const cancelTarget = Array.isArray(openOrders)
          ? openOrders.find((row) => row.orderNo === own.kisOrderNo)
          : null;
        if (!cancelTarget) {
          // KIS 미체결 목록에 없음 → 이미 체결됐거나 사라짐. 취소 대신 실제 상태로 갱신.
          try {
            const refreshed = await trading.refreshOrder(own);
            repo.updateOrder(userId, own.id, {
              status: refreshed.status || 'UNKNOWN',
              kisOrderNo: refreshed.orderNo,
              kisOriginalOrderNo: refreshed.originalOrderNo,
              filledQuantity: refreshed.filledQuantity,
              remainingQuantity: refreshed.remainingQuantity,
              averageFilledPrice: refreshed.averageFilledPrice,
              responsePayloadMasked: refreshed.responsePayloadMasked,
              errorMessage: null
            });
            autoCancelNotes.push(`주문 #${own.id} 상태 갱신: ${refreshed.status || 'UNKNOWN'}`);
          } catch (err) {
            autoCancelNotes.push(`주문 #${own.id} 상태 확인 실패: ${err.message || err}`);
          }
          touchedAny = true;
          continue;
        }
        try {
          const result = await trading.cancelOpenOrder({
            ...own,
            remainingQuantity: cancelTarget.remainingQuantity ?? own.remainingQuantity ?? own.quantity
          });
          repo.markOrderCanceled(userId, own.id, {
            reason: '자동매매가 신규 주문 전 자동 취소했습니다.',
            responsePayloadMasked: result?.responsePayloadMasked || null
          });
          autoCancelNotes.push(`주문 #${own.id} (KIS ${own.kisOrderNo}) 자동 취소`);
        } catch (err) {
          autoCancelNotes.push(`주문 #${own.id} 자동 취소 실패: ${err.message || err}`);
        }
        touchedAny = true;
      }
      if (touchedAny) {
        // KIS는 취소가 즉시 반영되지 않을 수 있으므로 미체결 목록을 다시 가져온다.
        try {
          openOrders = await trading.getOpenOrders(strategy.symbol, { market: strategy.market, currency: strategy.currency, exchange: strategy.exchange });
        } catch (_) {
          // 재조회 실패는 무시. 기존 목록을 그대로 SafetyGuard 에 넘긴다.
        }
      }
    }

    const holdingQuantity = Number(balance.quantity || 0);
    const averagePrice = Number(balance.averagePrice || 0);
    const cashAvailable = Number(buyingPower.cashAvailable || balance.cashAvailable || 0);
    // 오늘 이미 접수/체결된 매수 슬롯(FAILED 제외). 같은 슬롯(FIRST/AVG/BIG)은 같은 날 다시 만들지 않는다.
    const executedHalves = repo.getExecutedBuyHalvesToday(userId, strategy.id, tradeDate);
    const decision = evaluateAutoTrading({
      symbol: strategy.symbol,
      market: strategy.market,
      currency: strategy.currency,
      currentPrice: price.price,
      holdingQuantity,
      averagePrice,
      cashAvailable,
      currentRound: strategy.currentRound,
      totalBudget: strategy.totalBudget,
      splitCount: strategy.splitCount,
      targetProfitRate: strategy.targetProfitRate,
      bigBuyPremiumRate: strategy.bigBuyPremiumRate,
      cycleBudget: strategy.cycleBudget,
      executedHalves
    });
    // 스냅샷은 평가 결정 직후에 찍어서 "이 시점에 무슨 결정을 내렸는가"까지 같이 저장한다.
    const snapshot = createSnapshot(userId, strategy, {
      currentPrice: price.price,
      balance,
      cashAvailable,
      decision: decision.decision
    });
    const baseReason = autoCancelNotes.length > 0
      ? `${decision.reason} (주문 정리: ${autoCancelNotes.join(' / ')})`
      : decision.reason;
    const decisionWithContext = {
      ...decision,
      reason: appendEvaluationContext(baseReason, {
        strategy,
        price: price.price,
        holdingQuantity,
        averagePrice,
        cashAvailable,
        liveOrderEnabled: settings.liveOrderEnabled,
        openOrderCount: openOrders.length
      })
    };
    const log = createDecisionLog(userId, strategy, {
      ...decisionWithContext,
      liveOrderEnabled: settings.liveOrderEnabled,
      currentPrice: price.price,
      averagePrice,
      holdingQuantity,
      cashAvailable,
      openOrderCount: openOrders.length,
      evaluationSource
    });
    if (!['BUY', 'SELL'].includes(decisionWithContext.decision)) {
      repo.markStrategyEvaluation(userId, strategy.id, { decision: log.decision, errorMessage: null });
      return { strategy: repo.getStrategy(userId, strategy.id), decision: log, snapshot, order: null };
    }

    const intents = normalizeOrderIntents(decisionWithContext);
    const orders = [];
    let localBuyingPower = { ...buyingPower };
    let localBalance = { ...balance };
    for (const intent of intents) {
      const idempotencyKey = makeIdempotencyKey(strategy, intent.half, tradeDate);
      // 같은 키로 FAILED 아닌 주문이 이미 있으면 = 이미 접수/체결됨 → 중복 주문을 만들지 않는다.
      if (repo.hasNonFailedOrder(idempotencyKey)) continue;
      // 재시도 한도: 같은 키로 실패가 누적되면 그만 시도한다(영구 실패 무한 재시도 방지).
      if (repo.countFailedOrders(idempotencyKey) >= ORDER_RETRY_LIMIT) continue;
      const intentDecision = {
        ...decisionWithContext,
        expectedQuantity: intent.expectedQuantity,
        expectedOrderPrice: intent.orderPrice,
        expectedAmount: intent.expectedAmount,
        reason: `${decisionWithContext.reason} / ${intent.reason || intent.half}`
      };
      const guard = validateOrderSafety({
        userId,
        strategy,
        decision: intentDecision,
        liveOrderEnabled: settings.liveOrderEnabled,
        buyingPower: localBuyingPower,
        balance: localBalance,
        openOrders,
        idempotencyKey,
        tradeDate
      });
      if (!guard.ok) {
        // 안전 검증 미통과는 "지금은 못 함"(미체결 대기 등). 주문 행을 만들지 않고 다음 tick에 다시 본다.
        continue;
      }

      const baseOrder = {
        strategyId: strategy.id,
        symbol: strategy.symbol,
        market: strategy.market,
        currency: strategy.currency,
        exchange: strategy.exchange,
        side: intent.side,
        quantity: intent.expectedQuantity,
        orderPrice: intent.orderPrice,
        estimatedAmount: intent.expectedAmount,
        idempotencyKey,
        decisionReason: intentDecision.reason,
        liveOrderEnabled: settings.liveOrderEnabled,
        half: intent.half,
        decisionLogId: log.id
      };

      if (!settings.liveOrderEnabled) {
        orders.push(repo.createOrder(userId, {
          ...baseOrder,
          status: 'DRY_RUN',
          requestPayloadMasked: maskPayload(baseOrder)
        }));
      } else {
        try {
          const result = intent.side === 'BUY'
            ? await trading.placeBuyOrder(baseOrder)
            : await trading.placeSellOrder(baseOrder);
          orders.push(repo.createOrder(userId, {
            ...baseOrder,
            status: result.status || 'ACCEPTED',
            kisOrderNo: result.orderNo,
            kisOriginalOrderNo: result.originalOrderNo,
            requestPayloadMasked: result.requestPayloadMasked || maskPayload(baseOrder),
            responsePayloadMasked: result.responsePayloadMasked
          }));
          repo.addDailyUsedAmount(userId, strategy.id, {
            tradeDate,
            market: strategy.market,
            currency: strategy.currency,
            amount: intent.expectedAmount
          });
        } catch (error) {
          orders.push(repo.createOrder(userId, {
            ...baseOrder,
            status: 'FAILED',
            requestPayloadMasked: maskPayload(baseOrder),
            responsePayloadMasked: error.safePayload || null,
            errorMessage: error.message || 'KIS 주문 요청에 실패했습니다.'
          }));
        }
      }

      if (intent.side === 'BUY') {
        localBuyingPower = {
          ...localBuyingPower,
          cashAvailable: Math.max(0, Number(localBuyingPower.cashAvailable || 0) - intent.expectedAmount)
        };
      } else if (intent.side === 'SELL') {
        localBalance = {
          ...localBalance,
          quantity: Math.max(0, Number(localBalance.quantity || 0) - intent.expectedQuantity)
        };
      }
    }
    const placedOrder = orders.find((o) => o.status !== 'FAILED') || orders[0] || null;
    if (placedOrder) repo.attachOrderIdToDecisionLog(log.id, placedOrder.id);

    // 회차·사이클을 실제 주문 결과에 맞춰 반영한다.
    const anySuccess = orders.some((order) => order.status !== 'FAILED');
    if (decisionWithContext.decision === 'SELL') {
      if (anySuccess && decision.restartCycle) {
        // 매도 접수 → 사이클 재시작: 회차 0, 다음 사이클 예산을 총자산으로 갱신.
        repo.markStrategyEvaluation(userId, strategy.id, {
          decision: 'SELL', ordered: true, resetCycle: true, cycleBudget: decision.nextCycleBudget
        });
      } else {
        repo.markStrategyEvaluation(userId, strategy.id, { decision: 'SELL', ordered: orders.length > 0 });
      }
    } else if (anySuccess) {
      // 매수 성공 → 회차는 거래일당 한 번만 진행한다(같은 날 두 번째 슬롯 매수는 회차를 올리지 않음).
      const isNewRoundDay = strategy.roundTradeDate !== tradeDate;
      const nextRound = isNewRoundDay
        ? Math.min(strategy.currentRound + 1, strategy.splitCount)
        : strategy.currentRound;
      repo.markStrategyEvaluation(userId, strategy.id, {
        decision: 'BUY', ordered: true, currentRound: nextRound, roundTradeDate: tradeDate
      });
    } else {
      repo.markStrategyEvaluation(userId, strategy.id, { decision: 'BUY', ordered: false });
    }
    return { strategy: repo.getStrategy(userId, strategy.id), decision: { ...log, orderId: placedOrder?.id || null }, snapshot, order: placedOrder, orders };
  } catch (error) {
    const message = contextReady
      ? (error.message || '자동매매 평가에 실패했습니다.')
      : 'KIS access token 발급에 실패했습니다. App Key, App Secret, 계좌 설정을 확인하세요';
    const log = repo.createDecisionLog(userId, {
      strategyId: strategy.id,
      symbol: strategy.symbol,
      market: strategy.market,
      currency: strategy.currency,
      currentPrice: 0,
      averagePrice: 0,
      holdingQuantity: 0,
      cashAvailable: null,
      currentRound: strategy.currentRound,
      decision: 'ERROR',
      liveOrderEnabled: repo.getSettings(userId).liveOrderEnabled,
      reason: message,
      openOrderCount: 0,
      evaluationSource
    });
    repo.markStrategyEvaluation(userId, strategy.id, { decision: 'ERROR', errorMessage: message });
    return { strategy: repo.getStrategy(userId, strategy.id), decision: log, snapshot: null, order: null };
  }
}

export function listOrders(userId, strategyId = null, paging = {}) {
  if (strategyId) requireStrategy(userId, strategyId);
  const { limit, offset } = normalizePaging(paging);
  const items = repo.listOrders(userId, { strategyId, limit, offset });
  const total = repo.countOrders(userId, { strategyId });
  return { items, total, limit, offset };
}

export function getOrder(userId, id) {
  const order = repo.getOrder(userId, id);
  if (!order) throw notFound('주문을 찾을 수 없습니다.');
  return order;
}

export async function refreshOrder(userId, id) {
  const order = getOrder(userId, id);
  if (!order.liveOrderEnabled || order.status === 'DRY_RUN') return order;
  const trading = new KisTradingService(userId);
  const result = await trading.refreshOrder(order);
  return repo.updateOrder(userId, id, {
    status: result.status || 'UNKNOWN',
    kisOrderNo: result.orderNo,
    kisOriginalOrderNo: result.originalOrderNo,
    filledQuantity: result.filledQuantity ?? order.filledQuantity,
    remainingQuantity: result.remainingQuantity ?? order.remainingQuantity,
    averageFilledPrice: result.averageFilledPrice ?? order.averageFilledPrice,
    responsePayloadMasked: result.responsePayloadMasked,
    errorMessage: null
  });
}

export function listDecisionLogs(userId, strategyId, paging = {}) {
  requireStrategy(userId, strategyId);
  const { limit, offset } = normalizePaging(paging);
  const items = repo.listDecisionLogs(userId, strategyId, limit, offset);
  const total = repo.countDecisionLogs(userId, strategyId);
  return { items, total, limit, offset };
}

export function listPositionSnapshots(userId, strategyId) {
  requireStrategy(userId, strategyId);
  return repo.listPositionSnapshots(userId, strategyId);
}

export async function getDashboard(userId) {
  const settings = repo.getSettings(userId);
  const kis = kisCredentialService.getSettings(userId);
  const laorStrategies = repo.listStrategies(userId);
  const krOverview = krRankService.getOverview(userId);
  const usOverview = usRankService.getOverview(userId);
  const laorRecentDecisions = repo.recentDecisionLogs(userId, 20);
  const laorRecentOrders = repo.listOrders(userId, { limit: 20 });
  const laorRecentPositions = repo.latestPositionSnapshots(userId, 20);
  const krRecent = collectRankRecent(userId, krOverview.strategies, krRankService);
  const usRecent = collectRankRecent(userId, usOverview.strategies, usRankService);
  const strategyGroups = [
    buildStrategyGroup('laor', '라오어 무한매수법', laorStrategies, laorRecentDecisions[0], laorRecentOrders[0]),
    buildStrategyGroup('kr-rank', '한국 국장 상승률 랭킹', krOverview.strategies, krRecent.decision, krRecent.order),
    buildStrategyGroup('us-rank', '미국장 상승률 랭킹', usOverview.strategies, usRecent.decision, usRecent.order)
  ];
  const account = await buildDashboardAccount(userId, kis);
  const periodReturns = buildDashboardPeriodReturns(userId, {
    laorStrategies,
    krStrategies: krOverview.strategies,
    usStrategies: usOverview.strategies
  });
  // 전략 종류별 1건만 모으던 기존 방식 대신, 이미 조회한 판단 로그에서 ERROR·SKIP을
  // 모아 최근순으로 보여준다(헤딩이 "목록"을 기대하므로).
  const recentErrors = buildRecentIssues([
    { label: '라오어 무한매수법', items: laorRecentDecisions },
    { label: '한국 국장 상승률 랭킹', items: krRecent.decisions },
    { label: '미국장 상승률 랭킹', items: usRecent.decisions }
  ], 8);

  return {
    kis,
    settings,
    stats: {
      ...repo.dashboardStats(userId),
      runningStrategyCount: strategyGroups.reduce((sum, group) => sum + group.runningCount, 0),
      errorStrategyCount: strategyGroups.reduce((sum, group) => sum + group.errorCount, 0)
    },
    account,
    operationStatus: {
      kisConnected: Boolean(kis.configured),
      accountConfigured: Boolean(kis.accountConfigured),
      liveOrderEnabled: settings.liveOrderEnabled,
      accountLookupStatus: account.lookupStatus,
      marketSessions: getMarketSessionStatus()
    },
    periodReturns,
    strategyGroups,
    strategies: laorStrategies.slice(0, 20),
    krRank: { liveOrderEnabled: krOverview.liveOrderEnabled, strategies: krOverview.strategies },
    usRank: { liveOrderEnabled: usOverview.liveOrderEnabled, strategies: usOverview.strategies },
    recentDecisions: laorRecentDecisions,
    recentOrders: mergeRecentOrders([laorRecentOrders, krRecent.orders, usRecent.orders], 20),
    recentPositions: laorRecentPositions.slice(0, 10),
    recentErrors
  };
}

function collectRankRecent(userId, strategies, service) {
  const orders = [];
  const decisions = [];
  for (const strategy of (strategies || []).slice(0, 8)) {
    try {
      orders.push(...(service.listOrders(userId, strategy.id, { limit: 3, offset: 0 }).items || []).map((item) => ({
        ...item,
        strategyId: strategy.id,
        strategyLabel: strategy.symbolName || strategy.holdingSymbolName || strategy.exchange || ''
      })));
    } catch (_) {}
    try {
      decisions.push(...(service.listDecisionLogs(userId, strategy.id, { limit: 3, offset: 0 }).items || []).map((item) => ({
        ...item,
        strategyId: strategy.id
      })));
    } catch (_) {}
  }
  orders.sort(sortCreatedDesc);
  decisions.sort(sortCreatedDesc);
  return { orders: orders.slice(0, 10), decisions: decisions.slice(0, 10), order: orders[0] || null, decision: decisions[0] || null };
}

function buildDashboardPeriodReturns(userId, { laorStrategies, krStrategies, usStrategies }) {
  const cached = periodReturnsCache.get(userId);
  if (cached && Date.now() - cached.at < PERIOD_RETURNS_CACHE_TTL_MS) {
    return cached.value;
  }
  // 1년 구간까지 매도의 짝(매수)을 찾으려면 과거 매수 이력 전체가 필요하다.
  // 날짜로 잘라내면 cost basis 재구성이 깨지므로 limit만 충분히 크게 둔다.
  const laorRecords = buildLaorRealizedRecords(repo.listOrders(userId, { limit: 50000 }));
  const krRecords = collectRankRealizedRecords(userId, krStrategies, krRankService);
  const usRecords = collectRankRealizedRecords(userId, usStrategies, usRankService);
  const now = Date.now();
  const value = PERIOD_RETURN_DEFS.map((def) => {
    const sinceMs = now - def.days * 24 * 60 * 60 * 1000;
    const strategyTypes = [
      summarizePeriodRecords('laor', '라오어 무한매수법', laorRecords, sinceMs),
      summarizePeriodRecords('kr-rank', '한국 국장 상승률 랭킹', krRecords, sinceMs),
      summarizePeriodRecords('us-rank', '미국장 상승률 랭킹', usRecords, sinceMs)
    ];
    const overall = combinePeriodSummaries(strategyTypes);
    return { key: def.key, label: def.label, strategyTypes, overall };
  });
  periodReturnsCache.set(userId, { at: Date.now(), value });
  return value;
}

export function buildLaorRealizedRecords(orders) {
  const positions = new Map();
  const records = [];
  const sorted = (orders || []).slice().sort((a, b) => (
    parseTime(a.createdAt) - parseTime(b.createdAt) || Number(a.id || 0) - Number(b.id || 0)
  ));
  for (const order of sorted) {
    if (!order || EXCLUDED_REALIZED_ORDER_STATUSES.has(order.status)) continue;
    const quantity = orderQuantity(order);
    const price = orderPrice(order);
    if (quantity <= 0 || price <= 0) continue;
    const key = `${order.strategyId || ''}:${order.market || ''}:${order.currency || ''}:${order.symbol || ''}`;
    const position = positions.get(key) || { quantity: 0, cost: 0 };
    if (order.side === 'BUY') {
      position.quantity += quantity;
      position.cost += quantity * price;
      positions.set(key, position);
      continue;
    }
    if (order.side !== 'SELL') continue;
    if (position.quantity <= 0 || position.cost <= 0) continue;
    const sellQuantity = Math.min(quantity, position.quantity);
    const averageCost = position.cost / position.quantity;
    const baseAmount = averageCost * sellQuantity;
    const profitAmount = price * sellQuantity - baseAmount;
    records.push({
      strategyType: 'laor',
      currency: order.currency || 'KRW',
      occurredAt: order.createdAt,
      occurredMs: parseTime(order.createdAt),
      profitAmount,
      baseAmount,
      tradeCount: 1
    });
    position.quantity = Math.max(0, position.quantity - sellQuantity);
    position.cost = Math.max(0, position.cost - baseAmount);
    positions.set(key, position);
  }
  return records;
}

function collectRankRealizedRecords(userId, strategies, service) {
  const records = [];
  for (const strategy of strategies || []) {
    try {
      const response = service.listRoundTripOrders(userId, strategy.id, { limit: 2000, offset: 0 });
      for (const item of response.items || []) {
        if (!item.sellTime || item.sellPrice == null || item.buyPrice == null) continue;
        // 모의(DRY_RUN)·미거래 상태는 손익에서 제외한다. round-trip 쿼리는 이미
        // FAILED/REJECTED/CANCELED를 거르지만 DRY_RUN은 포함하므로 여기서 한 번 더 막는다.
        if (EXCLUDED_REALIZED_ORDER_STATUSES.has(item.buyStatus) || EXCLUDED_REALIZED_ORDER_STATUSES.has(item.sellStatus)) continue;
        // 한 매도가 여러 매수에 매칭될 때 매도수량을 매수별로 곱하면 중복 집계되므로,
        // 각 매수 lot의 수량(buyQuantity)을 기준으로 그 lot의 실현 손익을 계산한다.
        const quantity = Number(item.buyQuantity || item.sellQuantity || 0);
        const buyPrice = Number(item.buyPrice || 0);
        const sellPrice = Number(item.sellPrice || 0);
        const baseAmount = buyPrice * quantity;
        if (quantity <= 0 || baseAmount <= 0) continue;
        records.push({
          strategyType: 'rank',
          currency: item.currency || strategy.currency || 'KRW',
          occurredAt: item.sellTime,
          occurredMs: parseTime(item.sellTime),
          profitAmount: (sellPrice - buyPrice) * quantity,
          baseAmount,
          tradeCount: 1
        });
      }
    } catch (_) {}
  }
  return records;
}

function summarizePeriodRecords(key, label, records, sinceMs) {
  const byCurrency = summarizeByCurrency((records || []).filter((record) => record.occurredMs >= sinceMs));
  return {
    key,
    label,
    status: Object.keys(byCurrency).length > 0 ? 'available' : 'insufficient',
    byCurrency,
    reason: Object.keys(byCurrency).length > 0 ? '' : '기간 내 매도 완료 기록이 없습니다.'
  };
}

function combinePeriodSummaries(strategyTypes) {
  const records = [];
  for (const summary of strategyTypes || []) {
    for (const value of Object.values(summary.byCurrency || {})) {
      records.push({
        currency: value.currency,
        profitAmount: value.profitAmount,
        baseAmount: value.baseAmount,
        tradeCount: value.tradeCount
      });
    }
  }
  const byCurrency = summarizeByCurrency(records);
  return {
    key: 'overall',
    label: '전체',
    status: Object.keys(byCurrency).length > 0 ? 'available' : 'insufficient',
    byCurrency,
    reason: Object.keys(byCurrency).length > 0 ? '' : '기간 내 매도 완료 기록이 없습니다.'
  };
}

export function summarizeByCurrency(records) {
  const byCurrency = {};
  for (const record of records || []) {
    const currency = record.currency || 'KRW';
    if (!byCurrency[currency]) {
      byCurrency[currency] = { currency, profitAmount: 0, baseAmount: 0, returnRate: 0, tradeCount: 0 };
    }
    byCurrency[currency].profitAmount += Number(record.profitAmount || 0);
    byCurrency[currency].baseAmount += Number(record.baseAmount || 0);
    byCurrency[currency].tradeCount += Number(record.tradeCount || 1);
  }
  for (const value of Object.values(byCurrency)) {
    value.returnRate = value.baseAmount > 0 ? value.profitAmount / value.baseAmount : 0;
    value.status = value.baseAmount > 0 ? 'available' : 'insufficient';
  }
  return byCurrency;
}

function orderQuantity(order) {
  return Number(order.filledQuantity || order.quantity || 0);
}

function orderPrice(order) {
  return Number(order.averageFilledPrice || order.orderPrice || 0);
}

function parseTime(value) {
  if (!value) return 0;
  const raw = String(value).trim();
  const normalized = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/.test(raw)
    ? `${raw.replace(' ', 'T')}Z`
    : raw;
  const ms = new Date(normalized).getTime();
  return Number.isNaN(ms) ? 0 : ms;
}

function buildStrategyGroup(key, label, strategies, recentDecision, recentOrder) {
  const sourceItems = strategies || [];
  const items = sourceItems.slice(0, 10);
  const runningCount = items.filter((strategy) => strategy.status === 'RUNNING').length;
  const errorCount = items.filter((strategy) => strategy.status === 'ERROR' || strategy.lastErrorMessage).length;
  const issueReason = recentDecision?.decision === 'ERROR'
    ? recentDecision.reason
    : recentDecision?.decision === 'SKIP'
      ? recentDecision.reason
      : items.find((strategy) => strategy.lastErrorMessage)?.lastErrorMessage;
  return {
    key,
    label,
    totalCount: sourceItems.length,
    runningCount,
    errorCount,
    status: runningCount > 0 ? 'RUNNING' : errorCount > 0 ? 'ERROR' : items.length > 0 ? 'STOPPED' : 'EMPTY',
    strategies: items.map((strategy) => ({
      id: strategy.id,
      symbol: strategy.symbol || strategy.holdingSymbol || null,
      symbolName: strategy.symbolName || strategy.holdingSymbolName || null,
      market: strategy.market || (key === 'us-rank' ? 'US' : key === 'kr-rank' ? 'KR' : null),
      currency: strategy.currency || (key === 'us-rank' ? 'USD' : key === 'kr-rank' ? 'KRW' : null),
      status: strategy.status,
      lastDecision: strategy.lastDecision || null,
      lastErrorMessage: strategy.lastErrorMessage || null,
      lastEvaluatedAt: strategy.lastEvaluatedAt || null,
      lastOrderAt: strategy.lastOrderAt || null
    })),
    recentDecision: recentDecision ? normalizeRecentDecision(recentDecision) : null,
    recentOrder: recentOrder ? normalizeRecentOrder(recentOrder) : null,
    recentIssue: issueReason ? {
      type: recentDecision?.decision === 'ERROR' ? 'ERROR' : 'SKIP',
      reason: issueReason,
      createdAt: recentDecision?.createdAt || null
    } : null
  };
}

// 대시보드는 로그인 직후 첫 화면이라 진입·새로고침마다 KIS 매수가능금액을 조회한다.
// 짧은 TTL 캐시로 반복 진입 시 KIS 호출(및 rate limit·토큰 부담)을 줄인다.
const ACCOUNT_CACHE_TTL_MS = 30 * 1000;
const dashboardAccountCache = new Map();

async function buildDashboardAccount(userId, kis) {
  if (!kis.configured || !kis.accountConfigured) {
    return {
      lookupStatus: 'not_configured',
      lookupMessage: 'KIS API와 계좌 설정이 필요합니다.',
      byCurrency: { KRW: emptyCurrencyAccount('KRW'), USD: emptyCurrencyAccount('USD') },
      periods: buildInsufficientPeriods(),
      checkedAt: null
    };
  }
  const cached = dashboardAccountCache.get(userId);
  if (cached && Date.now() - cached.at < ACCOUNT_CACHE_TTL_MS) {
    return cached.account;
  }
  const byCurrency = {
    KRW: emptyCurrencyAccount('KRW'),
    USD: emptyCurrencyAccount('USD')
  };
  let account;
  try {
    await getValidAccessToken(userId);
    const trading = new KisTradingService(userId);
    // KR·US 매수가능금액 조회는 서로 독립이라 병렬로 호출해 랜딩 지연을 줄인다.
    const [kr, us] = await Promise.all([
      safeBuyingPower(trading, '005930', { market: 'KR', price: 0 }),
      safeBuyingPower(trading, 'TQQQ', { market: 'US', currency: 'USD', exchange: 'NAS', price: 0 })
    ]);
    if (kr.ok) {
      byCurrency.KRW.buyableCash = availableMetric(Number(kr.value.cashAvailable || 0));
      byCurrency.KRW.lookupStatus = 'ok';
    } else {
      byCurrency.KRW.lookupStatus = 'error';
      byCurrency.KRW.lookupMessage = kr.error;
    }
    if (us.ok) {
      byCurrency.USD.buyableCash = availableMetric(Number(us.value.cashAvailable || 0));
      byCurrency.USD.cashAvailableAfterFx = availableMetric(Number(us.value.cashAvailableAfterFx || 0));
      byCurrency.USD.exchangeRate = Number(us.value.exchangeRate || 0) || null;
      byCurrency.USD.lookupStatus = 'ok';
    } else {
      byCurrency.USD.lookupStatus = 'error';
      byCurrency.USD.lookupMessage = us.error;
    }
    const anyOk = Object.values(byCurrency).some((item) => item.lookupStatus === 'ok');
    account = {
      lookupStatus: anyOk ? 'ok' : 'error',
      lookupMessage: anyOk ? '계좌 조회 완료' : '계좌 조회에 실패했습니다.',
      byCurrency,
      periods: buildInsufficientPeriods(),
      checkedAt: new Date().toISOString()
    };
  } catch (error) {
    account = {
      lookupStatus: 'error',
      lookupMessage: error.message || 'KIS 계좌 조회에 실패했습니다.',
      byCurrency,
      periods: buildInsufficientPeriods(),
      checkedAt: new Date().toISOString()
    };
  }
  dashboardAccountCache.set(userId, { at: Date.now(), account });
  return account;
}

async function safeBuyingPower(trading, symbol, options) {
  try {
    return { ok: true, value: await trading.getBuyingPower(symbol, options) };
  } catch (error) {
    return { ok: false, error: error.message || '조회 실패' };
  }
}

function emptyCurrencyAccount(currency) {
  return {
    currency,
    lookupStatus: 'insufficient',
    buyableCash: insufficientMetric('KIS 매수가능금액 조회가 필요합니다.'),
    cashAvailableAfterFx: insufficientMetric('환전 후 매수가능금액 조회가 필요합니다.'),
    totalEvaluationAmount: insufficientMetric('보유 평가금액은 전략별 화면에서 확인할 수 있습니다.'),
    todayProfitLossAmount: insufficientMetric('당일 손익은 계좌 스냅샷 적재 후 표시됩니다.'),
    todayProfitLossRate: insufficientMetric('당일 손익은 계좌 스냅샷 적재 후 표시됩니다.'),
    exchangeRate: null,
    lookupMessage: ''
  };
}

function availableMetric(value) {
  return { status: 'available', value };
}

function insufficientMetric(reason) {
  return { status: 'insufficient', value: null, reason };
}

function buildInsufficientPeriods() {
  const reason = '기간 손익은 계좌 스냅샷 적재 후 제공됩니다.';
  return [
    { label: '7일', amount: insufficientMetric(reason), rate: insufficientMetric(reason) },
    { label: '30일', amount: insufficientMetric(reason), rate: insufficientMetric(reason) }
  ];
}

// 라오어·한국·미국 판단 로그를 합쳐 ERROR·SKIP만 최근순으로 모은다.
function buildRecentIssues(groups, limit) {
  const issues = [];
  for (const { label, items } of groups) {
    for (const log of (items || [])) {
      if (log.decision !== 'ERROR' && log.decision !== 'SKIP') continue;
      issues.push({
        strategyType: label,
        label,
        type: log.decision === 'ERROR' ? 'ERROR' : 'SKIP',
        reason: log.reason || '',
        createdAt: log.createdAt || null,
        id: log.id ?? null
      });
    }
  }
  return issues.sort(sortCreatedDesc).slice(0, limit);
}

function normalizeRecentDecision(decision) {
  return {
    id: decision.id,
    strategyId: decision.strategyId,
    decision: decision.decision,
    reason: decision.reason,
    symbol: decision.symbol || decision.selectedSymbol || null,
    symbolName: decision.symbolName || decision.selectedSymbolName || null,
    currentPrice: decision.currentPrice ?? null,
    cashAvailable: decision.cashAvailable ?? null,
    createdAt: decision.createdAt
  };
}

function normalizeRecentOrder(order) {
  return {
    id: order.id,
    strategyId: order.strategyId,
    symbol: order.symbol,
    symbolName: order.symbolName || null,
    side: order.side,
    status: order.status,
    quantity: order.quantity,
    orderPrice: order.orderPrice,
    estimatedAmount: order.estimatedAmount,
    currency: order.currency,
    createdAt: order.createdAt,
    errorMessage: order.errorMessage || null
  };
}

function mergeRecentOrders(groups, limit) {
  return groups.flat().filter(Boolean).sort(sortCreatedDesc).slice(0, limit).map(normalizeRecentOrder);
}

function sortCreatedDesc(a, b) {
  return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
}

function getMarketSessionStatus() {
  return {
    KR: marketStatus('Asia/Seoul', 9 * 60, 15 * 60 + 30),
    // 미국 정규장은 09:30~16:00 ET.
    US: marketStatus('America/New_York', 9 * 60 + 30, 16 * 60)
  };
}

function marketStatus(timeZone, openMinutes, closeMinutes) {
  try {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
      timeZone,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).formatToParts(new Date()).map((part) => [part.type, part.value]));
    const weekday = parts.weekday;
    const minutes = Number(parts.hour) * 60 + Number(parts.minute);
    const weekdayOpen = !['Sat', 'Sun'].includes(weekday);
    return {
      status: weekdayOpen && minutes >= openMinutes && minutes < closeMinutes ? 'OPEN' : 'CLOSED',
      checkedAt: new Date().toISOString()
    };
  } catch (_) {
    return { status: 'UNKNOWN', checkedAt: new Date().toISOString() };
  }
}

export async function getAccountSummary(userId, strategyId) {
  // 실주문 모드 여부와 무관하게 사용자가 자동매매 화면에서 KIS 계좌 연결 상태와
  // 잔고/매수가능금액/미체결 주문을 확인할 수 있어야 한다. 실주문 모드가 꺼져 있어도
  // 조회만은 가능하며, 실제 주문은 SafetyGuard에서 별도로 차단된다.
  const settings = repo.getSettings(userId);
  const strategy = requireStrategy(userId, strategyId);
  const trading = new KisTradingService(userId);
  await getValidAccessToken(userId);
  // KIS 초당 거래건수 제한(EGW00201)을 피하기 위해 순차 호출. KisTradingService 내부에서도
  // 호출 간 최소 간격과 backoff 재시도를 적용하지만, 같은 사용자 호출은 직렬화하는 편이 안전하다.
  const price = await trading.getCurrentPrice(strategy.symbol, { market: strategy.market, exchange: strategy.exchange });
  const balance = await trading.getBalance(strategy.symbol, { market: strategy.market, currency: strategy.currency, exchange: strategy.exchange });
  const buyingPower = await trading.getBuyingPower(strategy.symbol, {
    market: strategy.market,
    currency: strategy.currency,
    exchange: strategy.exchange,
    price: price.price
  });
  const openOrders = await trading.getOpenOrders(strategy.symbol, { market: strategy.market, currency: strategy.currency, exchange: strategy.exchange });
  return {
    liveOrderEnabled: settings.liveOrderEnabled,
    symbol: strategy.symbol,
    symbolName: strategy.symbolName,
    market: strategy.market,
    currency: strategy.currency,
    currentPrice: price.price,
    cashAvailable: Number(buyingPower.cashAvailable || balance.cashAvailable || 0),
    cashAvailableAfterFx: Number(buyingPower.cashAvailableAfterFx || 0),
    buyableQuantity: Number(buyingPower.buyableQuantity || 0),
    buyableQuantityAfterFx: Number(buyingPower.buyableQuantityAfterFx || 0),
    exchangeRate: Number(buyingPower.exchangeRate || 0),
    holdingQuantity: Number(balance.quantity || 0),
    averagePrice: Number(balance.averagePrice || 0),
    evaluationAmount: Number(balance.evaluationAmount || 0),
    unrealizedProfit: Number(balance.unrealizedProfit || 0),
    openOrderCount: openOrders.length,
    checkedAt: new Date().toISOString()
  };
}

// 전략을 만들기 전 단계에서 사용자 잔고 기반으로 총 예산을 제안하기 위한 가벼운 조회.
// 전략 ID가 없으므로 시장/심볼만 받아 KIS 잔고·매수가능금액을 표준 형태로 돌려준다.
export async function getBuyingPowerPreview(userId, { market, symbol, exchange }) {
  const normalizedMarket = String(market || 'KR').toUpperCase();
  const safeSymbol = String(symbol || '').trim().toUpperCase() || (normalizedMarket === 'KR' ? '005930' : 'TQQQ');
  await getValidAccessToken(userId);
  const trading = new KisTradingService(userId);
  let price = 0;
  try {
    const current = await trading.getCurrentPrice(safeSymbol, { market: normalizedMarket, exchange });
    price = Number(current.price || 0);
  } catch (_) {
    // 현재가 조회가 실패해도 잔고/매수가능금액은 시도한다. KIS API가 price=0이면 잔고만 돌려준다.
  }
  const buyingPower = await trading.getBuyingPower(safeSymbol, { market: normalizedMarket, exchange, price });
  return {
    market: normalizedMarket,
    symbol: safeSymbol,
    currency: buyingPower.currency,
    cashAvailable: Number(buyingPower.cashAvailable || 0),
    cashAvailableAfterFx: Number(buyingPower.cashAvailableAfterFx || 0),
    buyableQuantity: Number(buyingPower.buyableQuantity || 0),
    buyableQuantityAfterFx: Number(buyingPower.buyableQuantityAfterFx || 0),
    exchangeRate: Number(buyingPower.exchangeRate || 0),
    currentPrice: price,
    checkedAt: new Date().toISOString()
  };
}

export async function evaluateRunningStrategies() {
  const strategies = repo.listRunningStrategies();
  for (const strategy of strategies) {
    try {
      await evaluateStrategy(strategy.userId, strategy.id, { scheduled: true });
    } catch (error) {
      repo.setStrategyError(strategy.userId, strategy.id, error.message || '자동 평가에 실패했습니다.');
    }
  }
}

function createSnapshot(userId, strategy, { currentPrice, balance, cashAvailable, decision }) {
  const quantity = Number(balance.quantity || 0);
  const averagePrice = Number(balance.averagePrice || 0);
  const evaluationAmount = quantity * currentPrice;
  const unrealizedProfit = averagePrice > 0 ? (currentPrice - averagePrice) * quantity : 0;
  const base = averagePrice * quantity;
  return repo.createPositionSnapshot(userId, {
    strategyId: strategy.id,
    symbol: strategy.symbol,
    market: strategy.market,
    currency: strategy.currency,
    quantity,
    averagePrice,
    currentPrice,
    evaluationAmount,
    unrealizedProfit,
    unrealizedProfitRate: base > 0 ? unrealizedProfit / base : 0,
    cashAvailable,
    source: 'KIS',
    decision
  });
}

function createDecisionLog(userId, strategy, input) {
  const avg = Number(input.averagePrice || 0);
  const price = Number(input.currentPrice || 0);
  const targetSellPrice = avg > 0 ? avg * (1 + strategy.targetProfitRate) : null;
  // 음수면 이미 목표가 도달, 양수면 목표가까지 남은 비율 (예: 0.05 = 5% 더 올라야 자동 매도).
  const distanceToTargetRate = targetSellPrice && price > 0
    ? (targetSellPrice - price) / targetSellPrice
    : null;
  return repo.createDecisionLog(userId, {
    strategyId: strategy.id,
    symbol: strategy.symbol,
    market: strategy.market,
    currency: strategy.currency,
    currentPrice: input.currentPrice,
    averagePrice: input.averagePrice,
    holdingQuantity: input.holdingQuantity,
    cashAvailable: input.cashAvailable,
    currentRound: strategy.currentRound,
    decision: input.decision,
    expectedQuantity: input.expectedQuantity,
    expectedOrderPrice: input.expectedOrderPrice,
    expectedAmount: input.expectedAmount,
    liveOrderEnabled: input.liveOrderEnabled,
    reason: input.reason,
    targetSellPrice,
    distanceToTargetRate,
    openOrderCount: input.openOrderCount ?? 0,
    evaluationSource: input.evaluationSource || 'SCHEDULED',
    orderId: input.orderId ?? null
  });
}

function saveSkip(userId, strategy, reason, evaluationSource = 'SCHEDULED') {
  const settings = repo.getSettings(userId);
  const detailedReason = `${reason} 확인값: 현재가 미조회, 보유 수량 미조회, 매수가능금액 미조회, 회차 ${strategy.currentRound}/${strategy.splitCount}, 실주문 ${settings.liveOrderEnabled ? '켜짐' : '꺼짐'}.`;
  const log = repo.createDecisionLog(userId, {
    strategyId: strategy.id,
    symbol: strategy.symbol,
    market: strategy.market,
    currency: strategy.currency,
    currentPrice: 0,
    averagePrice: 0,
    holdingQuantity: 0,
    cashAvailable: null,
    currentRound: strategy.currentRound,
    decision: 'SKIP',
    liveOrderEnabled: settings.liveOrderEnabled,
    reason: detailedReason,
    openOrderCount: 0,
    evaluationSource
  });
  repo.markStrategyEvaluation(userId, strategy.id, { decision: 'SKIP', errorMessage: null });
  return { strategy: repo.getStrategy(userId, strategy.id), decision: log, snapshot: null, order: null };
}

function appendEvaluationContext(reason, {
  strategy,
  price,
  previousClose,
  holdingQuantity,
  averagePrice,
  cashAvailable,
  liveOrderEnabled,
  openOrderCount
}) {
  const detail = [
    `현재가 ${fmt(price)} ${strategy.currency}`,
    previousClose ? `전일종가/기준가 ${fmt(previousClose)} ${strategy.currency}` : null,
    `보유 ${fmtQty(holdingQuantity)}주`,
    `평단 ${fmt(averagePrice)} ${strategy.currency}`,
    `큰수 매수 여유율 +${fmt((strategy.effectiveBigBuyPremiumRate ?? resolveBigBuyPremiumRate({ override: strategy.bigBuyPremiumRate, splitCount: strategy.splitCount })) * 100)}%`,
    `매수가능금액 ${fmt(cashAvailable)} ${strategy.currency}`,
    `회차 ${strategy.currentRound}/${strategy.splitCount}`,
    `미체결 ${openOrderCount || 0}건`,
    `실주문 ${liveOrderEnabled ? '켜짐' : '꺼짐'}`
  ].filter(Boolean).join(', ');
  return `${reason} 확인값: ${detail}.`;
}

function normalizeStrategyInput(input = {}) {
  const symbol = String(input.symbol || input.stockCode || '').trim().toUpperCase();
  if (!symbol) throw badRequest('종목을 선택하세요.');
  const market = normalizeMarket(input.market, symbol);
  const currency = String(input.currency || (market === 'KR' ? 'KRW' : 'USD')).trim().toUpperCase();
  const totalBudget = Number(input.totalBudget);
  if (!Number.isFinite(totalBudget) || totalBudget <= 0) throw badRequest('총 예산은 0보다 커야 합니다.');
  const splitCountRaw = Number(input.splitCount || 40);
  if (!Number.isInteger(splitCountRaw) || splitCountRaw <= 0) throw badRequest('분할 회차는 1 이상의 정수여야 합니다.');
  const referencePrice = Number(input.referencePrice || input.currentPrice || 0);
  if (referencePrice > 0) {
    const maxSplit = Math.max(1, Math.floor(totalBudget / (referencePrice * 2)));
    if (splitCountRaw > maxSplit) {
      throw badRequest(`현재가 ${referencePrice} 기준 최대 ${maxSplit}분할까지 가능합니다. (한 회차의 절반이 1주 가격 이상이어야 합니다.)`);
    }
  }
  const targetProfitRate = Number(input.targetProfitRate ?? 0.1);
  if (!Number.isFinite(targetProfitRate) || targetProfitRate <= 0) throw badRequest('목표 수익률은 0보다 커야 합니다.');
  const bigBuyPremiumRate = input.bigBuyPremiumRate === null || input.bigBuyPremiumRate === undefined || input.bigBuyPremiumRate === ''
    ? null
    : Number(input.bigBuyPremiumRate);
  if (bigBuyPremiumRate !== null && (!Number.isFinite(bigBuyPremiumRate) || bigBuyPremiumRate < 0)) {
    throw badRequest('큰수 매수 여유율은 0 이상이어야 합니다.');
  }
  const buyAmountPerRound = Math.floor(totalBudget / splitCountRaw);
  // 종목 검색에서 고른 거래소 코드. 해외 주문·잔고·미체결 조회에 쓰인다.
  const exchange = String(input.exchange || '').trim().toUpperCase() || null;
  return {
    symbol,
    symbolName: String(input.symbolName || input.stockName || '').trim(),
    market,
    currency,
    exchange,
    totalBudget,
    splitCount: splitCountRaw,
    buyAmountPerRound,
    targetProfitRate,
    bigBuyPremiumRate
  };
}

function requireStrategy(userId, id) {
  const strategy = repo.getStrategy(userId, Number(id));
  if (!strategy) throw notFound('자동매매 전략을 찾을 수 없습니다.');
  return strategy;
}

function normalizeOrderIntents(decision) {
  if (Array.isArray(decision.intents) && decision.intents.length > 0) {
    return decision.intents.map((intent) => ({
      half: intent.half || (decision.decision === 'SELL' ? 'SELL' : 'BUY'),
      side: intent.side || decision.decision,
      orderPrice: Number(intent.orderPrice || decision.expectedOrderPrice),
      expectedQuantity: Number(intent.expectedQuantity || decision.expectedQuantity),
      expectedAmount: Number(intent.expectedAmount || decision.expectedAmount),
      reason: intent.reason || decision.reason
    }));
  }
  return [{
    half: decision.decision === 'SELL' ? 'SELL' : 'FIRST',
    side: decision.decision,
    orderPrice: Number(decision.expectedOrderPrice),
    expectedQuantity: Number(decision.expectedQuantity),
    expectedAmount: Number(decision.expectedAmount),
    reason: decision.reason
  }];
}

function makeIdempotencyKey(strategy, half, tradeDate) {
  // 날짜가 곧 회차다(1 회차 = 1 거래일). 같은 날 같은 슬롯(half)은 하나의 키를 공유한다.
  return [tradeDate.replaceAll('-', ''), strategy.id, half].join('-');
}

function isMarketSessionOpen(market) {
  const now = new Date();
  const kst = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  const day = kst.getDay();
  if (day === 0 || day === 6) return false;
  const minutes = kst.getHours() * 60 + kst.getMinutes();
  if (market === 'KR') return minutes >= 9 * 60 && minutes <= 15 * 60 + 30;
  if (market === 'US') return minutes >= 22 * 60 + 30 || minutes <= 6 * 60;
  return false;
}

function normalizeMarket(value, symbol) {
  const market = String(value || '').trim().toUpperCase();
  if (market === 'KR' || market === 'KOSPI' || market === 'KOSDAQ') return 'KR';
  if (market === 'US') return 'US';
  return /^\d{6}$/.test(symbol) ? 'KR' : 'US';
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function fmt(value) {
  return Number(value || 0).toLocaleString('ko-KR', { maximumFractionDigits: 6 });
}

function fmtQty(value) {
  return Number(value || 0).toLocaleString('ko-KR', { maximumFractionDigits: 6 });
}

function nonNegative(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function badRequest(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function notFound(message) {
  const error = new Error(message);
  error.status = 404;
  return error;
}
