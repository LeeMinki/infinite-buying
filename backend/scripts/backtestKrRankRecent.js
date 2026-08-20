import Database from 'better-sqlite3';
import { env } from '../src/config/env.js';
import { decryptSecret } from '../src/crypto/secretCipher.js';
import {
  aggregateRankingCandidates,
  checkBuyCandidate,
  evaluateFastStopLoss,
  evaluateMidTradeDefense,
  maxFluctuationRateForEntryWindow,
  minFluctuationRateForEntryWindow
} from '../src/services/krRankStrategyEngine.js';

const DB_PATH = process.env.DB_PATH;
const USER_EMAIL = process.env.BACKTEST_USER_EMAIL || 'test3@test.com';
const START_DATE = process.env.BACKTEST_START_DATE || '2026-07-20';
const END_DATE = process.env.BACKTEST_END_DATE || '2026-08-19';
const START_CAPITAL_KRW = Number(process.env.BACKTEST_START_CAPITAL_KRW || 0);
const COMPACT_OUTPUT = String(process.env.BACKTEST_COMPACT || '').toLowerCase() === 'true';
const OBSERVATION_LIMIT = 12;
const CANDIDATE_LIMIT = 5;
const RAW_RANK_LIMIT = 10;
const ENTRY_SLIPPAGE_LIMIT = 0.007;
const HARD_STOP_RATE = 0.05;
const KIS_MIN_INTERVAL_MS = 240;

if (!DB_PATH) throw new Error('DB_PATH is required. Use a read-only production snapshot.');
if (!Number.isFinite(START_CAPITAL_KRW) || START_CAPITAL_KRW <= 0) {
  throw new Error('BACKTEST_START_CAPITAL_KRW must be positive.');
}

const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
db.pragma('query_only = ON');

const user = db.prepare('SELECT id FROM users WHERE email = ?').get(USER_EMAIL);
if (!user) throw new Error(`User not found: ${USER_EMAIL}`);
const strategy = db.prepare(`
  SELECT *
  FROM kr_rank_strategies
  WHERE user_id = ? AND deleted_at IS NULL
  ORDER BY CASE WHEN status = 'RUNNING' THEN 0 ELSE 1 END, id DESC
  LIMIT 1
`).get(user.id);
if (!strategy) throw new Error('KR rank strategy not found.');

const rows = db.prepare(`
  SELECT
    trade_date AS tradeDate,
    entry_window AS entryWindow,
    ranking_snapshot AS rankingSnapshot,
    strftime('%H%M%S', observed_at, '+9 hours') AS observedHms
  FROM kr_rank_observations
  WHERE user_id = ?
    AND strategy_id = ?
    AND trade_date BETWEEN ? AND ?
  ORDER BY trade_date, entry_window, observed_at, id
`).all(user.id, strategy.id, START_DATE, END_DATE);

const groups = groupObservations(rows);
const auth = readSnapshotAuthContext(db, user.id);
const api = createKisApi(auth);
const windowAnalyses = [];

for (const group of groups) {
  const recentSnapshots = group.rows
    .slice(-OBSERVATION_LIMIT)
    .map((row) => parseSnapshot(row.rankingSnapshot))
    .filter((snapshot) => snapshot.length > 0);
  const minFluctuationRate = minFluctuationRateForEntryWindow(group.entryWindow);
  const maxFluctuationRate = maxFluctuationRateForEntryWindow(group.entryWindow);
  const evaluationHms = group.rows.at(-1)?.observedHms || entryStartHms(group.entryWindow);
  const lastStoredRanking = parseSnapshot(group.rows.at(-1)?.rankingSnapshot);
  const storedTopTenFloorRate = Number(lastStoredRanking[RAW_RANK_LIMIT - 1]?.fluctuationRate);
  const universe = buildKnownUniverse(recentSnapshots);
  const horizonHms = addSeconds(evaluationHms, 6 * 60);
  const marketData = new Map();
  const dataErrors = [];
  for (const candidate of universe.values()) {
    try {
      const response = await api.historicalMinutes(candidate.symbol, group.tradeDate, horizonHms);
      marketData.set(candidate.symbol, {
        identity: candidate,
        candles: response.candles,
        previousClose: response.previousClose,
      });
    } catch (error) {
      dataErrors.push({
        symbol: candidate.symbol,
        name: candidate.name,
        reason: `KIS historical minute error: ${safeMessage(error)}`
      });
    }
  }
  const search = simulateFiveMinuteSearch({
    entryWindow: group.entryWindow,
    evaluationHms,
    recentSnapshots,
    lastStoredRanking,
    storedTopTenFloorRate,
    marketData,
    minFluctuationRate,
    maxFluctuationRate
  });
  windowAnalyses.push({
    tradeDate: group.tradeDate,
    entryWindow: group.entryWindow,
    evaluationHms,
    snapshotCount: group.rows.length,
    recentSnapshotCount: recentSnapshots.length,
    searchTicks: search.searchTicks,
    stableCandidates: search.stableCandidates.map(candidateSummary),
    accepted: search.accepted ? [search.accepted] : [],
    rejected: [...dataErrors, ...search.rejected],
    terminalReason: search.terminalReason
  });
}

