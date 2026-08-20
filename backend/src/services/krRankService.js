import * as repo from '../repositories/krRankRepository.js';
import * as autoTradingRepo from '../repositories/autoTradingRepository.js';
import { env } from '../config/env.js';
import { KisTradingService, findOrderHistoryMatch, maskPayload } from './kisTradingService.js';
import { getValidAccessToken } from './kisTokenManager.js';
import { getDomesticFluctuationRanking, getDomesticTodayMinuteCandles, getDomesticHolidays } from './marketDataService.js';
import {
  ENTRY_WINDOWS,
  aggregateRankingCandidates,
  resolveEntryWindow,
  resolveEntryObservationWindow,
  selectRankingCandidates,
  computeBuyQuantity,
  evaluateFastStopLoss,
  evaluateMidTradeDefense,
  evaluateStopLossDeferral,
  evaluateSell,
  kstNowMinutes,
  parseHhmmMinutes,
  makeKrRankIdempotencyKey,
  checkBuyCandidate,
  minFluctuationRateForEntryWindow,
  maxFluctuationRateForEntryWindow
} from './krRankStrategyEngine.js';

const LOCK_KEY = 'evaluate';
const RANKING_SNAPSHOT_SIZE = 30;
// 매수 필터(분봉 단기 흐름 검사)에서 검사할 상위 후보 개수.
// 상위 후보들을 점수화해 고르되, 너무 크면 KIS 호출이 늘어 rate limit 위험이 있어 제한한다.
const BUY_FILTER_CANDIDATE_LIMIT = 5;
// 상승률 원본 랭킹 상위 10위까지만 전략 후보로 인정한다. 상한/상품 제외 후
// 11위 이하를 backfill하면 실제 하위 종목이 후보로 승격된다.
const RAW_RANK_CANDIDATE_LIMIT = 10;
// 30초 tick 기준 최근 약 6분. pre-window 전체 20여 개를 계속 분모로 쓰면 진입 시각 뒤 새로
// 강해진 종목은 50% 지속성 기준을 구조적으로 통과할 수 없으므로, 최근 흐름만 rolling 평가한다.
const RANKING_OBSERVATION_LIMIT = 12;
// 진입 전 랭킹 관찰 스냅샷 보존 기간(일). 지속성 백테스트용으로 충분히 남기되 무한 증가는 막는다.
const OBSERVATION_RETENTION_DAYS = 30;
// 같은 (날짜·전략·구간·방향) 주문이 실패로 누적되면 더 시도하지 않는 한도.
const ORDER_RETRY_LIMIT = 5;
// 현재가 +0.4% 지정가 BUY가 이 시간 동안 전혀 체결되지 않으면 호가에서 멀어진 것으로 본다.
// KIS 미체결·주문이력·잔고를 확인하고 취소 완료가 확인된 경우에만 최신 신호로 재시도한다.
const BUY_STALE_LIMIT_MS = 90 * 1000;
// 상한가를 조회하지 못했을 때 쓰는 보수적 배수 (가격제한폭 상단 = 전일종가 × 1.3 이하).
const PRICE_LIMIT_MULTIPLIER = 1.3;
// 진입 슬리피지 가드: 분봉 필터가 승인한 신호가(가장 최근 완성봉 종가)보다 실행 시점 실시간 현재가가
// 이 비율 넘게 올라 있으면, 신호가 난 사이 이미 급등한 것으로 보고 추격 매수를 보류한다.
// (거래 마른 봉 직후 시초 급등을 잡던 사고 방지 — 다음 tick에 신호가 안정되면 다시 본다.)
const ENTRY_MAX_SLIPPAGE_RATE = 0.007;
// 실패 주문 재확인 중 신호가보다 이 비율 넘게 하락하면 돌파 모멘텀이 무효화된 것으로 본다.
const ENTRY_MAX_ADVERSE_MOVE_RATE = 0.007;
// 진입 시작 시점 한 번만 보고 하루를 종결하면 일시적인 랭킹/분봉 상태 때문에 거래 기회가
// 사라진다. 다만 50분 진입창 전체를 optional stopping으로 훑지는 않고, 시작 후 5분까지만
// 관찰을 갱신한다. 후보는 아래 확인 시간 안에 다시 검증해야 실제 주문으로 이어진다.
const ENTRY_SELECTION_WINDOW_MINUTES = 5;
// 첫 필터 통과 후보는 다음 tick에서 한 번 더 확인하되, 기술 오류로 오래 끌며 늦게 진입하지 않는다.
const ENTRY_CONFIRMATION_MAX_MINUTES = 3;
// 사용자 요구의 하드 손절 기준은 -5%다. 설정이 더 엄격하면 그 값을 우선하고, -5%에 닿으면
// 구조 신호나 초기 흔들기 유예와 무관하게 즉시 청산을 시작한다. 갭·거래정지는 체결가를 보장하지 않는다.
const HARD_PROTECTIVE_STOP_RATE = 0.05;
// 같은 거래일에 실주문 청산 손실/손익 미확정이 이 횟수 누적되면 그날의 남은 신규 진입만
// 잠근다. 전략은 RUNNING을 유지하며 다음 거래일에는 수동 재시작 없이 자동으로 재개한다.
const DAILY_RISK_EXIT_LIMIT = 2;
// 진입 매수 지정가 버퍼: 시장가 대신 현재가보다 이만큼 위의 지정가로 매수한다. 정상 호가에서는
// 시장가처럼 즉시 체결되면서도, 순간 급등으로 호가가 위로 갭하면 꼭대기를 잡지 않게 막는다.
// (미국 랭킹 전략이 지정가로 매수하는 것과 같은 철학. 호가단위 스냅·올림은 주문 빌더가 처리한다.)
const ENTRY_LIMIT_BUFFER_RATE = 0.004;
// 판단 로그·주문 이력·진입 목록 페이징 기본/최대 페이지 크기.
const PAGE_SIZE_DEFAULT = 50;
const PAGE_SIZE_MAX = 200;
const KIS_CALL_MIN_INTERVAL_MS = 80;
const KIS_RATE_LIMIT_BACKOFF_MS = 1_500;
const KIS_BUYING_POWER_CACHE_TTL_MS = 20_000;

const krKisCallStates = new Map();

function normalizePaging({ limit, offset } = {}) {
  const limitNum = Math.min(Math.max(Math.trunc(Number(limit)) || PAGE_SIZE_DEFAULT, 1), PAGE_SIZE_MAX);
  const offsetNum = Math.max(Math.trunc(Number(offset)) || 0, 0);
  return { limit: limitNum, offset: offsetNum };
}

// ── 전략 CRUD ─────────────────────────────────────────────────────────────

export function createStrategy(userId, input) {
  return repo.createStrategy(userId, normalizeStrategyInput(input));
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
  const strategy = requireStrategy(userId, id);
  const started = repo.startStrategy(userId, id);
  const liveOrderEnabled = resolveLiveOrderEnabled(userId);
  repo.createDecisionLog(userId, {
    strategyId: strategy.id,
    decision: 'SKIP',
    liveOrderEnabled,
    evaluationSource: 'MANUAL',
    reason: `한국 국장 상승률 랭킹 전략을 시작했습니다. 서버가 30초 간격으로 평가하며, 오전 09:10 진입(${strategy.autoBudgetEnabled ? '매수 금액 자동(매수가능금액 전액)' : `매수 금액 ${fmt(strategy.morningBudget)}원`})${strategy.lunchEntryEnabled ? `, 점심 11:30 진입(${strategy.autoBudgetEnabled ? '매수 금액 자동(매수가능금액 전액)' : `매수 금액 ${fmt(strategy.lunchBudget)}원`})` : ''}에 상승률 상위 종목을 매수합니다. 실주문 설정: ${liveOrderEnabled ? '켜짐' : '꺼짐'}.`
  });
  return started;
}

export function stopStrategy(userId, id) {
  requireStrategy(userId, id);
  return repo.stopStrategy(userId, id);
}

export function listOrders(userId, strategyId = null, paging = {}) {
  if (strategyId) requireStrategy(userId, strategyId, { includeDeleted: true });
  const { limit, offset } = normalizePaging(paging);
  const items = repo.listOrders(userId, { strategyId, limit, offset });
  const total = repo.countOrders(userId, { strategyId });
  return { items, total, limit, offset };
}

export function listRoundTripOrders(userId, strategyId, paging = {}) {
  requireStrategy(userId, strategyId, { includeDeleted: true });
  const { limit, offset } = normalizePaging(paging);
  const items = repo.listRoundTripOrders(userId, { strategyId, limit, offset });
  const total = repo.countRoundTripOrders(userId, { strategyId });
  return { items, total, limit, offset };
}

export function listDecisionLogs(userId, strategyId, paging = {}) {
  requireStrategy(userId, strategyId, { includeDeleted: true });
  const { limit, offset } = normalizePaging(paging);
  const items = repo.listDecisionLogs(userId, strategyId, { limit, offset });
  const total = repo.countDecisionLogs(userId, strategyId);
  return { items, total, limit, offset };
}

export function listEntries(userId, strategyId, paging = {}) {
  requireStrategy(userId, strategyId, { includeDeleted: true });
  const { limit, offset } = normalizePaging(paging);
  const items = repo.listEntries(userId, strategyId, { limit, offset });
  const total = repo.countEntries(userId, strategyId);
  return { items, total, limit, offset };
}

// 한국 랭킹 전략 탭 요약: 실주문 설정 + 전략 목록.
export function getOverview(userId) {
  return {
    liveOrderEnabled: resolveLiveOrderEnabled(userId),
    userLiveOrderEnabled: autoTradingRepo.getSettings(userId).liveOrderEnabled,
    globalLiveOrderEnabled: isGlobalLiveOrderEnabled(),
    strategies: repo.listStrategies(userId)
  };
}

// ── 평가 ──────────────────────────────────────────────────────────────────

export async function evaluateStrategy(userId, id, { scheduled = false } = {}) {
  const evaluationSource = scheduled ? 'SCHEDULED' : 'MANUAL';
  const strategy = requireStrategy(userId, id);
  if (strategy.status !== 'RUNNING') {
    return saveSkip(userId, strategy, '전략이 실행 중이 아니라 평가하지 않습니다.', evaluationSource);
  }
  const lockedUntil = new Date(Date.now() + 2 * 60 * 1000).toISOString();
  if (!repo.acquireLock(userId, id, LOCK_KEY, lockedUntil)) {
    return saveSkip(userId, strategy, '이미 평가가 진행 중입니다.', evaluationSource, { noLog: scheduled });
  }
  try {
    if (scheduled && !isKrMarketOpen()) {
      return saveSkip(userId, strategy, '한국 장 운영 시간이 아니라 주문하지 않습니다.', evaluationSource, { noLog: true });
    }
    if (scheduled && !(await isKrTradingDay(userId))) {
      return saveSkip(userId, strategy, '한국 증시 휴장일이라 주문하지 않습니다.', evaluationSource, { noLog: true });
    }
    // 평가 본 흐름에 들어가기 전에 미체결 주문의 실제 체결가를 KIS에서 끌어와 DB에 채운다.
    // 화면 렌더링이 아니라 평가 tick(이미 30초마다 도는 작업)에 끼워, 추가 폴링 없이 갱신한다.
    // 실패해도 평가는 계속 진행한다 — 체결가는 다음 tick에 다시 시도하면 된다.
    try {
      await syncOrderFills(userId, { strategyId: id });
      await syncRealizedProfits(userId, { strategyId: id });
    } catch {
      // 동기화 실패는 평가를 막지 않는다.
    }
    return await evaluateUnlocked(userId, strategy, evaluationSource);
  } finally {
    repo.releaseLock(id, LOCK_KEY);
  }
}

export async function evaluateRunningStrategies() {
  const strategies = repo.listRunningStrategies();
  for (const strategy of strategies) {
    try {
      await evaluateStrategy(strategy.userId, strategy.id, { scheduled: true });
    } catch (error) {
      // 일시적 오류로 전략을 ERROR(영구 정지)로 만들지 않는다. RUNNING을 유지해 다음 tick에 재시도.
      repo.markEvaluation(strategy.userId, strategy.id, {
        decision: 'ERROR',
        errorMessage: error.message || '자동 평가에 실패했습니다.'
      });
    }
  }
}

async function evaluateUnlocked(userId, strategy, evaluationSource) {
  const liveOrderEnabled = resolveLiveOrderEnabled(userId);
  pruneOldObservationsOncePerDay();
  // 진입창 종료 여부와 무관하게 이미 SELECTED/접수된 BUY를 먼저 잔고·매도 상태까지
  // reconcile한다. 이 경로가 손실 gate나 idle 조기 반환보다 뒤에 있으면 늦게 체결된 실포지션이 고아가 된다.
  const pendingEntry = !strategy.holdingSymbol
    ? repo.getPendingEntry(strategy.id, kstToday())
    : null;
  const pendingBuyStarted = pendingEntry
    ? repo.hasStartedBuyForEntry(pendingEntry.id)
    : false;
  // 일일 손실 회로 차단기는 무보유일 때만 적용한다. 보유 중에는 어떤 손실 이력이 있어도
  // 체결 동기화와 청산 평가를 계속해야 포지션이 방치되지 않는다. 이미 시작한 BUY 역시
  // 신규 진입 잠금보다 먼저 끝까지 reconcile한다.
  if (!strategy.holdingSymbol && !pendingBuyStarted) {
    const riskBlocked = applyDailyLossRiskGate(userId, strategy, { liveOrderEnabled, evaluationSource });
    if (riskBlocked) return riskBlocked;
  }
  // 1분 폴링이라 할 일이 없는 tick은 KIS 호출 없이 일찍 끝낸다.
  // 무보유이고 진입 구간이 아니거나, 이미 그 구간 진입을 마쳤으면 바로 종료한다.
  const noLogIfScheduled = evaluationSource !== 'MANUAL';
  if (!strategy.holdingSymbol && !pendingEntry) {
    const observationWindow = resolveEntryObservationWindow(new Date(), { lunchEntryEnabled: strategy.lunchEntryEnabled });
    if (observationWindow) {
      const existing = repo.getEntry(strategy.id, kstToday(), observationWindow);
      if (!existing?.bought && !['NO_CANDIDATE', 'SKIPPED'].includes(existing?.status)) {
        const ranking = await getDomesticFluctuationRanking(userId);
        const rankingSnapshot = (ranking || []).slice(0, RANKING_SNAPSHOT_SIZE);
        repo.createObservation(userId, {
          strategyId: strategy.id,
          tradeDate: kstToday(),
          entryWindow: observationWindow,
          rankingSnapshot
        });
        return saveDecision(userId, strategy, {
          decision: 'SKIP',
          entryWindow: observationWindow,
          liveOrderEnabled,
          evaluationSource,
          rankingSnapshot,
          reason: `${ENTRY_WINDOWS[observationWindow].label} 진입 전 관찰: ${ENTRY_WINDOWS[observationWindow].startMinutes === 9 * 60 + 10 ? '09:10' : '11:30'} 매수 판단을 위해 상승률 랭킹 스냅샷을 저장했습니다.`,
          noLog: noLogIfScheduled
        });
      }
    }
    const window = resolveEntryWindow(new Date(), { lunchEntryEnabled: strategy.lunchEntryEnabled });
    if (!window) {
      return saveDecision(userId, strategy, {
        decision: 'SKIP', liveOrderEnabled, evaluationSource,
        reason: '지금은 오전·점심 진입 구간이 아니라 매수 평가를 하지 않습니다.',
        noLog: noLogIfScheduled
      });
    }
    // 진입 기록이 종결 상태(매수 완료 / 관찰시간 종료)면 KIS 호출 없이 끝낸다.
    // SELECTED는 종목이 정해졌거나 무효 후보를 비우고 재관찰 중인 상태이므로 계속 진행한다.
    const existing = repo.getEntry(strategy.id, kstToday(), window);
    if (existing && (existing.bought || ['NO_CANDIDATE', 'SKIPPED'].includes(existing.status))) {
      const minutesAfterWindowStart = kstNowMinutes() - ENTRY_WINDOWS[window].startMinutes;
      const shouldCollectShadowRanking = existing.status === 'NO_CANDIDATE'
        && !env.krRankLiveEntryRetryEnabled
        && minutesAfterWindowStart >= 0
        && minutesAfterWindowStart < ENTRY_SELECTION_WINDOW_MINUTES;
      if (shouldCollectShadowRanking) {
        const ranking = await getDomesticFluctuationRanking(userId);
        const rankingSnapshot = (ranking || []).slice(0, RANKING_SNAPSHOT_SIZE);
        repo.createObservation(userId, {
          strategyId: strategy.id,
          tradeDate: kstToday(),
          entryWindow: window,
          rankingSnapshot
        });
        return saveDecision(userId, strategy, {
          decision: 'SKIP', entryWindow: window, liveOrderEnabled, evaluationSource,
          rankingSnapshot,
          reason: `${ENTRY_WINDOWS[window].label} 신규 규칙은 수익성 검증 전이라 실주문 재탐색을 잠그고 실제 랭킹만 shadow로 저장했습니다.`,
          noLog: noLogIfScheduled
        });
      }
      return saveDecision(userId, strategy, {
        decision: 'SKIP', entryWindow: window, liveOrderEnabled, evaluationSource,
        reason: existing.bought
          ? `오늘 ${ENTRY_WINDOWS[window].label} 진입 매수를 마쳤습니다.`
          : `오늘 ${ENTRY_WINDOWS[window].label} 진입: 매수 대상이 없어 매수하지 않았습니다.`,
        noLog: noLogIfScheduled
      });
    }
  }
  const trading = new KisTradingService(userId);
  let contextReady = false;
  try {
    await getValidAccessToken(userId);
    contextReady = true;
    if (strategy.holdingSymbol) {
      return await evaluateSellPath(userId, strategy, { trading, liveOrderEnabled, evaluationSource });
    }
    return await evaluateEntryPath(userId, strategy, {
      trading, liveOrderEnabled, evaluationSource, pendingEntry
    });
  } catch (error) {
    const message = contextReady
      ? (error.message || '한국 랭킹 전략 평가에 실패했습니다.')
      : 'KIS access token 발급에 실패했습니다. App Key, App Secret, 계좌 설정을 확인하세요.';
    const log = repo.createDecisionLog(userId, {
      strategyId: strategy.id,
      decision: 'ERROR',
      liveOrderEnabled,
      evaluationSource,
      reason: message
    });
    // 일시적 KIS 오류로 전략을 ERROR(영구 정지)시키지 않는다. RUNNING을 유지해 다음 tick에 재시도.
    repo.markEvaluation(userId, strategy.id, { decision: 'ERROR', errorMessage: message });
    return { strategy: repo.getStrategy(userId, strategy.id), decision: log, order: null };
  }
}