const symbolsToLoad = new Map();
for (const window of windowAnalyses) {
  for (const candidate of window.accepted) {
    const key = `${window.tradeDate}:${candidate.symbol}:${window.entryWindow}`;
    symbolsToLoad.set(key, { window, candidate });
  }
}

for (const { window, candidate } of symbolsToLoad.values()) {
  const liquidateTime = window.entryWindow === 'LUNCH'
    ? strategy.lunch_liquidate_time
    : strategy.morning_liquidate_time;
  candidate.dayCandles = await loadDayCandles(
    api,
    candidate.symbol,
    window.tradeDate,
    window.evaluationHms,
    hhmmToHms(liquidateTime || '15:20')
  );
}

const scenarios = [
  runScenario(windowAnalyses, strategy, {
    name: 'quote_fill_gross',
    startCapital: START_CAPITAL_KRW,
    entryBufferRate: 0,
    perSideCostRate: 0,
    ambiguousPolicy: 'STOP',
    stopFillPolicy: 'THRESHOLD'
  }),
  runScenario(windowAnalyses, strategy, {
    name: 'quote_fill_after_cost',
    startCapital: START_CAPITAL_KRW,
    entryBufferRate: 0,
    perSideCostRate: 0.001,
    ambiguousPolicy: 'STOP',
    stopFillPolicy: 'CLOSE_OR_WORSE'
  }),
  runScenario(windowAnalyses, strategy, {
    name: 'cap_fill_stress_after_cost',
    startCapital: START_CAPITAL_KRW,
    entryBufferRate: 0.004,
    perSideCostRate: 0.001,
    ambiguousPolicy: 'STOP',
    stopFillPolicy: 'CLOSE_OR_WORSE'
  })
];

const result = {
  generatedAt: new Date().toISOString(),
  userEmail: USER_EMAIL,
  userId: user.id,
  strategy: {
    id: strategy.id,
    targetProfitRate: Number(strategy.morning_target_profit_rate),
    configuredStopLossRate: Number(strategy.morning_stop_loss_rate),
    effectiveHardStopRate: HARD_STOP_RATE,
    morningLiquidateTime: strategy.morning_liquidate_time,
    lunchLiquidateTime: strategy.lunch_liquidate_time,
    autoBudgetEnabled: Boolean(strategy.auto_budget_enabled)
  },
  period: { startDate: START_DATE, endDate: END_DATE },
  data: {
    observationRows: rows.length,
    tradingDays: new Set(rows.map((row) => row.tradeDate)).size,
    entryWindows: groups.length,
    windowsWithStableCandidate: windowAnalyses.filter((item) => item.stableCandidates.length > 0).length,
    windowsPassingMinuteAndSlippageFilters: windowAnalyses.filter((item) => item.accepted.length > 0).length,
    kisHistoricalMinuteCalls: api.callCount()
  },
  assumptions: [
    'Stored rankings stop at the first entry evaluation. Later 30-second rankings are reconstructed from KIS minute closes for symbols that appeared in the latest 12 stored top-10 snapshots.',
    'A symbol that never appeared in that known top-10 universe cannot enter the reconstruction. Synthetic ranks must also stay above the last stored market-wide 10th-place fluctuation rate so known symbols are not falsely promoted.',
    'Two 30-second ticks inside one minute share the latest completed one-minute close; intraminute rank and quote changes are unknowable.',
    'Entry uses the stored ranking quote; the stress scenario uses the full +0.4% buy cap.',
    'Minute OHLC cannot reveal ordering inside a minute. A candle touching both target and stop is assigned to STOP.',
    'After-cost scenarios apply 0.10% to each buy and sell notional (about 0.20% round trip).',
    'Starting capital is the current read-only KIS KR buying power supplied by BACKTEST_START_CAPITAL_KRW.'
  ],
  windows: windowAnalyses.map((item) => ({
    tradeDate: item.tradeDate,
    entryWindow: item.entryWindow,
    evaluationHms: item.evaluationHms,
    snapshotCount: item.snapshotCount,
    searchTicks: item.searchTicks,
    stableCandidates: COMPACT_OUTPUT ? item.stableCandidates.map((candidate) => candidate.symbol) : item.stableCandidates,
    acceptedCandidates: COMPACT_OUTPUT ? item.accepted.map((candidate) => candidate.symbol) : item.accepted.map(candidateSummary),
    rejected: COMPACT_OUTPUT ? item.rejected.map((candidate) => ({ symbol: candidate.symbol, reason: candidate.reason })) : item.rejected,
    terminalReason: item.terminalReason
  })),
  scenarios
};

console.log(JSON.stringify(result, null, 2));
db.close();

function readSnapshotAuthContext(database, userId) {
  const credential = database.prepare(`
    SELECT app_key_encrypted, app_secret_encrypted, access_token_encrypted, token_expires_at
    FROM kis_credentials
    WHERE user_id = ?
  `).get(userId);
  if (!credential?.access_token_encrypted || !credential?.token_expires_at) {
    throw new Error('Snapshot has no persisted KIS access token. Refresh it before taking the read-only snapshot.');
  }
  if (Date.parse(credential.token_expires_at) <= Date.now() + 60_000) {
    throw new Error('Snapshot KIS access token is expired or near expiry. Refresh it before taking a new snapshot.');
  }
  return {
    accessToken: decryptSecret(credential.access_token_encrypted),
    appKey: decryptSecret(credential.app_key_encrypted),
    appSecret: decryptSecret(credential.app_secret_encrypted),
    baseUrl: env.kisApiBaseUrl
  };
}

function groupObservations(observations) {
  const grouped = new Map();
  for (const row of observations) {
    const key = `${row.tradeDate}:${row.entryWindow}`;
    if (!grouped.has(key)) {
      grouped.set(key, { tradeDate: row.tradeDate, entryWindow: row.entryWindow, rows: [] });
    }
    grouped.get(key).rows.push(row);
  }
  return [...grouped.values()].sort((a, b) => (
    a.tradeDate.localeCompare(b.tradeDate)
    || windowOrder(a.entryWindow) - windowOrder(b.entryWindow)
  ));
}