function applyDailyLossRiskGate(userId, strategy, { liveOrderEnabled, evaluationSource }) {
  const tradeDate = kstToday();
  // started_at을 경계로 쓰지 않는다. 같은 날 stop→start로 일일 한도를 우회하지 못하게 하고,
  // 날짜가 바뀌면 과거 연속 손실과 무관하게 자동 재개한다.
  const risk = repo.getLiveLossRiskState(strategy.id, { tradeDate });
  if (risk.riskExitsToday < DAILY_RISK_EXIT_LIMIT) return null;

  const entryWindow = resolveEntryObservationWindow(new Date(), { lunchEntryEnabled: strategy.lunchEntryEnabled })
    || resolveEntryWindow(new Date(), { lunchEntryEnabled: strategy.lunchEntryEnabled });
  if (!entryWindow) return null;

  let entry = repo.getEntry(strategy.id, tradeDate, entryWindow);
  let stateChanged = false;
  if (!entry) {
    entry = repo.createEntry(userId, {
      strategyId: strategy.id,
      tradeDate,
      entryWindow,
      status: 'SKIPPED',
      rankingSnapshot: null,
      bought: false
    });
    stateChanged = Boolean(entry);
  } else if (entry.status === 'SELECTED' && !entry.bought) {
    // 아직 주문을 시작하지 않은 후보는 당일 한도에 걸린 순간 종결한다. SELECTED로 남겨 두면
    // 위험 집계가 뒤늦게 바뀌었을 때 같은 후보가 주문 경로로 되살아날 수 있다.
    entry = repo.finalizeEntryWithoutCandidate(entry.id, { status: 'SKIPPED' });
    stateChanged = true;
  }
  return saveDecision(userId, strategy, {
    decision: 'SKIP', entryWindow, liveOrderEnabled, evaluationSource,
    reason: `일일 손실 회로 차단기: 오늘 실주문 손실 ${risk.lossExitsToday}회${risk.unresolvedExitsToday > 0 ? `, 손익 확인 대기 ${risk.unresolvedExitsToday}회` : ''}가 누적되어 ${ENTRY_WINDOWS[entryWindow].label} 신규 진입을 건너뜁니다. 전략은 계속 실행되며 다음 거래일에 자동 재개합니다. 기존 보유분의 체결 확인과 청산 관리도 계속합니다.`,
    noLog: evaluationSource !== 'MANUAL' && !stateChanged
  });
}

// 보유 종목이 있을 때: 목표 수익/손절 매도 판단.
async function evaluateSellPath(userId, strategy, { trading, liveOrderEnabled, evaluationSource }) {
  const symbol = strategy.holdingSymbol;
  const entryWindow = strategy.holdingEntryWindow || 'MORNING';
  const price = await limitedKisCall(userId, `kr-current-price:${symbol}`, () => (
    trading.getCurrentPrice(symbol, { market: 'KR' })
  ));
  const balance = await limitedKisCall(userId, `kr-balance:${symbol}`, () => (
    trading.getBalance(symbol, { market: 'KR', currency: 'KRW' })
  ));
  const accountHoldingQuantity = Math.floor(Number(balance.quantity || 0));
  const accountAveragePrice = Number(balance.averagePrice || 0);
  const currentPrice = Number(price.price || 0);
  let activeSellOrder = repo.getActiveSellOrder({
    strategyId: strategy.id,
    entryWindow,
    symbol
  });
  let activeTargetOrder = activeSellOrder?.sellReason === 'TARGET'
    ? activeSellOrder
    : repo.getActiveSellOrder({
        strategyId: strategy.id,
        entryWindow,
        symbol,
        sellReason: 'TARGET'
      });
  const positionEntry = (activeSellOrder?.entryId || activeTargetOrder?.entryId)
    ? repo.getEntryById(activeSellOrder?.entryId || activeTargetOrder?.entryId)
    : repo.getLatestBoughtEntry(strategy.id, entryWindow, symbol);
  const positionBuyOrder = repo.getLatestBuyOrder({
    strategyId: strategy.id,
    entryWindow,
    symbol,
    entryId: positionEntry?.id ?? activeSellOrder?.entryId ?? activeTargetOrder?.entryId ?? null
  });
  // 포지션의 실주문/기록모드 provenance는 현재 사용자 토글이 아니라 실제 BUY 주문이 기준이다.
  // 사용자 토글 OFF는 이미 live로 산 포지션의 청산을 막지 않지만, 전역 스위치는 모든 KIS 쓰기를 막는다.
  const positionWasLive = positionBuyOrder?.liveOrderEnabled
    ?? activeSellOrder?.liveOrderEnabled
    ?? activeTargetOrder?.liveOrderEnabled
    ?? liveOrderEnabled;
  const globalLiveOrderEnabled = isGlobalLiveOrderEnabled();
  liveOrderEnabled = Boolean(positionWasLive && globalLiveOrderEnabled);
  let holdingQuantity = accountHoldingQuantity;
  let averagePrice = accountAveragePrice;

  if (positionWasLive) {
    const confirmedBuyQuantity = getConfirmedOrderFilledQuantity(positionBuyOrder);
    if (confirmedBuyQuantity <= 0) {
      // 계좌 잔고는 수동 보유분이나 다른 전략의 수량일 수 있다. 이 전략의 BUY 체결 수량을
      // 주문 이력으로 입증하지 못하면 잔고 전체를 포지션으로 채택하거나 매도하지 않는다.
      return saveDecision(userId, strategy, {
        decision: 'SKIP', entryWindow,
        selectedSymbol: symbol, selectedSymbolName: strategy.holdingSymbolName,
        currentPrice, averagePrice, holdingQuantity: accountHoldingQuantity,
        liveOrderEnabled, evaluationSource, orderId: activeSellOrder?.id,
        reason: `보유 종목 ${symbol}의 전략 매수 체결 수량을 확인할 수 없어 계좌 잔고를 자동 매도하지 않습니다. KIS 주문 이력과 계좌를 직접 확인하세요.`
      });
    }
    const managedRemainingQuantity = getKrManagedRemainingQuantity(positionBuyOrder, positionEntry?.id);
    averagePrice = Number(positionBuyOrder.averageFilledPrice || positionBuyOrder.orderPrice || accountAveragePrice || 0);
    if (managedRemainingQuantity <= 0) {
      // 전략 주문으로 산 수량은 모두 매도된 반면 같은 종목의 외부 보유분이 계좌에 남아 있을 수
      // 있다. 외부 잔고는 건드리지 않고 이 전략의 holding만 해제한다.
      repo.clearHolding(userId, strategy.id);
      return saveDecision(userId, strategy, {
        decision: 'SKIP', entryWindow,
        selectedSymbol: symbol, selectedSymbolName: strategy.holdingSymbolName,
        currentPrice, averagePrice, holdingQuantity: 0,
        liveOrderEnabled, evaluationSource, orderId: activeSellOrder?.id,
        reason: `${symbol} 전략 매수 수량의 청산이 모두 확인되어 전략 보유 상태를 해제했습니다. 계좌에 남은 동일 종목 ${accountHoldingQuantity}주는 이 전략이 매수한 수량이 아니므로 건드리지 않습니다.`
      });
    }
    holdingQuantity = Math.min(accountHoldingQuantity, managedRemainingQuantity);
  }

  if (holdingQuantity <= 0) {
    // 살아 있는 실매도 주문이 있는데 잔고만 0이면 접수를 체결로 추정하지 않는다. sync가 일시
    // 실패했을 수 있으므로 주문 이력을 한 번 더 확인하고, FILLED 증거가 없으면 holding을 유지한다.
    if (positionWasLive && activeSellOrder) {
      const refreshed = await tryRefreshKrOrderState(userId, trading, activeSellOrder);
      if (refreshed?.status !== 'FILLED') {
        return saveDecision(userId, strategy, {
          decision: 'SKIP',
          entryWindow,
          selectedSymbol: symbol,
          selectedSymbolName: strategy.holdingSymbolName,
          currentPrice,
          averagePrice,
          holdingQuantity,
          liveOrderEnabled,
          evaluationSource,
          orderId: refreshed?.id || activeSellOrder.id,
          reason: `보유 종목 ${symbol}의 잔고는 0이지만 매도 주문 체결이 확정되지 않아 보유 상태 해제를 보류합니다. 다음 평가에서 KIS 주문 이력을 다시 확인합니다.`
        });
      }
      activeSellOrder = refreshed;
    }
    const filledSellOrder = activeSellOrder?.status === 'FILLED'
      ? activeSellOrder
      : repo.getLatestFilledSellOrder({
          strategyId: strategy.id,
          entryWindow,
          symbol,
          entryId: positionEntry?.id ?? null
        });
    // 활성 주문이 없으면 외부 매도일 수 있고, FILLED 매도가 있으면 체결이 확인된 것이다.
    // 어느 경우든 실제 잔고가 0이므로 holding을 해제하되, 활성 주문은 위에서 반드시 종결 확인했다.
    repo.clearHolding(userId, strategy.id);
    return saveDecision(userId, strategy, {
      decision: 'SKIP',
      entryWindow,
      selectedSymbol: symbol,
      selectedSymbolName: strategy.holdingSymbolName,
      currentPrice,
      averagePrice,
      holdingQuantity,
      liveOrderEnabled,
      evaluationSource,
      orderId: filledSellOrder?.id,
      reason: filledSellOrder
        ? `보유 종목 ${symbol}의 매도 체결과 잔고 0을 확인해 보유 상태를 해제했습니다.`
        : `보유 종목 ${symbol}의 활성 매도 주문이 없고 실제 잔고 수량이 0이라 외부 청산으로 보고 보유 상태를 해제했습니다.`
    });
  }

  const isLunch = entryWindow === 'LUNCH';
  const targetProfitRate = isLunch ? strategy.lunchTargetProfitRate : strategy.morningTargetProfitRate;
  const configuredStopLossRate = isLunch ? strategy.lunchStopLossRate : strategy.morningStopLossRate;
  const stopLossRate = Math.min(Number(configuredStopLossRate) || HARD_PROTECTIVE_STOP_RATE, HARD_PROTECTIVE_STOP_RATE);
  const liquidateTime = isLunch ? strategy.lunchLiquidateTime : strategy.morningLiquidateTime;
  let sell = evaluateSell({
    currentPrice, averagePrice, targetProfitRate, stopLossRate,
    liquidateTime, nowMinutes: kstNowMinutes()
  });
  let entryFailureReason = null;
  let defensiveExitReason = null;
  // filledAt은 KIS 실제 체결시각이 아니라 우리 sync 발견 시각일 수 있다. 늦게 동기화된
  // 오래된 포지션을 갓 체결로 오인해 손절을 유예하지 않도록 주문 생성시각을 보수적 하한으로 쓴다.
  const holdingStartedAt = positionBuyOrder?.createdAt
    || positionBuyOrder?.filledAt
    || positionEntry?.createdAt
    || activeTargetOrder?.createdAt;
  const holdingMinutes = minutesSinceSqliteTimestamp(holdingStartedAt);
  const targetOrderAgeMinutes = minutesSinceSqliteTimestamp(activeTargetOrder?.createdAt);
  const hardProtectiveStopTriggered = sell.sellReason === 'STOP_LOSS'
    && sell.profitRate <= -HARD_PROTECTIVE_STOP_RATE;
  if (sell.decision === 'SELL' && sell.sellReason === 'STOP_LOSS' && !hardProtectiveStopTriggered) {
    try {
      const candles = await getDomesticTodayMinuteCandles(userId, symbol);
      const profitRate = averagePrice > 0 ? (currentPrice - averagePrice) / averagePrice : 0;
      const deferral = evaluateStopLossDeferral(candles, {
        profitRate,
        stopLossRate,
        holdingMinutes,
        useCompletedCandles: true
      });
      if (deferral.defer) {
        const profitPct = (profitRate * 100).toFixed(2);
        return saveDecision(userId, strategy, {
          decision: 'HOLD',
          entryWindow,
          selectedSymbol: symbol,
          selectedSymbolName: strategy.holdingSymbolName,
          currentPrice,
          averagePrice,
          holdingQuantity,
          liveOrderEnabled,
          evaluationSource,
          reason: `${symbol} 손절 기준에 닿았지만(수익률 ${profitPct}%) ${deferral.reason} 목표가 주문은 유지하고 다음 평가에서 다시 확인합니다.`
        });
      }
    } catch {
      // 분봉 확인 실패는 기존 고정 손절 판단에 맡긴다.
    }
  }
  if (sell.decision === 'HOLD') {
    try {
      const candles = await getDomesticTodayMinuteCandles(userId, symbol);
      const profitRate = averagePrice > 0 ? (currentPrice - averagePrice) / averagePrice : 0;
      // 라이브는 진행 중(미완성) 분봉의 일시적 아래꼬리에 반응하지 않도록 완성봉만 본다.
      const failure = evaluateFastStopLoss(candles, { profitRate, holdingMinutes, useCompletedCandles: true });
      if (failure.failed) {
        entryFailureReason = failure.reason;
        sell = {
          decision: 'SELL',
          sellReason: 'ENTRY_FAILED',
          profitRate: averagePrice > 0 ? (currentPrice - averagePrice) / averagePrice : 0
        };
      } else {
        const defense = evaluateMidTradeDefense(candles, {
          profitRate,
          holdingMinutes,
          targetOrderAgeMinutes,
          useCompletedCandles: true
        });
        if (defense.defensive) {
          defensiveExitReason = defense.reason;
          sell = {
            decision: 'SELL',
            sellReason: 'STOP_LOSS',
            profitRate
          };
        }
      }
    } catch {
      // 분봉 확인 실패는 기존 목표/손절 판단에 맡긴다.
    }
  }
  const profitPct = (sell.profitRate * 100).toFixed(2);
  const reasonLabel = sell.sellReason === 'TARGET'
    ? '목표 수익 도달'
      : sell.sellReason === 'STOP_LOSS'
      ? (hardProtectiveStopTriggered
          ? `하드 방어 손절(-${(HARD_PROTECTIVE_STOP_RATE * 100).toFixed(1)}%)`
          : (defensiveExitReason ? `중기 방어 손절 (${defensiveExitReason})` : '손절 기준 도달'))
      : sell.sellReason === 'ENTRY_FAILED'
        ? `빠른 손절${entryFailureReason ? ` (${entryFailureReason})` : ''}`
        : `청산 시각 도달 (${liquidateTime} KST)`;

  if (sell.decision === 'HOLD') {
    let targetProtectionNote = '';
    // 청산 판단이 없는 tick에만 누락된 목표가 주문을 복구한다. 이미 손절/시간청산 조건이면
    // 목표가를 새로 냈다가 곧바로 취소하는 cancel-fill 경합을 만들지 않는다.
    if (!activeSellOrder && !activeTargetOrder && positionBuyOrder) {
      if (positionWasLive && !globalLiveOrderEnabled) {
        targetProtectionNote = ' 전역 실주문 중지 상태라 새 목표가 주문은 만들지 않았습니다.';
      } else {
        await ensureKrTargetSellOrder(userId, trading, {
          ...positionBuyOrder,
          filledQuantity: positionWasLive ? holdingQuantity : positionBuyOrder.filledQuantity,
          averageFilledPrice: positionWasLive ? averagePrice : positionBuyOrder.averageFilledPrice
        });
        activeTargetOrder = repo.getActiveSellOrder({
          strategyId: strategy.id,
          entryWindow,
          symbol,
          sellReason: 'TARGET'
        });
        activeSellOrder = activeTargetOrder;
        targetProtectionNote = activeTargetOrder
          ? ' 누락된 목표가 지정가 주문을 복구했습니다.'
          : ' 목표가 주문을 만들지 못해 다음 평가에서 다시 확인합니다.';
      }
    }
    const liquidateNote = liquidateTime ? `, 청산 시각 ${liquidateTime} KST 미도달` : '';
    const blockedEntryNote = describeBlockedEntryWindow(strategy, entryWindow, symbol);
    return saveDecision(userId, strategy, {
      decision: 'HOLD',
      entryWindow,
      selectedSymbol: symbol,
      selectedSymbolName: strategy.holdingSymbolName,
      currentPrice,
      averagePrice,
      holdingQuantity,
      liveOrderEnabled,
      evaluationSource,
      reason: `${symbol} 보유 중 (수익률 ${profitPct}%). ${ENTRY_WINDOWS[entryWindow].label} 진입 기준 목표 수익률 ${(targetProfitRate * 100).toFixed(1)}% / 설정 손절 -${(Number(configuredStopLossRate) * 100).toFixed(1)}% / 하드 방어 -${(HARD_PROTECTIVE_STOP_RATE * 100).toFixed(1)}% 미도달${liquidateNote}이라 보유를 유지합니다.${targetProtectionNote}${blockedEntryNote}`
    });
  }

  if (positionWasLive && !globalLiveOrderEnabled) {
    return saveDecision(userId, strategy, {
      decision: 'SKIP',
      entryWindow,
      sellReason: sell.sellReason,
      selectedSymbol: symbol,
      selectedSymbolName: strategy.holdingSymbolName,
      currentPrice,
      averagePrice,
      holdingQuantity,
      liveOrderEnabled: false,
      evaluationSource,
      orderId: activeSellOrder?.id,
      reason: `${symbol} ${reasonLabel}(수익률 ${profitPct}%) 조건이지만 전역 실주문 중지 상태라 KIS 주문·취소를 보내지 않았습니다. 기존 보유와 주문 상태를 유지합니다.`
    });
  }

  // SELL — 전량 매도.
  if (activeTargetOrder) {
    if (sell.sellReason === 'TARGET') {
      if (!activeTargetOrder.liveOrderEnabled || activeTargetOrder.status === 'DECIDED' || activeTargetOrder.status === 'DRY_RUN') {
        const filled = repo.updateOrder(userId, activeTargetOrder.id, {
          status: 'FILLED',
          filledQuantity: holdingQuantity,
          remainingQuantity: 0,
          averageFilledPrice: currentPrice
        });
        repo.clearHolding(userId, strategy.id);
        return saveDecision(userId, strategy, {
          decision: 'SELL', entryWindow, sellReason: 'TARGET',
          selectedSymbol: symbol, selectedSymbolName: strategy.holdingSymbolName,
          currentPrice, averagePrice, holdingQuantity,
          expectedQuantity: holdingQuantity, expectedPrice: currentPrice,
          expectedAmount: holdingQuantity * currentPrice,
          liveOrderEnabled, evaluationSource, orderId: filled.id,
          reason: `${symbol} 목표 수익 도달 전량 매도 (수익률 ${profitPct}%). 실주문 실행 설정이 꺼져 있어 기록으로 체결 처리했습니다.`
        });
      }
      return saveDecision(userId, strategy, {
        decision: 'SKIP', entryWindow, sellReason: 'TARGET',
        selectedSymbol: symbol, selectedSymbolName: strategy.holdingSymbolName,
        currentPrice, averagePrice, holdingQuantity, liveOrderEnabled, evaluationSource,
        orderId: activeTargetOrder.id,
        reason: `${symbol} 목표 수익 조건입니다. 이미 걸어 둔 목표가 주문의 체결을 기다립니다.`
      });
    }
  }
  const idempotencyKey = makeKrRankIdempotencyKey({
    tradeDate: kstToday(), strategyId: strategy.id, entryWindow, side: 'SELL'
  });
  // 같은 매도가 이미 접수돼 있으면 체결을 기다린다(다음 tick에 잔고 0으로 확인되면 보유 해제).
  if (repo.hasNonFailedOrder(idempotencyKey)) {
    return saveDecision(userId, strategy, {
      decision: 'SKIP', entryWindow,
      selectedSymbol: symbol, selectedSymbolName: strategy.holdingSymbolName,
      currentPrice, averagePrice, holdingQuantity, liveOrderEnabled, evaluationSource,
      reason: `${symbol} 매도 주문이 이미 접수돼 있어 체결을 기다립니다.`
    });
  }
  // 매도가 한도만큼 실패하면 더 시도하지 않는다(영구 실패 무한 재시도 방지).
  if (repo.countFailedOrders(idempotencyKey) >= ORDER_RETRY_LIMIT) {
    return saveDecision(userId, strategy, {
      decision: 'SKIP', entryWindow,
      selectedSymbol: symbol, selectedSymbolName: strategy.holdingSymbolName,
      currentPrice, averagePrice, holdingQuantity, liveOrderEnabled, evaluationSource,
      reason: `${symbol} 매도가 ${ORDER_RETRY_LIMIT}회 실패해 더 시도하지 않습니다. 계좌를 직접 확인하세요.`
    });
  }
  let sellQuantity = holdingQuantity;
  const allOpenOrders = liveOrderEnabled ? await safeOpenOrders(userId, trading, symbol) : [];
  // 방어 매도를 위해 취소할 현재 TARGET 주문 자체는 중복 주문으로 보지 않는다.
  // 단, 조회 실패(null)는 그대로 유지하고 다른 미체결 주문은 남겨 안전 검사가 막도록 한다.
  const openOrders = excludeKnownTargetOrder(allOpenOrders, activeTargetOrder);
  let guard = checkOrderSafety({
    side: 'SELL', quantity: sellQuantity, openOrders, idempotencyKey, holdingQuantity: sellQuantity
  });

  if (!guard.ok) {
    // 안전 검증 미통과 = "지금은 못 함". 주문 행을 만들지 않고 다음 tick에 다시 매도를 시도한다.
    return saveDecision(userId, strategy, {
      decision: 'SKIP', entryWindow,
      selectedSymbol: symbol, selectedSymbolName: strategy.holdingSymbolName,
      currentPrice, averagePrice, holdingQuantity, liveOrderEnabled, evaluationSource,
      reason: `${symbol} ${reasonLabel}(수익률 ${profitPct}%)이나 ${guard.reason} 다음 평가에서 다시 시도합니다.`
    });
  }

  // 멱등성·실패 한도·미체결 조회를 포함한 모든 사전 안전 검사가 통과한 뒤에만
  // 기존 TARGET을 취소한다. 검사 실패 후 TARGET마저 사라져 포지션이 무방비가 되는 경우를 막는다.
  if (activeTargetOrder) {
    const cancelResult = await cancelKrOrderAndConfirm(userId, trading, activeTargetOrder);
    if (!cancelResult.ok) {
      return saveDecision(userId, strategy, {
        decision: 'SKIP', entryWindow, sellReason: sell.sellReason,
        selectedSymbol: symbol, selectedSymbolName: strategy.holdingSymbolName,
        currentPrice, averagePrice, holdingQuantity, liveOrderEnabled, evaluationSource,
        orderId: activeTargetOrder.id,
        reason: `${symbol} ${reasonLabel}(수익률 ${profitPct}%)이나 기존 목표가 주문 취소가 확인되지 않아 새 매도 주문을 만들지 않습니다. ${cancelResult.reason}`
      });
    }
    // 취소-체결 경합 뒤에는 취소 전 수량을 재사용하지 않는다. 잔고와 미체결을 다시 읽어
    // 실제 남은 수량만 매도하고, 그 사이 목표가가 전량 체결됐으면 새 주문을 만들지 않는다.
    const refreshedBalance = await limitedKisCall(userId, `kr-balance-after-cancel:${symbol}`, () => (
      trading.getBalance(symbol, { market: 'KR', currency: 'KRW' })
    ));
    const refreshedAccountQuantity = Math.floor(Number(refreshedBalance.quantity || 0));
    sellQuantity = positionWasLive
      ? Math.min(
          refreshedAccountQuantity,
          getKrManagedRemainingQuantity(positionBuyOrder, positionEntry?.id)
        )
      : refreshedAccountQuantity;
    if (sellQuantity <= 0) {
      repo.clearHolding(userId, strategy.id);
      return saveDecision(userId, strategy, {
        decision: 'SKIP', entryWindow, sellReason: sell.sellReason,
        selectedSymbol: symbol, selectedSymbolName: strategy.holdingSymbolName,
        currentPrice, averagePrice, holdingQuantity: 0, liveOrderEnabled, evaluationSource,
        orderId: cancelResult.order?.id || activeTargetOrder.id,
        reason: `${symbol} 목표가 주문 취소 확인 뒤 잔고가 0이라 새 매도 주문 없이 보유 상태를 해제했습니다.`
      });
    }
    const refreshedOpenOrders = await safeOpenOrders(userId, trading, symbol);
    guard = checkOrderSafety({
      side: 'SELL', quantity: sellQuantity, openOrders: refreshedOpenOrders,
      idempotencyKey, holdingQuantity: sellQuantity
    });
    if (!guard.ok) {
      return saveDecision(userId, strategy, {
        decision: 'SKIP', entryWindow, sellReason: sell.sellReason,
        selectedSymbol: symbol, selectedSymbolName: strategy.holdingSymbolName,
        currentPrice, averagePrice, holdingQuantity: sellQuantity,
        liveOrderEnabled, evaluationSource,
        reason: `${symbol} 목표가 주문 취소 후 ${guard.reason} 새 매도 주문을 만들지 않고 다음 평가에서 다시 확인합니다.`
      });
    }
  }

  const baseOrder = {
    strategyId: strategy.id,
    entryId: activeTargetOrder?.entryId ?? positionEntry?.id ?? findCurrentEntryId(strategy, entryWindow, symbol),
    symbol,
    symbolName: strategy.holdingSymbolName,
    side: 'SELL',
    entryWindow,
    sellReason: sell.sellReason,
    quantity: sellQuantity,
    orderPrice: currentPrice,
    estimatedAmount: sellQuantity * currentPrice,
    idempotencyKey,
    liveOrderEnabled
  };

  const order = await placeOrder(userId, trading, baseOrder, {
    liveOrderEnabled,
    decisionReason: `${symbol} ${reasonLabel} 전량 매도 (수익률 ${profitPct}%).`
  });
  // 보유 해제는 여기서 하지 않는다. 접수(ACCEPTED)는 체결이 아니므로, 다음 tick에 KIS 잔고가
  // 0으로 확인될 때(위 holdingQuantity<=0 분기) 해제한다 — 미체결 매도로 포지션을 잃지 않도록.
  return saveDecision(userId, strategy, {
    decision: 'SELL', entryWindow, sellReason: sell.sellReason,
    selectedSymbol: symbol, selectedSymbolName: strategy.holdingSymbolName,
    currentPrice, averagePrice, holdingQuantity: sellQuantity,
    expectedQuantity: sellQuantity, expectedPrice: currentPrice,
    expectedAmount: baseOrder.estimatedAmount,
    liveOrderEnabled, evaluationSource, orderId: order.id,
    reason: `${symbol} ${reasonLabel} 전량 매도 (수익률 ${profitPct}%). ${orderStatusNote(order, liveOrderEnabled)}`
  });
}