function simulateFiveMinuteSearch({
  entryWindow,
  evaluationHms,
  recentSnapshots,
  lastStoredRanking,
  storedTopTenFloorRate,
  marketData,
  minFluctuationRate,
  maxFluctuationRate
}) {
  const rolling = recentSnapshots.slice();
  const rejectedBySymbol = new Map();
  let stableCandidates = [];
  let selected = null;
  let currentHms = evaluationHms;
  let searchTicks = 0;

  // Selection ticks cover [start, start+5m). One extra tick is allowed only to confirm a
  // candidate selected at the final 4m30s checkpoint.
  for (let tick = 0; tick <= 10; tick += 1) {
    const ranking = tick === 0
      ? lastStoredRanking
      : synthesizeRanking(
          marketData,
          currentHms,
          evaluationHms,
          lastStoredRanking,
          storedTopTenFloorRate
        );
    if (tick > 0) rolling.push(ranking);
    if (selected) {
      const confirmation = confirmSelectedCandidate({
        selected,
        ranking,
        currentHms,
        entryWindow,
        marketData,
        minFluctuationRate,
        maxFluctuationRate
      });
      if (!confirmation.ok) {
        return {
          accepted: null,
          stableCandidates,
          rejected: [...rejectedBySymbol.values(), {
            symbol: selected.symbol,
            name: selected.name,
            reason: `confirmation failed: ${confirmation.reason}`
          }],
          terminalReason: confirmation.reason,
          searchTicks
        };
      }
      return {
        accepted: {
          ...confirmation.candidate,
          selectedHms: selected.selectedHms,
          confirmationHms: currentHms,
          dayCandles: marketData.get(selected.symbol)?.candles || []
        },
        stableCandidates,
        rejected: [...rejectedBySymbol.values()],
        terminalReason: 'confirmed',
        searchTicks
      };
    }

    if (tick >= 10) break;
    searchTicks += 1;
    stableCandidates = aggregateRankingCandidates(rolling.slice(-OBSERVATION_LIMIT), {
      minFluctuationRate,
      maxFluctuationRate,
      candidateLimit: CANDIDATE_LIMIT,
      perSnapshotCandidateLimit: RAW_RANK_LIMIT
    });
    const evaluated = evaluateEntryCandidates({
      candidates: stableCandidates,
      ranking,
      currentHms,
      entryWindow,
      marketData
    });
    for (const rejection of evaluated.rejected) rejectedBySymbol.set(rejection.symbol, rejection);
    if (evaluated.accepted.length > 0) {
      selected = { ...evaluated.accepted[0], selectedHms: currentHms };
    }
    currentHms = addSeconds(currentHms, 30);
  }

  return {
    accepted: null,
    stableCandidates,
    rejected: [...rejectedBySymbol.values()],
    terminalReason: 'no candidate passed during reconstructed 5-minute search',
    searchTicks
  };
}

function evaluateEntryCandidates({ candidates, ranking, currentHms, entryWindow, marketData }) {
  const accepted = [];
  const rejected = [];
  for (const candidate of candidates) {
    const data = marketData.get(candidate.symbol);
    const currentRow = ranking.find((row) => row.symbol === candidate.symbol);
    if (!data || !currentRow) {
      rejected.push({ symbol: candidate.symbol, name: candidate.name, reason: 'historical price/rank unavailable' });
      continue;
    }
    const completed = completedLiveWindow(data.candles, currentHms);
    const check = checkBuyCandidate(completed, {
      candidate: { ...candidate, ...currentRow },
      entryWindow,
      useCompletedCandles: false
    });
    if (!check.ok) {
      rejected.push({ symbol: candidate.symbol, name: candidate.name, reason: check.reason });
      continue;
    }
    const currentPrice = Number(currentRow.price) || 0;
    const referencePrice = Number(check.referencePrice) || 0;
    const priceMoveRate = referencePrice > 0 ? (currentPrice - referencePrice) / referencePrice : Infinity;
    if (referencePrice <= 0 || Math.abs(priceMoveRate) > ENTRY_SLIPPAGE_LIMIT) {
      rejected.push({
        symbol: candidate.symbol,
        name: candidate.name,
        reason: `signal/current price gap ${(priceMoveRate * 100).toFixed(2)}%`
      });
      continue;
    }
    accepted.push({
      ...candidate,
      price: currentPrice,
      currentPrice,
      fluctuationRate: Number(currentRow.fluctuationRate),
      referencePrice,
      previousClose: data.previousClose,
      filterScore: Number(check.score || 0),
      totalScore: Number(check.score || 0) + Number(candidate.observationScore || 0)
    });
  }
  accepted.sort((a, b) => b.totalScore - a.totalScore);
  return { accepted, rejected };
}