// 무보유일 때: 진입 구간에서 종목을 골라 현재가 근처 지정가로 매수한다.
// 진입 기록이 없거나 선택 종목이 비어 있으면 5분 한도 안에서 최신 관찰을 누적해 다시 판정한다.
// 후보가 있으면 SELECTED로 저장하고 다음 tick 재검증까지 통과한 뒤 주문한다.
async function evaluateEntryPath(userId, strategy, {
  trading, liveOrderEnabled, evaluationSource, pendingEntry = null
}) {
  const entryWindow = pendingEntry?.entryWindow
    || resolveEntryWindow(new Date(), { lunchEntryEnabled: strategy.lunchEntryEnabled });
  if (!entryWindow) {
    return saveDecision(userId, strategy, {
      decision: 'SKIP', liveOrderEnabled, evaluationSource,
      reason: '지금은 오전·점심 진입 구간이 아니라 매수 평가를 하지 않습니다.'
    });
  }
  const tradeDate = pendingEntry?.tradeDate || kstToday();
  const label = ENTRY_WINDOWS[entryWindow].label;

  // 진입 기록: 종결 상태면 종료한다. SELECTED이면서 종목이 비어 있으면 이전 후보가
  // 무효화된 뒤 제한된 관찰 시간 안에서 새 후보를 찾는 상태다.
  let entry = pendingEntry || repo.getEntry(strategy.id, tradeDate, entryWindow);
  let rankingSnapshot = entry ? entry.rankingSnapshot : null;
  if (entry?.bought || ['NO_CANDIDATE', 'SKIPPED'].includes(entry?.status)) {
    return saveDecision(userId, strategy, {
      decision: 'SKIP', entryWindow, liveOrderEnabled, evaluationSource,
      reason: entry?.bought
        ? `오늘 ${label} 진입 매수를 마쳤습니다.`
        : `오늘 ${label} 진입은 매수 없이 종결됐습니다.`,
      noLog: evaluationSource !== 'MANUAL'
    });
  }
  // 매수 대상이 아직 없으면 제한된 관찰 시간 동안 랭킹과 분봉을 다시 판정한다. 매 tick마다
  // 아무 종목이나 고르는 것이 아니라 누적 observation 지속성 필터를 통과해야 SELECTED가 된다.
  if (!entry?.selectedSymbol) {
    const minutesAfterWindowStart = kstNowMinutes() - ENTRY_WINDOWS[entryWindow].startMinutes;
    if (minutesAfterWindowStart >= ENTRY_SELECTION_WINDOW_MINUTES) {
      if (entry) {
        repo.finalizeEntryWithoutCandidate(entry.id, { status: 'NO_CANDIDATE', rankingSnapshot });
      } else {
        repo.createEntry(userId, {
          strategyId: strategy.id, tradeDate, entryWindow,
          status: 'NO_CANDIDATE', rankingSnapshot: null, bought: false
        });
      }
      return saveDecision(userId, strategy, {
        decision: 'SKIP', entryWindow, liveOrderEnabled, evaluationSource,
        reason: `${label} 진입: 시작 후 ${ENTRY_SELECTION_WINDOW_MINUTES}분 동안 안정적으로 확인된 후보가 없어 늦은 추격 매수를 막고 이 구간을 종료합니다.`
      });
    }
    // 랭킹 조회 실패는 전략 거절과 구분한다. 진입 기록을 만들지 않아 다음 tick에서 기술 오류만 재시도한다.
    const ranking = await getDomesticFluctuationRanking(userId);
    rankingSnapshot = (ranking || []).slice(0, RANKING_SNAPSHOT_SIZE);
    repo.createObservation(userId, {
      strategyId: strategy.id,
      tradeDate,
      entryWindow,
      rankingSnapshot
    });
    const observations = repo.listObservations(strategy.id, tradeDate, entryWindow, { limit: RANKING_OBSERVATION_LIMIT });
    const observationSnapshots = observations.map((row) => row.rankingSnapshot).filter(Boolean);
    // 구간별 실전 손익에서 상대적으로 유리했던 등락률 밴드의 후보를 사전 관찰
    // 스냅샷과 현재 랭킹으로 종합한 뒤,
    // 매수 필터(분봉 단기 흐름·거래대금)와 점수로 한 번 더 거른다.
    const minFluctuationRate = minFluctuationRateForEntryWindow(entryWindow);
    const maxFluctuationRate = maxFluctuationRateForEntryWindow(entryWindow);
    const candidates = aggregateRankingCandidates(observationSnapshots, {
      minFluctuationRate,
      maxFluctuationRate,
      candidateLimit: BUY_FILTER_CANDIDATE_LIMIT
    });
    const filterResult = await pickFirstFilteredCandidate(userId, candidates, { trading, strategy, entryWindow });
    const picked = filterResult.picked;
    let preparedBuyPlan = filterResult.buyPlan || null;

    if (!picked) {
      // 한 번의 빈 랭킹이나 KIS 분봉/매수가능금액 오류로 구간 전체를 끝내지 않는다. 관찰 스냅샷을
      // 누적하고 정해진 5분 안에서만 다시 본다. 지속성 필터가 optional stopping을 제어한다.
      const fluctuationBand = minFluctuationRate > 0
        ? `${(minFluctuationRate * 100).toFixed(0)}% 이상 ${(maxFluctuationRate * 100).toFixed(0)}% 미만`
        : `${(maxFluctuationRate * 100).toFixed(0)}% 미만`;
      const reason = candidates.length === 0
        ? `${label} 진입 관찰 중: 원본 랭킹 상위 ${RAW_RANK_CANDIDATE_LIMIT}위 안에서 등락률 ${fluctuationBand}이고 지속적으로 확인된 매수 대상이 아직 없습니다. 제한 시간 안에 다시 평가합니다.`
        : `${label} 진입 관찰 중: 관찰 랭킹 종합 후보 ${candidates.length}개가 현재 단기 흐름·거래대금·매수가능금액 검사에서 모두 제외됐습니다. 제한 시간 안에 다시 평가합니다. ${filterResult.rejections.map((r) => {
            const nameLabel = r.name ? `${r.name}(${r.symbol})` : r.symbol;
            return `${nameLabel}: ${r.reason}`;
          }).join(' / ')}`;
      // time-split validation에서 rolling 재탐색 변형이 모두 PF<1이었다. live 사용자는 첫 판단을
      // 종결해 신규 규칙이 실제 돈으로 실행되지 않게 하고, 다음 tick부터 위 shadow 경로로
      // 실제 market-wide 랭킹만 계속 저장한다. DRY_RUN은 테스트·관찰을 위해 5분 평가를 유지한다.
      if (liveOrderEnabled && !env.krRankLiveEntryRetryEnabled) {
        if (entry) {
          repo.finalizeEntryWithoutCandidate(entry.id, { status: 'NO_CANDIDATE', rankingSnapshot });
        } else {
          repo.createEntry(userId, {
            strategyId: strategy.id, tradeDate, entryWindow,
            status: 'NO_CANDIDATE', rankingSnapshot, bought: false
          });
        }
        return saveDecision(userId, strategy, {
          decision: 'SKIP', entryWindow, liveOrderEnabled, evaluationSource, rankingSnapshot,
          reason: `${label} 진입: 검증 전 신규 규칙의 실주문 재탐색은 잠그고 이후 5분 실제 랭킹만 shadow로 저장합니다.`
        });
      }
      return saveDecision(userId, strategy, {
        decision: 'SKIP', entryWindow, liveOrderEnabled, evaluationSource, rankingSnapshot, reason,
        noLog: evaluationSource !== 'MANUAL'
      });
    }

    entry = entry
      ? repo.updateEntrySelection(entry.id, {
          selectedSymbol: picked.symbol, selectedSymbolName: picked.name,
          selectedPrice: picked.price, selectedFluctuationRate: picked.fluctuationRate,
          rankingSnapshot
        })
      : repo.createEntry(userId, {
          strategyId: strategy.id, tradeDate, entryWindow,
          status: 'SELECTED',
          selectedSymbol: picked.symbol, selectedSymbolName: picked.name,
          selectedPrice: picked.price, selectedFluctuationRate: picked.fluctuationRate,
          rankingSnapshot, bought: false
        });
    if (!entry) {
      return saveDecision(userId, strategy, {
        decision: 'SKIP', entryWindow, liveOrderEnabled, evaluationSource, rankingSnapshot,
        reason: `${label} 진입이 이미 기록되어 있어 중복 진입을 막았습니다.`
      });
    }
    return saveDecision(userId, strategy, {
      decision: 'SKIP', entryWindow,
      selectedSymbol: picked.symbol, selectedSymbolName: picked.name,
      currentPrice: preparedBuyPlan?.currentPrice,
      cashAvailable: preparedBuyPlan?.cashAvailable,
      rankingSnapshot, liveOrderEnabled, evaluationSource,
      reason: `${label} 진입: ${picked.symbol} 후보를 선택했습니다. 단 한 번의 순간 통과로 주문하지 않고 다음 평가에서 최신 랭킹·분봉·가격을 다시 확인합니다.`
    });
  }

  // 여기서부터 entry는 종목이 정해진 SELECTED 상태다. 매수(또는 재시도)를 진행한다.
  let symbol = entry.selectedSymbol;
  let symbolName = entry.selectedSymbolName;
  const idempotencyKey = makeKrRankIdempotencyKey({ tradeDate, strategyId: strategy.id, entryWindow, side: 'BUY' });

  if (repo.hasNonFailedOrder(idempotencyKey)) {
    // 매수 주문이 이미 접수돼 있다. 접수(ACCEPTED)는 체결이 아니므로 낙관적으로 보유 처리하면
    // 미체결분을 다음 tick에 매도 평가할 수 있다. 실주문은 KIS 잔고로 체결을 확인한 뒤에만 보유로 전환한다.
    // 기록 모드(DRY_RUN)는 실제 주문·잔고가 없으므로 시뮬레이션으로 즉시 보유 전환한다.
    let buyOrder = repo.getActiveOrderByIdempotencyKey?.(idempotencyKey) || null;
    const entryWasLive = buyOrder?.liveOrderEnabled ?? liveOrderEnabled;
    if (!entryWasLive) {
      repo.confirmEntryHolding(userId, strategy.id, entry.id, { symbol, symbolName, entryWindow });
      if (buyOrder) await ensureKrTargetSellOrder(userId, trading, buyOrder);
      return saveDecision(userId, strategy, {
        decision: 'SKIP', entryWindow, selectedSymbol: symbol, selectedSymbolName: symbolName,
        liveOrderEnabled: entryWasLive, evaluationSource, reason: `${label} 진입: ${symbol} 매수 기록이 이미 있어 보유로 둡니다(기록 모드).`
      });
    }
    let balance = await trading.getBalance(symbol, { market: 'KR', currency: 'KRW' });
    let accountQuantity = Math.floor(Number(balance.quantity || 0));
    let filledQuantity = Math.min(
      accountQuantity,
      getKrManagedRemainingQuantity(buyOrder, entry.id)
    );
    let buyRemainderNote = '';
    // 계좌에 같은 종목이 있어도 이 BUY의 체결 증거가 없으면 수동/다른 전략 보유분일 수 있다.
    // 주문 이력을 한 번 더 확인하되, 그래도 체결 수량이 없으면 절대 holding/TARGET으로 채택하지 않는다.
    if (accountQuantity > 0 && filledQuantity <= 0 && buyOrder?.kisOrderNo) {
      const refreshed = await tryRefreshKrOrderState(userId, trading, buyOrder);
      if (refreshed) buyOrder = refreshed;
      filledQuantity = Math.min(
        accountQuantity,
        getKrManagedRemainingQuantity(buyOrder, entry.id)
      );
    }
    if (accountQuantity > 0 && filledQuantity <= 0) {
      return saveDecision(userId, strategy, {
        decision: 'SKIP', entryWindow, selectedSymbol: symbol, selectedSymbolName: symbolName,
        liveOrderEnabled: entryWasLive, evaluationSource, orderId: buyOrder?.id,
        reason: `${label} 진입: 계좌에 ${symbol} ${accountQuantity}주가 있지만 이 전략의 매수 체결 수량은 확인되지 않아 보유로 전환하거나 매도하지 않습니다. KIS 주문 이력과 기존 보유분을 확인하세요.`
      });
    }
    if (filledQuantity > 0 && buyOrder
      && !['FILLED', 'CANCELED', 'REJECTED'].includes(buyOrder.status)) {
      const openOrders = await safeOpenOrders(userId, trading, symbol);
      if (!Array.isArray(openOrders)) {
        return saveDecision(userId, strategy, {
          decision: 'SKIP', entryWindow, selectedSymbol: symbol, selectedSymbolName: symbolName,
          liveOrderEnabled: entryWasLive, evaluationSource,
          reason: `${label} 진입: ${symbol} 일부 체결 잔고가 있지만 미체결 잔량을 확인하지 못해 보유 전환을 보류합니다.`
        });
      }
      const ownBuyStillOpen = openOrders.some((row) => (
        buyOrder.kisOrderNo
        && String(row?.orderNo || '').trim() === String(buyOrder.kisOrderNo).trim()
      ));
      if (ownBuyStillOpen) {
        if (!isGlobalLiveOrderEnabled()) {
          return saveDecision(userId, strategy, {
            decision: 'SKIP', entryWindow, selectedSymbol: symbol, selectedSymbolName: symbolName,
            liveOrderEnabled: false, evaluationSource,
            reason: `${label} 진입: ${symbol} 일부 체결과 매수 잔량이 확인됐지만 전역 실주문 중지 상태라 취소하지 않고 상태 확정을 보류합니다.`
          });
        }
        const canceled = await cancelKrOrderAndConfirm(userId, trading, buyOrder);
        if (!canceled.ok) {
          return saveDecision(userId, strategy, {
            decision: 'SKIP', entryWindow, selectedSymbol: symbol, selectedSymbolName: symbolName,
            liveOrderEnabled: entryWasLive, evaluationSource, orderId: buyOrder.id,
            reason: `${label} 진입: ${symbol} 일부 체결 후 남은 매수 취소가 확정되지 않아 보유 전환을 보류합니다. ${canceled.reason}`
          });
        }
        buyOrder = canceled.order || buyOrder;
        balance = await trading.getBalance(symbol, { market: 'KR', currency: 'KRW' });
        accountQuantity = Math.floor(Number(balance.quantity || 0));
        filledQuantity = Math.min(
          accountQuantity,
          getKrManagedRemainingQuantity(buyOrder, entry.id)
        );
        buyRemainderNote = ' 남은 매수 주문의 취소와 잔고 재확인을 마쳤습니다.';
      }
    }
    if (filledQuantity > 0) {
      repo.confirmEntryHolding(userId, strategy.id, entry.id, { symbol, symbolName, entryWindow });
      if (buyOrder) {
        await ensureKrTargetSellOrder(userId, trading, {
          ...buyOrder,
          status: 'FILLED',
          filledQuantity,
          averageFilledPrice: Number(buyOrder.averageFilledPrice || buyOrder.orderPrice || balance.averagePrice || 0)
        });
      }
      return saveDecision(userId, strategy, {
        decision: 'SKIP', entryWindow, selectedSymbol: symbol, selectedSymbolName: symbolName,
        liveOrderEnabled: entryWasLive, evaluationSource,
        reason: `${label} 진입: ${symbol} 매수 체결 확인(${filledQuantity}주). 보유로 전환했습니다.${buyRemainderNote}`
      });
    }
    // 잔고 0만으로 "매수 후 매도까지 완료"라고 추정하지 않는다. BUY FILLED와 별개로
    // SELL FILLED 증거가 있어야 진입을 종결한다(취소/거부 오분류나 잔고 일시 불일치 방지).
    let refreshedBuyOrder = buyOrder;
    const filledSellOrder = repo.getFilledSellOrderForEntry(entry.id);
    if (filledSellOrder && (
      refreshedBuyOrder?.status === 'FILLED'
      || Number(refreshedBuyOrder?.filledQuantity || 0) > 0
    )) {
      repo.updateEntryOutcome(entry.id, { status: 'BOUGHT', bought: true });
      return saveDecision(userId, strategy, {
        decision: 'SKIP', entryWindow, selectedSymbol: symbol, selectedSymbolName: symbolName,
        liveOrderEnabled: entryWasLive, evaluationSource,
        orderId: filledSellOrder.id,
        reason: `${label} 진입: ${symbol} 매수와 매도 체결이 모두 확인되어 오늘 ${label} 진입을 마쳤습니다.`,
        noLog: evaluationSource !== 'MANUAL'
      });
    }
    // BUY 가 우리 DB 에는 ACCEPTED 인 채 남아 있고 잔고도 0인 모호한 상태. 두 가지 가능성:
    //   (a) KIS 에서 실제로 아직 체결 전 — 다음 tick에 다시 확인하면 된다.
    //   (b) 이미 체결돼 TARGET 매도까지 끝났는데 평가 시작점의 syncOrderFills 가 일시 KIS 오류로
    //       실패해 우리 DB 가 뒤처져 있다.
    // (b)를 (a)로 잘못 판단하면 무한 SKIP 노이즈가 다시 생기므로, 이번 케이스에 한정해서
    // KIS 체결조회를 한 번만 콕 찍어 다시 확인한다(주기적 폴링이 아니라 모호한 분기에서만 호출).
    if (entryWasLive && refreshedBuyOrder?.kisOrderNo) {
      const refreshed = await tryRefreshBuyOrderState(userId, trading, refreshedBuyOrder);
      if (refreshed?.status === 'FILLED') {
        refreshedBuyOrder = refreshed;
        const refreshedFilledSell = repo.getFilledSellOrderForEntry(entry.id);
        if (refreshedFilledSell) {
          repo.updateEntryOutcome(entry.id, { status: 'BOUGHT', bought: true });
          return saveDecision(userId, strategy, {
            decision: 'SKIP', entryWindow, selectedSymbol: symbol, selectedSymbolName: symbolName,
            liveOrderEnabled: entryWasLive, evaluationSource, orderId: refreshedFilledSell.id,
            reason: `${label} 진입: ${symbol} 매수와 매도 체결이 모두 확인되어 오늘 ${label} 진입을 마쳤습니다.`,
            noLog: evaluationSource !== 'MANUAL'
          });
        }
      }
    }
    const restingMs = refreshedBuyOrder?.createdAt
      ? Date.now() - sqliteUtcToMs(refreshedBuyOrder.createdAt)
      : 0;
    if (entryWasLive
      && refreshedBuyOrder?.kisOrderNo
      && ['REQUESTED', 'ACCEPTED', 'PARTIALLY_FILLED', 'UNKNOWN'].includes(refreshedBuyOrder.status)
      && Number(refreshedBuyOrder.filledQuantity || 0) <= 0
      && restingMs >= BUY_STALE_LIMIT_MS) {
      const openOrders = await safeOpenOrders(userId, trading, symbol);
      if (!Array.isArray(openOrders)) {
        return saveDecision(userId, strategy, {
          decision: 'SKIP', entryWindow, selectedSymbol: symbol, selectedSymbolName: symbolName,
          liveOrderEnabled: entryWasLive, evaluationSource, orderId: refreshedBuyOrder.id,
          reason: `${label} 진입: ${symbol} 매수 미체결이 오래됐지만 KIS 미체결 목록을 확인하지 못해 취소·재주문하지 않습니다.`
        });
      }
      const ownBuyStillOpen = openOrders.some((row) => (
        String(row?.orderNo || '').trim() === String(refreshedBuyOrder.kisOrderNo).trim()
      ));
      if (ownBuyStillOpen) {
        const canceled = await cancelKrOrderAndConfirm(userId, trading, refreshedBuyOrder);
        if (!canceled.ok) {
          return saveDecision(userId, strategy, {
            decision: 'SKIP', entryWindow, selectedSymbol: symbol, selectedSymbolName: symbolName,
            liveOrderEnabled: entryWasLive, evaluationSource, orderId: refreshedBuyOrder.id,
            reason: `${label} 진입: ${symbol} 오래된 미체결 매수의 취소가 확정되지 않아 재주문하지 않습니다. ${canceled.reason}`
          });
        }
        return saveDecision(userId, strategy, {
          decision: 'SKIP', entryWindow, selectedSymbol: symbol, selectedSymbolName: symbolName,
          liveOrderEnabled: entryWasLive, evaluationSource, orderId: canceled.order?.id || refreshedBuyOrder.id,
          reason: `${label} 진입: ${symbol} 매수가 ${Math.round(BUY_STALE_LIMIT_MS / 1000)}초 동안 체결되지 않아 취소를 확인했습니다. 다음 평가에서 최신 랭킹·분봉·가격을 다시 통과하면 제한 시간 안에서 재호가합니다.`
        });
      }
      // 미체결 목록에 없다는 사실만으로 미접수를 단정할 수 없다. sync/주문이력에서
      // CANCELED·REJECTED가 확인될 때까지는 blind retry하지 않는다.
    }
    return saveDecision(userId, strategy, {
      decision: 'SKIP', entryWindow, selectedSymbol: symbol, selectedSymbolName: symbolName,
      liveOrderEnabled: entryWasLive, evaluationSource,
      reason: refreshedBuyOrder?.status === 'FILLED'
        ? `${label} 진입: ${symbol} 매수 체결은 확인됐지만 잔고가 0이고 매도 체결은 확인되지 않아 상태 확정을 보류합니다.`
        : `${label} 진입: ${symbol} 매수 주문이 접수됐으나 아직 체결되지 않아 보유 전환을 보류합니다.`
    });
  }
  if (repo.countFailedOrders(idempotencyKey) >= ORDER_RETRY_LIMIT) {
    return saveDecision(userId, strategy, {
      decision: 'SKIP', entryWindow, selectedSymbol: symbol, selectedSymbolName: symbolName,
      liveOrderEnabled, evaluationSource,
      reason: `${label} 진입: ${symbol} 매수가 ${ORDER_RETRY_LIMIT}회 실패해 더 시도하지 않습니다.`
    });
  }

  if (tradeDate !== kstToday()) {
    repo.finalizeEntryWithoutCandidate(entry.id, { status: 'SKIPPED', rankingSnapshot });
    return saveDecision(userId, strategy, {
      decision: 'SKIP', entryWindow, selectedSymbol: symbol, selectedSymbolName: symbolName,
      rankingSnapshot, liveOrderEnabled, evaluationSource,
      reason: `${label} 진입: 이전 거래일의 미접수 후보라 새 주문을 만들지 않고 종료합니다.`
    });
  }

  // 후보 탐색 마감과 이미 고른 후보의 확인/주문 재시도 마감을 분리한다. 09:14:30에 고른
  // 후보도 다음 tick 확인 기회가 있어야 하며, 반대로 선택 후 3분 넘게 기술 오류가 이어진
  // 후보를 뒤늦게 추격해서는 안 된다. 재선택된 entry는 updated_at을 새 기준으로 쓴다.
  const confirmationAgeMinutes = minutesSinceSqliteTimestamp(entry.updatedAt || entry.createdAt);
  if (confirmationAgeMinutes != null && confirmationAgeMinutes >= ENTRY_CONFIRMATION_MAX_MINUTES) {
    repo.finalizeEntryWithoutCandidate(entry.id, { status: 'SKIPPED', rankingSnapshot });
    return saveDecision(userId, strategy, {
      decision: 'SKIP', entryWindow, selectedSymbol: symbol, selectedSymbolName: symbolName,
      rankingSnapshot, liveOrderEnabled, evaluationSource,
      reason: `${label} 진입: ${symbol} 후보 확인 또는 주문 재시도가 선택 후 ${ENTRY_CONFIRMATION_MAX_MINUTES}분 안에 끝나지 않아 늦은 추격 매수를 막고 이 구간을 종료합니다.`
    });
  }

  let buyPlan = null;
  if (!buyPlan) {
    // 이전 tick의 주문 실패 뒤 남은 SELECTED 종목을 그대로 재주문하면, 그 사이 흐름이 꺾였거나
    // 신호가보다 급등한 종목을 뒤늦게 추격할 수 있다. 재시도 직전에 분봉과 실행가를 다시 확인한다.
    let latestRanking;
    let latestCandles;
    try {
      latestRanking = await getDomesticFluctuationRanking(userId);
      latestCandles = await getDomesticTodayMinuteCandles(userId, symbol);
    } catch (error) {
      return saveDecision(userId, strategy, {
        decision: 'SKIP', entryWindow, selectedSymbol: symbol, selectedSymbolName: symbolName,
        liveOrderEnabled, evaluationSource,
        reason: `${label} 진입: ${symbol} 재시도 전 최신 랭킹·분봉을 확인하지 못해 안전상 주문하지 않습니다. ${error.message || '다음 평가에서 다시 확인합니다.'}`
      });
    }
    rankingSnapshot = (latestRanking || []).slice(0, RANKING_SNAPSHOT_SIZE);
    const minFluctuationRate = minFluctuationRateForEntryWindow(entryWindow);
    const maxFluctuationRate = maxFluctuationRateForEntryWindow(entryWindow);
    const retryCandidate = selectRankingCandidates(
      (latestRanking || []).slice(0, RAW_RANK_CANDIDATE_LIMIT),
      { minFluctuationRate, maxFluctuationRate }
    )
      .find((candidate) => candidate.symbol === symbol);
    const retryCheck = retryCandidate
      ? checkBuyCandidate(latestCandles, {
          entryWindow,
          candidate: retryCandidate
        })
      : {
          ok: false,
          reason: `최신 랭킹에서 사라졌거나 현재 등락률이 진입 범위(${(minFluctuationRate * 100).toFixed(0)}% 이상 ${(maxFluctuationRate * 100).toFixed(0)}% 미만)를 벗어났습니다.`
        };
    if (!retryCheck.ok) {
      repo.finalizeEntryWithoutCandidate(entry.id, { status: 'SKIPPED', rankingSnapshot });
      return saveDecision(userId, strategy, {
        decision: 'SKIP', entryWindow, selectedSymbol: symbol, selectedSymbolName: symbolName,
        rankingSnapshot, liveOrderEnabled, evaluationSource,
        reason: `${label} 진입: ${symbol} 주문 전 재검증에서 제외했습니다. ${retryCheck.reason} 늦은 대체 후보를 추격하지 않고 이 구간을 종료합니다.`
      });
    }
    try {
      buyPlan = await buildKrBuyPlan(trading, strategy, entryWindow, {
        symbol,
        price: retryCandidate.price
      });
    } catch (error) {
      return saveDecision(userId, strategy, {
        decision: 'SKIP', entryWindow, selectedSymbol: symbol, selectedSymbolName: symbolName,
        rankingSnapshot, liveOrderEnabled, evaluationSource,
        reason: `${label} 진입: ${symbol} 재시도 전 매수가능금액을 확인하지 못해 안전상 주문하지 않습니다. ${error.message || '다음 평가에서 다시 확인합니다.'}`
      });
    }
    const referencePrice = Number(retryCheck.referencePrice) || 0;
    const selectedPrice = Number(entry.selectedPrice) || referencePrice;
    if (selectedPrice > 0 && buyPlan.currentPrice < selectedPrice * (1 - ENTRY_MAX_ADVERSE_MOVE_RATE)) {
      const adverseMove = (selectedPrice - buyPlan.currentPrice) / selectedPrice;
      repo.finalizeEntryWithoutCandidate(entry.id, { status: 'SKIPPED', rankingSnapshot });
      return saveDecision(userId, strategy, {
        decision: 'SKIP', entryWindow, selectedSymbol: symbol, selectedSymbolName: symbolName,
        currentPrice: buyPlan.currentPrice, cashAvailable: buyPlan.cashAvailable,
        rankingSnapshot, liveOrderEnabled, evaluationSource,
        reason: `${label} 진입: ${symbol} 현재가가 최초 선택가보다 ${(adverseMove * 100).toFixed(1)}% 급락해 모멘텀이 무효화됐습니다. 이 구간을 종료합니다.`
      });
    }
    if (referencePrice > 0 && buyPlan.currentPrice > referencePrice * (1 + ENTRY_MAX_SLIPPAGE_RATE)) {
      const slippage = (buyPlan.currentPrice - referencePrice) / referencePrice;
      repo.finalizeEntryWithoutCandidate(entry.id, { status: 'SKIPPED', rankingSnapshot });
      return saveDecision(userId, strategy, {
        decision: 'SKIP', entryWindow, selectedSymbol: symbol, selectedSymbolName: symbolName,
        currentPrice: buyPlan.currentPrice, cashAvailable: buyPlan.cashAvailable,
        rankingSnapshot, liveOrderEnabled, evaluationSource,
        reason: `${label} 진입: ${symbol} 현재가가 새 신호가보다 ${(slippage * 100).toFixed(1)}% 올라 추격 매수를 중단하고 이 구간을 종료합니다.`
      });
    }
    if (referencePrice > 0 && buyPlan.currentPrice < referencePrice * (1 - ENTRY_MAX_ADVERSE_MOVE_RATE)) {
      const adverseMove = (referencePrice - buyPlan.currentPrice) / referencePrice;
      repo.finalizeEntryWithoutCandidate(entry.id, { status: 'SKIPPED', rankingSnapshot });
      return saveDecision(userId, strategy, {
        decision: 'SKIP', entryWindow, selectedSymbol: symbol, selectedSymbolName: symbolName,
        currentPrice: buyPlan.currentPrice, cashAvailable: buyPlan.cashAvailable,
        rankingSnapshot, liveOrderEnabled, evaluationSource,
        reason: `${label} 진입: ${symbol} 현재가가 새 신호가보다 ${(adverseMove * 100).toFixed(1)}% 급락해 모멘텀이 무효화됐습니다. 이 구간을 종료합니다.`
      });
    }
  }

  if (buyPlan.quantity <= 0) {
    const budgetNote = strategy.autoBudgetEnabled
      ? `매수가능금액 ${fmt(buyPlan.cashAvailable)}원(자동 예산 모드)`
      : `매수 금액 한도 ${fmt(buyPlan.entryBudget)}원·매수가능금액 ${fmt(buyPlan.cashAvailable)}원`;
    repo.finalizeEntryWithoutCandidate(entry.id, { status: 'SKIPPED', rankingSnapshot });
    return saveDecision(userId, strategy, {
      decision: 'SKIP', entryWindow, selectedSymbol: symbol, selectedSymbolName: symbolName,
      currentPrice: buyPlan.currentPrice, cashAvailable: buyPlan.cashAvailable,
      rankingSnapshot, liveOrderEnabled, evaluationSource,
      reason: `${label} 진입: ${symbol} ${budgetNote}으로 1주도 매수할 수 없어 늦은 대체 후보를 찾지 않고 이 구간을 종료합니다.`
    });
  }

  const { currentPrice, cashAvailable, quantity } = buyPlan;

  if (quantity <= 0) {
    return saveDecision(userId, strategy, {
      decision: 'SKIP', entryWindow, selectedSymbol: symbol, selectedSymbolName: symbolName,
      currentPrice, cashAvailable, rankingSnapshot, liveOrderEnabled, evaluationSource,
      reason: `${label} 진입: ${symbol} 매수가능금액으로 1주도 매수할 수 없습니다.`
    });
  }

  // 시장가 대신 현재가보다 약간 위의 지정가로 매수한다(추격 슬리피지 방지). 정상 호가에서는 즉시
  // 체결되고, 순간 급등으로 호가가 갭하면 캡 위로는 체결되지 않아 꼭대기를 잡지 않는다.
  // 수량은 상한가(marginPrice) 기준으로 잡혀 있어 캡 지정가로도 매수가능금액을 넘지 않는다.
  const limitPrice = Math.max(currentPrice, Math.ceil(currentPrice * (1 + ENTRY_LIMIT_BUFFER_RATE)));
  const estimatedAmount = quantity * limitPrice;

  const openOrders = liveOrderEnabled ? await safeOpenOrders(userId, trading, symbol) : [];
  const guard = checkOrderSafety({ side: 'BUY', quantity, openOrders, idempotencyKey, cashAvailable, estimatedAmount });
  if (!guard.ok) {
    // 안전 검증 미통과 = "지금은 못 함". 주문 행을 만들지 않고 진입 기록은 SELECTED 유지 → 다음 tick 재시도.
    return saveDecision(userId, strategy, {
      decision: 'SKIP', entryWindow, selectedSymbol: symbol, selectedSymbolName: symbolName,
      currentPrice, cashAvailable, rankingSnapshot, liveOrderEnabled, evaluationSource,
      reason: `${label} 진입: ${symbol} 매수 대상이나 ${guard.reason} 다음 평가에서 다시 시도합니다.`
    });
  }

  if (liveOrderEnabled) {
    // 미체결 안전검사 뒤 실제 POST에 최대한 가깝게 다시 잔고를 확인해, 검사 사이 수동 매수나
    // 다른 전략 체결이 생기는 TOCTOU 구간을 줄인다.
    const existingBalance = await limitedKisCall(userId, `kr-pre-buy-balance:${symbol}`, () => (
      trading.getBalance(symbol, { market: 'KR', currency: 'KRW' })
    ));
    const existingQuantity = Math.floor(Number(existingBalance.quantity || 0));
    if (existingQuantity > 0) {
      // 동일 종목의 수동/다른 전략 보유분과 이번 전략 체결분을 KIS 잔고만으로 구분할 수 없다.
      // 주문 전 잔고 0을 강제해 이후 reconciliation과 매도가 외부 보유분을 건드리지 않게 한다.
      repo.finalizeEntryWithoutCandidate(entry.id, { status: 'SKIPPED', rankingSnapshot });
      return saveDecision(userId, strategy, {
        decision: 'SKIP', entryWindow, selectedSymbol: symbol, selectedSymbolName: symbolName,
        currentPrice, cashAvailable, rankingSnapshot, liveOrderEnabled, evaluationSource,
        reason: `${label} 진입: 계좌에 ${symbol} 기존 보유 ${existingQuantity}주가 있어 이번 전략 체결분과 구분할 수 없으므로 매수하지 않고 이 구간을 종료합니다.`
      });
    }
  }

  const order = await placeOrder(userId, trading, {
    strategyId: strategy.id, entryId: entry.id, symbol, symbolName, side: 'BUY', entryWindow,
    quantity, orderPrice: limitPrice, estimatedAmount, idempotencyKey, liveOrderEnabled,
    orderType: 'LIMIT'
  }, {
    liveOrderEnabled,
    decisionReason: `${label} 진입: ${symbol} ${quantity}주 지정가(${fmt(limitPrice)}원) 매수.`
  });
  // 기록 모드(DRY_RUN)는 실제 주문이 없어 즉시 보유로 시뮬레이션한다.
  // 실주문(ACCEPTED 등)은 접수일 뿐 체결이 아니므로 보유 전환을 미루고, 다음 tick의
  // hasNonFailedOrder 분기에서 KIS 잔고로 체결을 확인한 뒤 전환한다(미체결분 오평가 방지).
  if (order.status === 'DRY_RUN') {
    repo.confirmEntryHolding(userId, strategy.id, entry.id, { symbol, symbolName, entryWindow });
    await ensureKrTargetSellOrder(userId, trading, order);
  }
  // 실패면 진입 기록은 SELECTED 그대로 — 다음 tick에 재시도(한도 안에서).
  return saveDecision(userId, strategy, {
    decision: 'BUY', entryWindow, selectedSymbol: symbol, selectedSymbolName: symbolName,
    currentPrice, cashAvailable,
    expectedQuantity: quantity, expectedPrice: currentPrice, expectedAmount: estimatedAmount,
    rankingSnapshot, liveOrderEnabled, evaluationSource, orderId: order.id,
    reason: `${label} 진입: ${symbol} ${quantity}주 지정가(${fmt(limitPrice)}원) 매수. ${orderStatusNote(order, liveOrderEnabled)}`
  });
}

// ── 체결가 동기화 ─────────────────────────────────────────────────────────

// 미체결(접수/부분체결/UNKNOWN) 상태인 실주문의 실제 체결가를 KIS 체결조회로 가져와
// kr_rank_orders.average_filled_price·filled_quantity·status를 갱신한다.
//
// 호출 원칙: 화면 렌더링이 아니라 "주문 이벤트"나 사용자의 명시적 동기화 요청 때만 호출한다.
// 평가 tick(30초), 주문 직후 지연 트리거, 수동 동기화에서만 KIS 체결조회를 사용한다.
// 종결 상태라도 실체결가가 비어 있는 FILLED 주문은 과거 이력 보정 대상이다.
//
// 같은 종목의 여러 주문은 KIS 체결조회를 1회만 호출하고 주문번호로 매칭한다(KIS 호출 절감).
export async function syncOrderFills(userId, { strategyId = null, limit = 20 } = {}) {
  if (strategyId) requireStrategy(userId, strategyId, { includeDeleted: true });
  const candidates = repo.listFillSyncCandidates(userId, { strategyId, limit });
  if (candidates.length === 0) return [];
  let trading;
  try {
    await getValidAccessToken(userId);
    trading = new KisTradingService(userId);
  } catch {
    // KIS 토큰 발급 실패는 일시적일 수 있다. 다음 호출에서 재시도.
    return [];
  }

  // 같은 symbol에 대한 KIS 체결조회는 1회만 호출하고 캐시한다(주문번호로 행 매칭).
  const historyCache = new Map();
  const updated = [];
  for (const order of candidates) {
    try {
      const dateWindow = orderHistoryDateWindow(order);
      const cacheKey = `${order.symbol}::${dateWindow.startDate}::${dateWindow.endDate}`;
      let history = historyCache.get(cacheKey);
      if (history == null) {
        try {
          history = await limitedKisCall(userId, `kr-order-history:${order.symbol}:${dateWindow.startDate}:${dateWindow.endDate}`, () => (
            trading.getOrderHistory(order.symbol, {
              market: 'KR',
              ...dateWindow
            })
          ));
        } catch {
          history = [];
        }
        if (!Array.isArray(history)) history = [];
        historyCache.set(cacheKey, history);
      }
      const matched = findOrderHistoryMatch(history, order);
      if (!matched) continue;
      const filledQty = Math.floor(Number(matched.filledQuantity || 0));
      const remaining = matched.remainingQuantity != null && matched.remainingQuantity !== ''
        ? Number(matched.remainingQuantity)
        : null;
      const avgFilledPrice = Number(matched.averageFilledPrice || 0);
      const terminalStatus = ['CANCELED', 'REJECTED'].includes(matched.status);
      // 체결 정보가 없어도 취소/거부/모순(UNKNOWN)은 DB에 전달해야 ACCEPTED로 영구 고착되지 않는다.
      if (filledQty <= 0 && avgFilledPrice <= 0
        && !terminalStatus && matched.status !== 'UNKNOWN') continue;

      const status = terminalStatus || matched.status === 'UNKNOWN'
        ? matched.status
        : (matched.status === 'FILLED' || (remaining != null && remaining <= 0 && filledQty > 0)
            ? 'FILLED'
            : (filledQty > 0 ? 'PARTIALLY_FILLED' : order.status));

      const result = repo.updateOrder(userId, order.id, {
        status,
        // KIS 후속 조회가 일부 체결량을 더 작게 돌려줘도 이미 확인한 체결을 되돌리지 않는다.
        // 동시에 잘못된 응답이 주문수량보다 큰 체결을 만들지 못하도록 상한을 둔다.
        filledQuantity: mergeMonotonicFilledQuantity(order, filledQty),
        remainingQuantity: remaining != null ? remaining : (order.remainingQuantity ?? null),
        averageFilledPrice: mergeMonotonicAverageFilledPrice(order, filledQty, avgFilledPrice)
      });
      if (result) updated.push(result);
      if (result?.side === 'BUY'
        && Number(result.filledQuantity || 0) > 0
        && ['FILLED', 'CANCELED', 'REJECTED'].includes(result.status)) {
        await ensureKrTargetSellOrder(userId, trading, result);
      }
    } catch {
      // 한 주문의 동기화 실패는 다른 주문 처리를 막지 않는다.
    }
  }
  if (updated.some((order) => order.side === 'SELL' && order.status === 'FILLED')) {
    await syncRealizedProfits(userId, { strategyId, limit }).catch(() => []);
  }
  return updated;
}