function confirmSelectedCandidate({
  selected,
  ranking,
  currentHms,
  entryWindow,
  marketData,
  minFluctuationRate,
  maxFluctuationRate
}) {
  const currentRow = ranking
    .slice(0, RAW_RANK_LIMIT)
    .find((row) => (
      row.symbol === selected.symbol
      && Number(row.fluctuationRate) >= minFluctuationRate
      && Number(row.fluctuationRate) < maxFluctuationRate
    ));
  if (!currentRow) return { ok: false, reason: 'selected symbol left reconstructed top-10 or fluctuation band' };
  const data = marketData.get(selected.symbol);
  if (!data) return { ok: false, reason: 'historical price unavailable' };
  const completed = completedLiveWindow(data.candles, currentHms);
  const check = checkBuyCandidate(completed, {
    candidate: currentRow,
    entryWindow,
    useCompletedCandles: false
  });
  if (!check.ok) return { ok: false, reason: check.reason };
  const currentPrice = Number(currentRow.price) || 0;
  const referencePrice = Number(check.referencePrice) || 0;
  if (currentPrice < Number(selected.currentPrice) * (1 - ENTRY_SLIPPAGE_LIMIT)) {
    return { ok: false, reason: 'price fell more than 0.7% from selection' };
  }
  if (referencePrice <= 0 || currentPrice > referencePrice * (1 + ENTRY_SLIPPAGE_LIMIT)) {
    return { ok: false, reason: 'price rose more than 0.7% above latest signal close' };
  }
  if (currentPrice < referencePrice * (1 - ENTRY_SLIPPAGE_LIMIT)) {
    return { ok: false, reason: 'price fell more than 0.7% below latest signal close' };
  }
  return {
    ok: true,
    candidate: {
      ...selected,
      price: currentPrice,
      currentPrice,
      fluctuationRate: Number(currentRow.fluctuationRate),
      referencePrice,
      previousClose: data.previousClose,
      filterScore: Number(check.score || 0),
      totalScore: Number(check.score || 0) + Number(selected.observationScore || 0)
    }
  };
}

function buildKnownUniverse(snapshots) {
  const universe = new Map();
  for (const snapshot of snapshots) {
    for (const row of snapshot.slice(0, RAW_RANK_LIMIT)) {
      if (!row?.symbol) continue;
      universe.set(row.symbol, { ...universe.get(row.symbol), ...row });
    }
  }
  return universe;
}

function synthesizeRanking(marketData, currentHms, baseHms, lastStoredRanking, storedTopTenFloorRate) {
  const storedBySymbol = new Map(lastStoredRanking.map((row) => [row.symbol, row]));
  const sameMinuteAsStored = String(currentHms).slice(0, 4) === String(baseHms).slice(0, 4);
  const rows = [];
  for (const [symbol, data] of marketData.entries()) {
    const stored = storedBySymbol.get(symbol);
    const candle = latestCompletedCandle(data.candles, currentHms);
    const price = sameMinuteAsStored && stored
      ? Number(stored.price)
      : Number(candle?.close || stored?.price || data.identity.price || 0);
    const previousClose = Number(data.previousClose) > 0
      ? Number(data.previousClose)
      : price / (1 + Number(stored?.fluctuationRate || data.identity.fluctuationRate || 0));
    if (price <= 0 || previousClose <= 0) continue;
    rows.push({
      symbol,
      name: data.identity.name || stored?.name || symbol,
      market: 'KR',
      price,
      fluctuationRate: price / previousClose - 1,
      source: 'KIS_HISTORICAL_RECONSTRUCTION'
    });
  }
  const floorRate = Number.isFinite(storedTopTenFloorRate) ? storedTopTenFloorRate : -Infinity;
  return rows
    .filter((row) => row.fluctuationRate >= floorRate)
    .sort((a, b) => b.fluctuationRate - a.fluctuationRate)
    .slice(0, 30);
}

function latestCompletedCandle(candles, nowHms) {
  const minute = String(nowHms).slice(0, 4);
  return candles.filter((candle) => candle.time.slice(0, 4) < minute).at(-1) || null;
}

function runScenario(windows, strategyRow, options) {
  let capital = options.startCapital;
  const trades = [];
  const skipped = [];
  const dailyOpenUntil = new Map();

  for (const window of windows) {
    const entryMinutes = hmsToMinutes(window.evaluationHms) + 0.5;
    const blockedUntil = dailyOpenUntil.get(window.tradeDate) ?? -1;
    if (blockedUntil > entryMinutes) {
      skipped.push({
        tradeDate: window.tradeDate,
        entryWindow: window.entryWindow,
        reason: 'earlier position still open'
      });
      continue;
    }
    if (window.accepted.length === 0) continue;
    const selected = window.accepted.find((candidate) => (
      buyQuantity(capital, candidate.previousClose, candidate.currentPrice) > 0
    ));
    if (!selected) {
      skipped.push({
        tradeDate: window.tradeDate,
        entryWindow: window.entryWindow,
        reason: 'current capital cannot buy one share under upper-limit margin sizing'
      });
      continue;
    }
    const quantity = buyQuantity(capital, selected.previousClose, selected.currentPrice);
    const entryPrice = Math.ceil(selected.currentPrice * (1 + options.entryBufferRate));
    const entryHms = selected.confirmationHms || addSeconds(window.evaluationHms, 30);
    const targetRate = window.entryWindow === 'LUNCH'
      ? Number(strategyRow.lunch_target_profit_rate)
      : Number(strategyRow.morning_target_profit_rate);
    const liquidateTime = window.entryWindow === 'LUNCH'
      ? strategyRow.lunch_liquidate_time
      : strategyRow.morning_liquidate_time;
    const exit = simulateExit(selected.dayCandles || [], {
      entryHms,
      entryPrice,
      targetRate,
      liquidateTime,
      ambiguousPolicy: options.ambiguousPolicy,
      stopFillPolicy: options.stopFillPolicy
    });
    if (!exit) {
      skipped.push({
        tradeDate: window.tradeDate,
        entryWindow: window.entryWindow,
        reason: 'no minute candle available through liquidation'
      });
      continue;
    }
    const buyAmount = quantity * entryPrice;
    const sellAmount = quantity * exit.exitPrice;
    const costs = (buyAmount + sellAmount) * options.perSideCostRate;
    const profit = sellAmount - buyAmount - costs;
    capital += profit;
    dailyOpenUntil.set(window.tradeDate, hmsToMinutes(exit.exitHms));
    trades.push({
      tradeDate: window.tradeDate,
      entryWindow: window.entryWindow,
      symbol: selected.symbol,
      name: selected.name,
      fluctuationRate: selected.fluctuationRate,
      entryHms,
      entryPrice,
      quantity,
      exitHms: exit.exitHms,
      exitPrice: exit.exitPrice,
      exitReason: exit.reason,
      ambiguous: exit.ambiguous,
      grossRate: (exit.exitPrice - entryPrice) / entryPrice,
      netProfit: profit,
      costs,
      capitalAfter: capital
    });
  }

  const wins = trades.filter((trade) => trade.netProfit > 0);
  const losses = trades.filter((trade) => trade.netProfit < 0);
  const grossProfit = wins.reduce((sum, trade) => sum + trade.netProfit, 0);
  const grossLoss = -losses.reduce((sum, trade) => sum + trade.netProfit, 0);
  const totalProfit = trades.reduce((sum, trade) => sum + trade.netProfit, 0);
  const maxDrawdown = computeMaxDrawdown(options.startCapital, trades);
  return {
    name: options.name,
    startCapital: options.startCapital,
    endCapital: capital,
    totalProfit,
    totalReturnRate: totalProfit / options.startCapital,
    tradeCount: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: trades.length ? wins.length / trades.length : 0,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : null,
    maxDrawdownRate: maxDrawdown,
    totalCosts: trades.reduce((sum, trade) => sum + trade.costs, 0),
    exitReasons: countBy(trades, (trade) => trade.exitReason),
    skipped,
    trades
  };
}

function simulateExit(candles, options) {
  const entryMinute = String(options.entryHms).slice(0, 4);
  const afterEntry = candles.filter((candle) => candle.time.slice(0, 4) > entryMinute);
  const targetPrice = options.entryPrice * (1 + options.targetRate);
  const stopPrice = options.entryPrice * (1 - HARD_STOP_RATE);
  const liquidationMinutes = hhmmToMinutes(options.liquidateTime || '15:20');
  const observed = [];

  for (const candle of afterEntry) {
    const minute = hmsToMinutes(candle.time);
    observed.push(candle);
    const targetHit = Number(candle.high) >= targetPrice;
    const stopHit = Number(candle.low) <= stopPrice;
    if (targetHit && stopHit) {
      const chooseStop = options.ambiguousPolicy === 'STOP';
      return chooseStop
        ? stopExit(candle, stopPrice, options.stopFillPolicy, true)
        : { exitHms: candle.time, exitPrice: targetPrice, reason: 'TARGET', ambiguous: true };
    }
    if (targetHit) {
      return { exitHms: candle.time, exitPrice: targetPrice, reason: 'TARGET', ambiguous: false };
    }
    if (stopHit) return stopExit(candle, stopPrice, options.stopFillPolicy, false);

    const holdingMinutes = Math.max(0, minute - hmsToMinutes(options.entryHms));
    const profitRate = (Number(candle.close) - options.entryPrice) / options.entryPrice;
    const liveWindow = observed.slice(-30);
    const fast = evaluateFastStopLoss(liveWindow, {
      profitRate,
      holdingMinutes,
      useCompletedCandles: false
    });
    if (fast.failed) {
      return {
        exitHms: candle.time,
        exitPrice: Number(candle.close),
        reason: 'ENTRY_FAILED',
        ambiguous: false
      };
    }
    const defense = evaluateMidTradeDefense(liveWindow, {
      profitRate,
      holdingMinutes,
      targetOrderAgeMinutes: holdingMinutes,
      useCompletedCandles: false
    });
    if (defense.defensive) {
      return {
        exitHms: candle.time,
        exitPrice: Number(candle.close),
        reason: 'MID_TRADE_DEFENSE',
        ambiguous: false
      };
    }
    if (liquidationMinutes != null && minute >= liquidationMinutes) {
      return {
        exitHms: candle.time,
        exitPrice: Number(candle.close),
        reason: 'TIME_LIQUIDATE',
        ambiguous: false
      };
    }
  }
  return null;
}