export async function syncRealizedProfits(userId, { strategyId = null, limit = 20 } = {}) {
  if (strategyId) requireStrategy(userId, strategyId, { includeDeleted: true });
  const candidates = repo.listRealizedProfitSyncCandidates(userId, { strategyId, limit });
  if (candidates.length === 0) return [];
  let trading;
  try {
    await getValidAccessToken(userId);
    trading = new KisTradingService(userId);
  } catch {
    return [];
  }

  const profitCache = new Map();
  const updated = [];
  for (const order of candidates) {
    try {
      const dateWindow = orderHistoryDateWindow(order);
      const cacheKey = `${order.symbol}::${dateWindow.startDate}::${dateWindow.endDate}`;
      let rows = profitCache.get(cacheKey);
      if (rows == null) {
        try {
          rows = await limitedKisCall(userId, `kr-realized-profit:${order.symbol}:${dateWindow.startDate}:${dateWindow.endDate}`, () => (
            trading.getRealizedProfits({ market: 'KR', symbol: order.symbol, ...dateWindow })
          ));
        } catch {
          rows = [];
        }
        if (!Array.isArray(rows)) rows = [];
        profitCache.set(cacheKey, rows);
      }
      const matched = rows.find((row) => matchesRealizedProfitRow(order, row));
      if (!matched) continue;
      const result = repo.updateOrderRealizedProfit(userId, order.id, {
        realizedProfitAmount: matched.realizedProfitAmount,
        realizedProfitRate: matched.realizedProfitRate,
        realizedFeeAmount: matched.feeAmount,
        realizedTaxAmount: matched.taxAmount,
        realizedProfitSource: 'KIS_TTTC8715R'
      });
      if (result) updated.push(result);
    } catch {
      // 한 주문의 실현손익 동기화 실패는 다른 주문 처리를 막지 않는다.
    }
  }
  return updated;
}

function matchesRealizedProfitRow(order, row) {
  if (!row) return false;
  if (String(row.symbol || '').trim() !== String(order.symbol || '').trim()) return false;
  const sellQty = Number(row.sellQuantity || 0);
  const orderQty = Number(order.filledQuantity || order.quantity || 0);
  if (sellQty > 0 && orderQty > 0 && Math.abs(sellQty - orderQty) > 0.000001) return false;
  const sellPrice = Number(row.sellPrice || 0);
  const orderPrice = Number(order.averageFilledPrice || order.orderPrice || 0);
  if (sellPrice > 0 && orderPrice > 0 && Math.abs(sellPrice - orderPrice) > 1) return false;
  return true;
}

async function tryRefreshKrOrderState(userId, trading, order) {
  if (!order?.kisOrderNo) return null;
  try {
    const refreshed = await limitedKisCall(
      userId,
      `kr-refresh-order:${order.symbol}:${order.kisOrderNo}`,
      () => trading.refreshOrder({
        symbol: order.symbol,
        market: 'KR',
        kisOrderNo: order.kisOrderNo,
        kisOriginalOrderNo: order.kisOriginalOrderNo,
        createdAt: order.createdAt
      })
    );
    if (!refreshed || !['ACCEPTED', 'PARTIALLY_FILLED', 'FILLED', 'CANCELED', 'REJECTED', 'UNKNOWN'].includes(refreshed.status)) {
      return null;
    }
    const filledQuantity = Math.floor(Number(refreshed.filledQuantity || 0));
    const remainingQuantity = refreshed.remainingQuantity != null && refreshed.remainingQuantity !== ''
      ? Number(refreshed.remainingQuantity)
      : order.remainingQuantity;
    const averageFilledPrice = Number(refreshed.averageFilledPrice || 0);
    return repo.updateOrder(userId, order.id, {
      status: refreshed.status,
      filledQuantity: mergeMonotonicFilledQuantity(order, filledQuantity),
      remainingQuantity: remainingQuantity ?? null,
      averageFilledPrice: mergeMonotonicAverageFilledPrice(order, filledQuantity, averageFilledPrice),
      responsePayloadMasked: refreshed.responsePayloadMasked || null
    });
  } catch {
    return null;
  }
}

// 평가 안에서 모호한 분기(잔고=0 + 우리 DB 상의 BUY 상태가 ACCEPTED 등)에 한해 호출해,
// KIS 체결조회로 단일 매수 주문의 실제 체결 상태를 다시 묻고 DB에 반영한다.
// 주기적 폴링이 아니라 이번 평가 한 번에만 KIS를 한 번 더 호출하는 보조 안전망이다.
async function tryRefreshBuyOrderState(userId, trading, buyOrder) {
  const refreshed = await tryRefreshKrOrderState(userId, trading, buyOrder);
  return refreshed?.status === 'FILLED' ? refreshed : null;
}

// 주문 접수 직후(체결까지 보통 수 초)에 호출해, 다음 30초 tick보다 빠르게 체결가를 갱신한다.
// 비동기 fire-and-forget — 호출자는 await 하지 않는다. 실패해도 다음 평가 tick이 재시도한다.
function scheduleFillSyncAfterPlacement(userId, strategyId) {
  setTimeout(() => {
    syncOrderFills(userId, { strategyId }).catch(() => {});
  }, 3000).unref?.();
}

function orderHistoryDateWindow(order) {
  const raw = String(order?.createdAt || '').trim();
  const normalized = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/.test(raw)
    ? `${raw.replace(' ', 'T')}Z`
    : raw;
  const base = normalized ? new Date(normalized) : new Date();
  const date = Number.isNaN(base.getTime()) ? new Date() : base;
  return {
    startDate: compactDateInKst(addDays(date, -1)),
    endDate: compactDateInKst(addDays(date, 1))
  };
}

function addDays(date, days) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function compactDateInKst(date) {
  const parts = {};
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== 'literal') parts[part.type] = part.value;
  }
  return `${parts.year}${parts.month}${parts.day}`;
}

// ── 주문 실행 ─────────────────────────────────────────────────────────────