function stopExit(candle, stopPrice, policy, ambiguous) {
  const close = Number(candle.close);
  const exitPrice = policy === 'CLOSE_OR_WORSE'
    ? Math.min(stopPrice, close)
    : stopPrice;
  return { exitHms: candle.time, exitPrice, reason: 'STOP_LOSS', ambiguous };
}

async function loadDayCandles(apiClient, symbol, date, entryHms, endHms) {
  const times = [];
  let cursor = hmsToMinutes(entryHms);
  const end = hmsToMinutes(endHms);
  times.push(minutesToHms(cursor));
  while (cursor < end) {
    cursor = Math.min(cursor + 110, end);
    times.push(minutesToHms(cursor));
  }
  const merged = new Map();
  for (const hour of [...new Set(times)]) {
    const response = await apiClient.historicalMinutes(symbol, date, hour);
    for (const candle of response.candles) merged.set(candle.time, candle);
  }
  return [...merged.values()].sort((a, b) => a.time.localeCompare(b.time));
}

function createKisApi(context) {
  let nextAvailableAt = 0;
  let calls = 0;
  const cache = new Map();
  return {
    callCount: () => calls,
    async historicalMinutes(symbol, date, hour) {
      const key = `${symbol}:${date}:${hour}`;
      if (cache.has(key)) return cache.get(key);
      let lastError;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const waitMs = Math.max(0, nextAvailableAt - Date.now());
        if (waitMs > 0) await sleep(waitMs);
        nextAvailableAt = Date.now() + KIS_MIN_INTERVAL_MS;
        calls += 1;
        try {
          const url = new URL(`${context.baseUrl}/uapi/domestic-stock/v1/quotations/inquire-time-dailychartprice`);
          const query = {
            FID_COND_MRKT_DIV_CODE: 'J',
            FID_INPUT_ISCD: symbol,
            FID_INPUT_DATE_1: date.replaceAll('-', ''),
            FID_INPUT_HOUR_1: hour,
            FID_PW_DATA_INCU_YN: 'Y',
            FID_FAKE_TICK_INCU_YN: 'N'
          };
          for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);
          const response = await fetch(url, {
            headers: {
              'Content-Type': 'application/json;charset=UTF-8',
              authorization: `Bearer ${context.accessToken}`,
              appkey: context.appKey,
              appsecret: context.appSecret,
              tr_id: 'FHKST03010230',
              custtype: 'P'
            }
          });
          const data = await response.json().catch(() => ({}));
          if (!response.ok || String(data.rt_cd ?? '0') !== '0') {
            const error = new Error(`${data.msg_cd || response.status} ${data.msg1 || 'KIS error'}`);
            error.transient = response.status === 429 || response.status >= 500 || String(data.msg_cd || '').startsWith('EGW');
            throw error;
          }
          const requestedDate = date.replaceAll('-', '');
          const candles = (Array.isArray(data.output2) ? data.output2 : [])
            .filter((row) => String(row.stck_bsop_date || '') === requestedDate)
            .map(normalizeDomesticCandle)
            .filter(Boolean)
            .sort((a, b) => a.time.localeCompare(b.time));
          const result = {
            candles,
            previousClose: Number(data.output1?.stck_prdy_clpr || 0)
          };
          cache.set(key, result);
          return result;
        } catch (error) {
          lastError = error;
          if (!error.transient || attempt === 2) break;
          await sleep([500, 1000, 2000][attempt]);
        }
      }
      throw lastError || new Error('KIS request failed');
    }
  };
}