// 실주문 OFF면 DRY_RUN 기록만, ON이면 KIS로 실제 전송한다. 이 함수 안에서 POST를 재시도하지 않고,
// 미접수가 명확한 REJECTED만 다음 평가 tick이 최신 신호를 재검증한 뒤 제한 재시도한다.
async function placeOrder(userId, trading, baseOrder, { liveOrderEnabled, decisionReason }) {
  const orderInput = {
    ...baseOrder,
    market: 'KR',
    currency: 'KRW',
    // 진입 매수·목표 수익 선주문 모두 지정가(LIMIT)로 넘긴다. orderType 미지정 시에만 시장가로 호환.
    orderType: baseOrder.orderType || 'MARKET',
    decisionReason
  };
  if (!liveOrderEnabled) {
    return repo.createOrder(userId, {
      ...orderInput,
      status: 'DRY_RUN',
      requestPayloadMasked: maskPayload(orderInput)
    });
  }
  // 실제 POST 전에 intent를 먼저 남긴다. KIS가 주문을 접수했지만 응답 timeout/프로세스 종료가
  // 발생해도 REQUESTED/UNKNOWN 행이 멱등성 gate를 막아 같은 주문을 재전송하지 않게 한다.
  const requested = repo.createOrder(userId, {
    ...orderInput,
    status: 'REQUESTED',
    requestPayloadMasked: maskPayload(orderInput)
  });
  try {
    const result = await limitedKisCall(userId, `kr-place-order:${baseOrder.side}:${baseOrder.symbol}`, () => (
      baseOrder.side === 'BUY'
        ? trading.placeBuyOrder({ ...orderInput })
        : trading.placeSellOrder({ ...orderInput })
    ));
    const created = repo.updateOrder(userId, requested.id, {
      status: result.status || 'ACCEPTED',
      kisOrderNo: result.orderNo,
      kisOriginalOrderNo: result.originalOrderNo,
      filledQuantity: null,
      remainingQuantity: null,
      averageFilledPrice: null,
      responsePayloadMasked: result.responsePayloadMasked || null
    });
    // 시장가는 보통 수 초 내 체결되므로, 다음 30초 tick을 기다리지 않고
    // 3초 뒤 1회 체결조회로 실체결가를 일찍 끌어오게 한다. 실패해도 다음 tick이 재시도.
    if (created && created.kisOrderNo) {
      scheduleFillSyncAfterPlacement(userId, baseOrder.strategyId);
    }
    return created;
  } catch (error) {
    return repo.updateOrder(userId, requested.id, {
      // KIS가 업무 거절을 명시한 경우는 미접수가 확정돼 제한 재시도가 가능하다. timeout/5xx처럼
      // 접수 여부가 모호한 예외는 UNKNOWN으로 남겨 blind retry와 이중 매수를 막는다.
      status: error.orderOutcome === 'REJECTED' ? 'REJECTED' : 'UNKNOWN',
      filledQuantity: null,
      remainingQuantity: null,
      averageFilledPrice: null,
      responsePayloadMasked: error.safePayload || null,
      errorMessage: error.message || 'KIS 주문 요청에 실패했습니다.'
    });
  }
}

async function ensureKrTargetSellOrder(userId, trading, buyOrder) {
  if (!buyOrder || buyOrder.side !== 'BUY') return null;
  // 저장된 BUY provenance가 live여도 배포 환경의 전역 kill switch가 꺼져 있으면
  // sync/잔고 확인 경로에서 목표가 KIS 주문을 우회 생성하지 않는다.
  if (buyOrder.liveOrderEnabled && !isGlobalLiveOrderEnabled()) return null;
  const strategy = repo.getStrategy(userId, buyOrder.strategyId, { includeDeleted: true });
  if (!strategy) return null;
  const entryWindow = buyOrder.entryWindow || strategy.holdingEntryWindow || 'MORNING';
  const existing = repo.getActiveSellOrder({
    strategyId: strategy.id,
    entryWindow,
    symbol: buyOrder.symbol,
    sellReason: 'TARGET'
  });
  if (existing) return existing;

  let quantity = buyOrder.liveOrderEnabled
    ? getConfirmedOrderFilledQuantity(buyOrder)
    : Math.floor(Number(buyOrder.filledQuantity || buyOrder.quantity || 0));
  if (buyOrder.liveOrderEnabled) {
    quantity = Math.min(quantity, getKrManagedRemainingQuantity(buyOrder, buyOrder.entryId));
  }
  const averageFilledPrice = Number(buyOrder.averageFilledPrice || buyOrder.orderPrice || 0);
  if (quantity <= 0 || averageFilledPrice <= 0) return null;
  const targetProfitRate = entryWindow === 'LUNCH'
    ? strategy.lunchTargetProfitRate
    : strategy.morningTargetProfitRate;
  const targetPrice = Math.ceil(averageFilledPrice * (1 + Number(targetProfitRate || 0)));
  const entry = buyOrder.entryId ? repo.getEntryById(buyOrder.entryId) : null;
  const idempotencyKey = `${makeKrRankIdempotencyKey({
    tradeDate: entry?.tradeDate || kstToday(),
    strategyId: strategy.id,
    entryWindow,
    side: 'SELL'
  })}-TARGET`;
  if (repo.hasNonFailedOrder(idempotencyKey)) return null;

  const baseOrder = {
    strategyId: strategy.id,
    entryId: buyOrder.entryId,
    symbol: buyOrder.symbol,
    symbolName: buyOrder.symbolName || strategy.holdingSymbolName,
    side: 'SELL',
    entryWindow,
    sellReason: 'TARGET',
    quantity,
    orderPrice: targetPrice,
    estimatedAmount: quantity * targetPrice,
    idempotencyKey,
    liveOrderEnabled: buyOrder.liveOrderEnabled,
    orderType: 'LIMIT'
  };
  const decisionReason = `${buyOrder.symbol} 매수 체결 확인 후 목표 수익 지정가 매도 예약 (${fmt(targetPrice)}원).`;
  if (!buyOrder.liveOrderEnabled) {
    return repo.createOrder(userId, {
      ...baseOrder,
      status: 'DECIDED',
      decisionReason,
      requestPayloadMasked: maskPayload({ ...baseOrder, market: 'KR', currency: 'KRW', decisionReason })
    });
  }
  const [balance, openOrders] = await Promise.all([
    limitedKisCall(userId, `kr-target-balance:${buyOrder.symbol}`, () => (
      trading.getBalance(buyOrder.symbol, { market: 'KR', currency: 'KRW' })
    )),
    safeOpenOrders(userId, trading, buyOrder.symbol)
  ]);
  const holdingQuantity = Math.floor(Number(balance.quantity || 0));
  quantity = Math.min(quantity, holdingQuantity);
  const guard = checkOrderSafety({
    side: 'SELL', quantity, openOrders, idempotencyKey, holdingQuantity
  });
  if (!guard.ok) return null;
  baseOrder.quantity = quantity;
  baseOrder.estimatedAmount = quantity * targetPrice;
  return placeOrder(userId, trading, baseOrder, {
    liveOrderEnabled: true,
    decisionReason
  });
}

function getConfirmedOrderFilledQuantity(order) {
  if (!order) return 0;
  const ordered = Math.max(0, Math.floor(Number(order.quantity || 0)));
  const reportedFilled = Math.max(0, Math.floor(Number(order.filledQuantity || 0)));
  if (reportedFilled > 0) return ordered > 0 ? Math.min(reportedFilled, ordered) : reportedFilled;
  // KIS 주문 이력이 FILLED를 명시했다면 주문 수량 전부가 체결된 것으로 볼 수 있다. ACCEPTED와
  // 잔고만으로는 체결을 추정하지 않는다.
  return order.status === 'FILLED' ? ordered : 0;
}

function mergeMonotonicFilledQuantity(order, reportedFilledQuantity) {
  const previous = Math.max(0, Math.floor(Number(order?.filledQuantity || 0)));
  const reported = Math.max(0, Math.floor(Number(reportedFilledQuantity || 0)));
  const ordered = Math.max(0, Math.floor(Number(order?.quantity || 0)));
  const merged = Math.max(previous, reported);
  const capped = ordered > 0 ? Math.min(merged, ordered) : merged;
  return capped > 0 ? capped : (order?.filledQuantity ?? null);
}

function mergeMonotonicAverageFilledPrice(order, reportedFilledQuantity, reportedAverageFilledPrice) {
  const previousQuantity = Math.max(0, Math.floor(Number(order?.filledQuantity || 0)));
  const reportedQuantity = Math.max(0, Math.floor(Number(reportedFilledQuantity || 0)));
  const reportedPrice = Number(reportedAverageFilledPrice || 0);
  if (reportedPrice <= 0 || reportedQuantity < previousQuantity) {
    return order?.averageFilledPrice ?? null;
  }
  return reportedPrice;
}

function getKrManagedRemainingQuantity(buyOrder, entryId = null) {
  const bought = getConfirmedOrderFilledQuantity(buyOrder);
  if (bought <= 0) return 0;
  const resolvedEntryId = entryId ?? buyOrder?.entryId ?? null;
  const sold = repo.getLiveFilledSellQuantityForEntry(resolvedEntryId);
  return Math.max(0, bought - sold);
}

async function cancelKrOrderAndConfirm(userId, trading, order) {
  if (!order) return { ok: true, reason: '' };
  if (!order.liveOrderEnabled || order.status === 'DECIDED' || order.status === 'DRY_RUN') {
    repo.updateOrder(userId, order.id, { status: 'CANCELED' });
    return { ok: true, reason: '기존 예정 주문 기록을 취소했습니다.', order: repo.getOrder(userId, order.id) };
  }
  if (!order.kisOrderNo) {
    return { ok: false, reason: 'KIS 주문번호가 없어 주문 취소를 확인할 수 없습니다.' };
  }
  if (!isGlobalLiveOrderEnabled()) {
    return { ok: false, reason: '전역 실주문 중지 상태라 기존 주문을 취소하지 않았습니다.' };
  }
  try {
    await limitedKisCall(userId, `kr-cancel-order:${order.symbol}:${order.kisOrderNo}`, () => (
      trading.cancelOpenOrder({
        market: 'KR',
        symbol: order.symbol,
        kisOrderNo: order.kisOrderNo,
        kisOriginalOrderNo: order.kisOriginalOrderNo,
        quantity: order.quantity,
        remainingQuantity: order.remainingQuantity ?? order.quantity
      })
    ));
    // 취소 API rt_cd=0은 문서상 "주문 전송 완료"일 뿐 취소 체결이 아니다. 주문 이력의
    // CANCELED/REJECTED를 다시 확인해야 새 매도로 넘어갈 수 있다.
    const refreshed = await tryRefreshKrOrderState(userId, trading, order);
    if (refreshed?.status === 'CANCELED' || refreshed?.status === 'REJECTED') {
      return { ok: true, reason: '기존 주문 취소가 확인됐습니다.', order: refreshed };
    }
    if (refreshed?.status === 'FILLED') {
      return { ok: false, reason: '취소 확인 중 기존 주문 체결이 확인되어 후속 주문을 만들지 않습니다.', order: refreshed };
    }
    return {
      ok: false,
      reason: 'KIS 취소 요청은 접수됐지만 주문 이력에서 취소 완료가 아직 확인되지 않았습니다.',
      order: refreshed || order
    };
  } catch (error) {
    return { ok: false, reason: error.message || '취소 요청 실패' };
  }
}

// ── 안전 검증 (autoTradingSafetyGuard 와 동등, kr_rank_orders 기준 중복 검사) ──

function checkOrderSafety({
  side, quantity, openOrders, idempotencyKey,
  cashAvailable = 0, estimatedAmount = 0, holdingQuantity = 0
}) {
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return { ok: false, reason: '주문 수량이 0이라 주문하지 않습니다.' };
  }
  if (!Array.isArray(openOrders)) {
    return { ok: false, reason: '미체결 주문을 확인하지 못해 안전상 주문하지 않습니다.' };
  }
  if (openOrders.length > 0) {
    // KIS 미체결 목록 기준. DB 주문 상태는 시장가 체결 후에도 ACCEPTED로 남을 수 있어 쓰지 않는다.
    return { ok: false, reason: '미체결 주문이 있어 신규 주문을 만들지 않습니다.' };
  }
  if (repo.hasNonFailedOrder(idempotencyKey)) {
    return { ok: false, reason: '같은 주문이 이미 접수돼 있습니다.' };
  }
  if (side === 'BUY' && cashAvailable < estimatedAmount) {
    return { ok: false, reason: `매수가능금액이 부족합니다. 필요 ${fmt(estimatedAmount)}원, 가능 ${fmt(cashAvailable)}원.` };
  }
  if (side === 'SELL' && holdingQuantity < quantity) {
    return { ok: false, reason: `보유 수량이 부족합니다. 필요 ${quantity}주, 보유 ${holdingQuantity}주.` };
  }
  return { ok: true };
}

// ── 헬퍼 ──────────────────────────────────────────────────────────────────

// 판단 로그 저장과 전략의 최근 평가 상태 갱신을 한곳에서 처리한다.
// scheduled idle/no-op SKIP은 호출부에서 noLog=true로 넘겨 로그 노이즈를 억제하고,
// 후보 탐색 후 매수 대상이 없어 끝난 SKIP은 로그를 남겨 알고리즘 판단 근거를 볼 수 있게 한다.
function saveDecision(userId, strategy, input) {
  const evaluationSource = input.evaluationSource || 'SCHEDULED';
  const decision = input.decision;
  if (decision === 'SKIP' && evaluationSource !== 'MANUAL') {
    // 스케줄러 idle SKIP: last_decision은 보존하고 평가 시각만 갱신.
    repo.touchEvaluation(userId, strategy.id);
  } else {
    repo.markEvaluation(userId, strategy.id, {
      decision,
      errorMessage: decision === 'ERROR' ? input.reason : null
    });
  }
  const log = input.noLog
    ? null
    : repo.createDecisionLog(userId, { strategyId: strategy.id, ...input });
  const order = input.orderId ? repo.getOrder(userId, input.orderId) : null;
  return { strategy: repo.getStrategy(userId, strategy.id), decision: log, order };
}

function saveSkip(userId, strategy, reason, evaluationSource, { noLog = false } = {}) {
  const liveOrderEnabled = resolveLiveOrderEnabled(userId);
  return saveDecision(userId, strategy, { decision: 'SKIP', liveOrderEnabled, evaluationSource, reason, noLog });
}

async function limitedKisCall(userId, cacheKey, fn, { cacheTtlMs = 0 } = {}) {
  const state = kisCallState(userId);
  const effectiveCacheTtlMs = isDateMockedForTest() ? 0 : cacheTtlMs;
  const now = Date.now();
  const cached = effectiveCacheTtlMs > 0 ? state.cache.get(cacheKey) : null;
  if (cached && cached.expiresAt > now) return cached.value;

  const run = async () => {
    const rerunNow = Date.now();
    const rerunCached = effectiveCacheTtlMs > 0 ? state.cache.get(cacheKey) : null;
    if (rerunCached && rerunCached.expiresAt > rerunNow) return rerunCached.value;

    const dateMocked = isDateMockedForTest();
    const minIntervalMs = dateMocked ? 0 : KIS_CALL_MIN_INTERVAL_MS;
    const waitMs = dateMocked ? 0 : Math.max(0, state.nextAvailableAt - rerunNow, state.backoffUntil - rerunNow);
    if (waitMs > 0) await sleep(waitMs);
    state.nextAvailableAt = dateMocked ? 0 : Date.now() + minIntervalMs;

    try {
      const value = await fn();
      if (effectiveCacheTtlMs > 0) {
        state.cache.set(cacheKey, { value, expiresAt: Date.now() + effectiveCacheTtlMs });
      }
      return value;
    } catch (error) {
      if (isKisRateLimitError(error)) {
        state.backoffUntil = Date.now() + KIS_RATE_LIMIT_BACKOFF_MS;
      }
      throw error;
    }
  };

  const queued = state.queue.then(run, run);
  state.queue = queued.catch(() => {});
  return queued;
}

function kisCallState(userId) {
  const key = String(userId);
  let state = krKisCallStates.get(key);
  if (!state) {
    state = {
      queue: Promise.resolve(),
      nextAvailableAt: 0,
      backoffUntil: 0,
      cache: new Map()
    };
    krKisCallStates.set(key, state);
  }
  return state;
}

function isKisRateLimitError(error) {
  return /EGW00215|초당 거래건수|rate limit/i.test(String(error?.message || error || ''));
}

function isDateMockedForTest() {
  return globalThis.Date?.name === 'FakeDate';
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function safeOpenOrders(userId, trading, symbol) {
  try {
    return await limitedKisCall(userId, `kr-open-orders:${symbol}`, () => (
      trading.getOpenOrders(symbol, { market: 'KR', currency: 'KRW' })
    ));
  } catch {
    // 조회 실패는 "미체결 없음"이 아니다. 호출부의 안전 검증이 이번 주문을 막도록 null을 돌린다.
    return null;
  }
}

function excludeKnownTargetOrder(openOrders, targetOrder) {
  if (!Array.isArray(openOrders) || !targetOrder) return openOrders;
  const targetOrderNo = String(targetOrder.kisOrderNo || '').trim();
  if (!targetOrderNo) return openOrders;
  return openOrders.filter((row) => {
    const rowOrderNo = String(row?.orderNo || '').trim();
    return rowOrderNo !== targetOrderNo;
  });
}

// 상위 후보를 순서대로 보면서 매수 필터(시가·VWAP·거래량·장대 음봉·고점 돌파)를 적용한다.
// 통과 후보 중 점수가 가장 높은 후보를 picked로 반환한다. 모두 거절되면 picked=null과 거절 사유 목록을 함께 돌려준다.
// 분봉 조회가 실패한 후보는 단기 흐름 확인 불가로 보수적으로 건너뛴다.
async function pickFirstFilteredCandidate(userId, candidates, { trading = null, strategy = null, entryWindow = null } = {}) {
  const rejections = [];
  const accepted = [];
  for (const candidate of candidates) {
    let candles = [];
    try {
      candles = await getDomesticTodayMinuteCandles(userId, candidate.symbol);
    } catch (error) {
      rejections.push({ symbol: candidate.symbol, name: candidate.name, reason: `분봉 조회 실패(${error.message || '알 수 없음'})` });
      continue;
    }
    const check = checkBuyCandidate(candles, { candidate, entryWindow });
    if (!check.ok) {
      rejections.push({ symbol: candidate.symbol, name: candidate.name, reason: check.reason });
      continue;
    }
    accepted.push({
      picked: candidate,
      score: (check.score ?? 0) + (Number(candidate.observationScore) || 0),
      referencePrice: check.referencePrice ?? 0,
      rejections
    });
  }
  accepted.sort((a, b) => b.score - a.score);
  if (!trading || !strategy || !entryWindow) {
    return accepted[0] || { picked: null, rejections };
  }
  for (const result of accepted) {
    let buyPlan;
    try {
      buyPlan = await buildKrBuyPlan(trading, strategy, entryWindow, result.picked);
    } catch (error) {
      rejections.push({ symbol: result.picked.symbol, name: result.picked.name, reason: `매수가능금액 확인 실패(${error.message || '알 수 없음'})` });
      continue;
    }
    if (buyPlan.quantity <= 0) {
      const budgetNote = strategy.autoBudgetEnabled
        ? `매수가능금액 ${fmt(buyPlan.cashAvailable)}원`
        : `매수 금액 한도 ${fmt(buyPlan.entryBudget)}원·매수가능금액 ${fmt(buyPlan.cashAvailable)}원`;
      rejections.push({
        symbol: result.picked.symbol,
        name: result.picked.name,
        reason: `${budgetNote}으로 ${fmt(buyPlan.marginPrice)}원 기준 1주도 살 수 없음`
      });
      continue;
    }
    // 진입 슬리피지 가드: 필터가 승인한 신호가 대비 실시간 현재가가 너무 올랐으면 추격하지 않는다.
    const referencePrice = Number(result.referencePrice) || 0;
    if (referencePrice > 0 && buyPlan.currentPrice > referencePrice * (1 + ENTRY_MAX_SLIPPAGE_RATE)) {
      const slippage = (buyPlan.currentPrice - referencePrice) / referencePrice;
      rejections.push({
        symbol: result.picked.symbol,
        name: result.picked.name,
        reason: `신호가 ${fmt(referencePrice)}원 대비 현재가 ${fmt(buyPlan.currentPrice)}원으로 ${(slippage * 100).toFixed(1)}% 급등해 추격 매수를 보류함`
      });
      continue;
    }
    if (referencePrice > 0 && buyPlan.currentPrice < referencePrice * (1 - ENTRY_MAX_ADVERSE_MOVE_RATE)) {
      const adverseMove = (referencePrice - buyPlan.currentPrice) / referencePrice;
      rejections.push({
        symbol: result.picked.symbol,
        name: result.picked.name,
        reason: `신호가 ${fmt(referencePrice)}원 대비 현재가 ${fmt(buyPlan.currentPrice)}원으로 ${(adverseMove * 100).toFixed(1)}% 급락해 모멘텀이 무효화됨`
      });
      continue;
    }
    return { ...result, buyPlan, rejections };
  }
  return { picked: null, rejections };
}

async function buildKrBuyPlan(trading, strategy, entryWindow, candidate) {
  const [priceQuote, buyingPower] = await Promise.all([
    limitedKisCall(strategy.userId, `kr-current-price:${candidate.symbol}`, () => (
      trading.getCurrentPrice(candidate.symbol, { market: 'KR' })
    )),
    limitedKisCall(strategy.userId, `kr-buying-power:${candidate.symbol}:${Math.round(Number(candidate.price) || 0)}`, () => (
      trading.getBuyingPower(candidate.symbol, { market: 'KR', currency: 'KRW', price: candidate.price })
    ), { cacheTtlMs: KIS_BUYING_POWER_CACHE_TTL_MS })
  ]);
  const currentPrice = Number(priceQuote.price) || Number(candidate.price) || 0;
  const marginPrice = Number(priceQuote.upperLimitPrice) > 0
    ? Number(priceQuote.upperLimitPrice)
    : currentPrice * PRICE_LIMIT_MULTIPLIER;
  const cashAvailable = Number(buyingPower.cashAvailable || 0);
  const entryBudget = strategy.autoBudgetEnabled
    ? cashAvailable
    : (entryWindow === 'LUNCH' ? strategy.lunchBudget : strategy.morningBudget);
  const quantity = computeBuyQuantity(Math.min(entryBudget, cashAvailable), marginPrice);
  return {
    currentPrice,
    marginPrice,
    cashAvailable,
    entryBudget,
    quantity,
    estimatedAmount: quantity * currentPrice
  };
}

// 보유 종목 때문에 신규 진입이 차단되는 상황을 사유에 명시한다.
// 지금이 어떤 진입 구간이고, 그 구간에 대한 오늘의 진입 기록이 아직 없으면
// "다른 매수분 보유 중이라 이번 구간 진입을 건너뜁니다" 메모를 돌려준다.
// 같은 구간이라도 오늘 새 진입을 못 하는 경우(예: 어제 매수분 오버나잇 보유)도 포함된다.
function describeBlockedEntryWindow(strategy, holdingEntryWindow, symbol) {
  const currentWindow = resolveEntryWindow(new Date(), { lunchEntryEnabled: strategy.lunchEntryEnabled });
  if (!currentWindow) return '';
  const todayEntry = repo.getEntry(strategy.id, kstToday(), currentWindow);
  if (todayEntry) return '';
  const currentLabel = ENTRY_WINDOWS[currentWindow].label;
  const holdingLabel = ENTRY_WINDOWS[holdingEntryWindow].label;
  return ` 지금은 ${currentLabel} 진입 구간이지만 ${holdingLabel} 매수분(${symbol}) 보유 중이라 ${currentLabel} 진입을 건너뜁니다.`;
}

function findCurrentEntryId(strategy, entryWindow, symbol) {
  const entry = repo.getEntry(strategy.id, kstToday(), entryWindow)
    || repo.getLatestBoughtEntry(strategy.id, entryWindow, symbol);
  if (!entry || entry.selectedSymbol !== symbol) return null;
  return entry.id;
}

function orderStatusNote(order, liveOrderEnabled) {
  if (order.status === 'FAILED' || order.status === 'REJECTED') {
    return `주문 실패: ${order.errorMessage || '거절됨'} 다음 평가에서 안전 조건을 다시 확인합니다.`;
  }
  if (order.status === 'UNKNOWN' || order.status === 'REQUESTED') {
    return 'KIS 주문 전송 결과가 불명확해 자동 재전송을 막았습니다. 계좌 주문 내역을 확인하세요.';
  }
  if (!liveOrderEnabled || order.status === 'DRY_RUN') {
    return '실주문 실행 설정이 꺼져 있어 실제 주문 없이 기록만 저장했습니다.';
  }
  return 'KIS에 주문을 전송했습니다.';
}

function normalizeStrategyInput(input = {}) {
  const lunchEntryEnabled = input.lunchEntryEnabled === true;
  const autoBudgetEnabled = input.autoBudgetEnabled === true;
  // 자동 예산 모드면 매수 금액은 평가 시점 KIS 매수가능금액을 그대로 쓰므로 입력값을 검증하지 않고 0으로 저장한다.
  const morningBudget = autoBudgetEnabled ? 0 : positiveNumber(input.morningBudget, '오전 매수 금액');
  const morningTargetProfitRate = positiveNumber(input.morningTargetProfitRate, '오전 목표 수익률');
  const morningStopLossRate = positiveNumber(input.morningStopLossRate, '오전 손절 기준');
  // 오전 진입 구간(09:10) 이전 시각으로 청산을 잡으면 매수 직후 즉시 청산되어 의미 없는 거래가 된다.
  const morningLiquidateTime = optionalHhmm(
    input.morningLiquidateTime, '오전 청산 시각',
    { afterMinutes: ENTRY_WINDOWS.MORNING.startMinutes, afterLabel: '오전 진입 시각(09:10)' }
  );

  // 점심 진입을 켜면 하루 두 번 매수하므로 점심 매수 금액·목표 수익률·손절 기준을 따로 입력받는다.
  // 점심 진입이 꺼져 있으면 lunch_* 값은 사용하지 않으므로 오전 값으로 채워 둔다.
  let lunchBudget = 0;
  let lunchTargetProfitRate = morningTargetProfitRate;
  let lunchStopLossRate = morningStopLossRate;
  let lunchLiquidateTime = null;
  if (lunchEntryEnabled) {
    lunchBudget = autoBudgetEnabled ? 0 : positiveNumber(input.lunchBudget, '점심 매수 금액');
    lunchTargetProfitRate = positiveNumber(input.lunchTargetProfitRate, '점심 목표 수익률');
    lunchStopLossRate = positiveNumber(input.lunchStopLossRate, '점심 손절 기준');
    // 점심 진입 시각(11:30) 이전 시각으로 청산을 잡으면 점심 매수 직후 즉시 청산된다.
    lunchLiquidateTime = optionalHhmm(
      input.lunchLiquidateTime, '점심 청산 시각',
      { afterMinutes: ENTRY_WINDOWS.LUNCH.startMinutes, afterLabel: '점심 진입 시각(11:30)' }
    );
  }
  return {
    morningBudget, morningTargetProfitRate, morningStopLossRate, morningLiquidateTime,
    lunchEntryEnabled, lunchBudget, lunchTargetProfitRate, lunchStopLossRate, lunchLiquidateTime,
    autoBudgetEnabled
  };
}

function positiveNumber(value, label) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw badRequest(`${label}은(는) 0보다 커야 합니다.`);
  return n;
}

// 'HH:MM' KST 24시간 표기 검증. 빈 값/null이면 청산 시각을 쓰지 않는다는 뜻으로 null 반환.
// afterMinutes를 주면 그 시각보다 뒤여야 한다(매수 직후 즉시 청산 footgun 차단).
function optionalHhmm(value, label, { afterMinutes = null, afterLabel = null } = {}) {
  if (value == null || value === '') return null;
  const minutes = parseHhmmMinutes(value);
  if (minutes == null) throw badRequest(`${label}은(는) 'HH:MM' 24시간 표기여야 합니다 (예: 14:30).`);
  if (afterMinutes != null && minutes <= afterMinutes) {
    throw badRequest(`${label}은(는) ${afterLabel} 이후여야 합니다. 그 이전이면 매수 직후 즉시 청산됩니다.`);
  }
  return value;
}

function resolveLiveOrderEnabled(userId) {
  return autoTradingRepo.getSettings(userId).liveOrderEnabled && isGlobalLiveOrderEnabled();
}

function isGlobalLiveOrderEnabled() {
  return env.enableLiveOrder === 'true';
}

function requireStrategy(userId, id, { includeDeleted = false } = {}) {
  const strategy = repo.getStrategy(userId, Number(id), { includeDeleted });
  if (!strategy) throw notFound('한국 랭킹 전략을 찾을 수 없습니다.');
  return strategy;
}

function isKrMarketOpen() {
  const kst = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  const day = kst.getDay();
  if (day === 0 || day === 6) return false;
  const minutes = kst.getHours() * 60 + kst.getMinutes();
  return minutes >= 9 * 60 && minutes <= 15 * 60 + 30;
}

// 휴장일 판정 결과는 시장 전체에 공통이라 날짜별로 1회만 KIS에 묻고 프로세스 캐시에 담는다
// (KIS 안내: 국내휴장일조회는 1일 1회 호출 권장). 평일·장중에만 호출되므로 호출량이 적다.
let krTradingDayCache = { date: null, isOpen: null };

async function isKrTradingDay(userId) {
  const today = kstYyyymmdd();
  if (krTradingDayCache.date === today && krTradingDayCache.isOpen !== null) {
    return krTradingDayCache.isOpen;
  }
  try {
    const holidays = await getDomesticHolidays(userId, today);
    const todayEntry = holidays.find((row) => row.date === today);
    // 응답에 오늘이 없으면 보수적으로 개장일로 간주해 기존 동작(평일·시간 체크)에 맡긴다.
    const isOpen = todayEntry ? todayEntry.isOpen : true;
    krTradingDayCache = { date: today, isOpen };
    return isOpen;
  } catch {
    // 휴장일 API 실패는 평가를 막지 않는다. 평일·시간 체크에 위임(개장일로 간주)하고 다음 tick에 재시도.
    return true;
  }
}

function kstYyyymmdd() {
  return kstToday().replace(/-/g, '');
}

function kstToday() {
  const kst = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  const y = kst.getFullYear();
  const m = String(kst.getMonth() + 1).padStart(2, '0');
  const d = String(kst.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// KST 기준 오늘로부터 days일 이전 날짜(YYYY-MM-DD).
function kstDateBefore(days) {
  const kst = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  kst.setDate(kst.getDate() - days);
  const y = kst.getFullYear();
  const m = String(kst.getMonth() + 1).padStart(2, '0');
  const d = String(kst.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// 관찰 스냅샷 보존 정리. 매 tick 호출되지만 하루 한 번만 실제로 DELETE 한다.
let lastObservationPruneDate = null;
function pruneOldObservationsOncePerDay() {
  const today = kstToday();
  if (lastObservationPruneDate === today) return;
  lastObservationPruneDate = today;
  try {
    repo.deleteObservationsBefore(kstDateBefore(OBSERVATION_RETENTION_DAYS));
  } catch {
    // 정리 실패는 매매에 영향을 주지 않으므로 무시한다(다음 날 다시 시도).
  }
}

function fmt(value) {
  return Number(value || 0).toLocaleString('ko-KR', { maximumFractionDigits: 0 });
}

function minutesSinceSqliteTimestamp(value, now = new Date()) {
  if (!value) return null;
  const normalized = String(value).trim().replace(' ', 'T');
  const time = Date.parse(normalized.endsWith('Z') ? normalized : `${normalized}Z`);
  if (!Number.isFinite(time)) return null;
  return Math.max(0, (now.getTime() - time) / 60000);
}

function sqliteUtcToMs(value) {
  if (!value) return 0;
  const normalized = String(value).trim().replace(' ', 'T');
  const time = Date.parse(normalized.endsWith('Z') ? normalized : `${normalized}Z`);
  return Number.isFinite(time) ? time : 0;
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