function normalizeDomesticCandle(row) {
  if (!row || typeof row !== 'object') return null;
  const time = String(row.stck_cntg_hour || '').padStart(6, '0');
  const candle = {
    time,
    open: Number(row.stck_oprc || 0),
    high: Number(row.stck_hgpr || 0),
    low: Number(row.stck_lwpr || 0),
    close: Number(row.stck_prpr || 0),
    volume: Number(row.cntg_vol || 0)
  };
  if (!/^\d{6}$/.test(time)) return null;
  if (![candle.open, candle.high, candle.low, candle.close].every((value) => Number.isFinite(value) && value > 0)) return null;
  return candle;
}

function completedLiveWindow(candles, nowHms) {
  const minute = String(nowHms).slice(0, 4);
  return candles.filter((candle) => candle.time.slice(0, 4) < minute).slice(-30);
}

function buyQuantity(capital, previousClose, currentPrice) {
  const base = Number(previousClose) > 0 ? Number(previousClose) : Number(currentPrice) / 1.15;
  const marginPrice = base * 1.3;
  return marginPrice > 0 ? Math.floor(capital / marginPrice) : 0;
}

function candidateSummary(candidate) {
  return {
    symbol: candidate.symbol,
    name: candidate.name,
    price: candidate.price ?? candidate.currentPrice,
    fluctuationRate: candidate.fluctuationRate,
    appearances: candidate.observationCount,
    snapshots: candidate.observationSnapshots,
    latestRank: candidate.latestRank,
    observationScore: candidate.observationScore,
    filterScore: candidate.filterScore,
    totalScore: candidate.totalScore
  };
}

function parseSnapshot(value) {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function computeMaxDrawdown(startCapital, trades) {
  let peak = startCapital;
  let maxDrawdown = 0;
  for (const trade of trades) {
    peak = Math.max(peak, trade.capitalAfter);
    if (peak > 0) maxDrawdown = Math.max(maxDrawdown, (peak - trade.capitalAfter) / peak);
  }
  return maxDrawdown;
}

function countBy(items, getKey) {
  return items.reduce((out, item) => {
    const key = getKey(item);
    out[key] = (out[key] || 0) + 1;
    return out;
  }, {});
}

function windowOrder(value) {
  return value === 'MORNING' ? 0 : 1;
}

function entryStartHms(value) {
  return value === 'MORNING' ? '091000' : '113000';
}

function hmsToMinutes(value) {
  const text = String(value || '').replace(':', '').padEnd(6, '0');
  return Number(text.slice(0, 2)) * 60 + Number(text.slice(2, 4)) + Number(text.slice(4, 6)) / 60;
}

function hhmmToMinutes(value) {
  if (!value) return null;
  const [hours, minutes] = String(value).split(':').map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return hours * 60 + minutes;
}

function hhmmToHms(value) {
  return String(value || '').replace(':', '').padEnd(6, '0');
}

function minutesToHms(value) {
  const whole = Math.floor(value);
  const hours = Math.floor(whole / 60);
  const minutes = whole % 60;
  return `${String(hours).padStart(2, '0')}${String(minutes).padStart(2, '0')}00`;
}

function addSeconds(value, seconds) {
  const text = String(value || '').padStart(6, '0');
  const base = Number(text.slice(0, 2)) * 3600 + Number(text.slice(2, 4)) * 60 + Number(text.slice(4, 6));
  const next = Math.min(base + seconds, 23 * 3600 + 59 * 60 + 59);
  const hours = Math.floor(next / 3600);
  const minutes = Math.floor((next % 3600) / 60);
  const secs = next % 60;
  return `${String(hours).padStart(2, '0')}${String(minutes).padStart(2, '0')}${String(secs).padStart(2, '0')}`;
}

function safeMessage(error) {
  return String(error?.message || 'unknown error').replace(/\s+/g, ' ').slice(0, 160);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
