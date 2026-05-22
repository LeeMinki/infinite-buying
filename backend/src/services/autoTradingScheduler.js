import { env } from '../config/env.js';
import { evaluateRunningStrategies } from './autoTradingService.js';
import { evaluateRunningStrategies as evaluateRunningKrRankStrategies } from './krRankService.js';
import { evaluateRunningStrategies as evaluateRunningUsRankStrategies } from './usRankService.js';

// 라오어 무한매수법은 기본 10분 간격, 랭킹 전략은 진입·청산 시각을 놓치지 않도록 짧은 간격으로 평가한다.
// 각 스케줄러는 별도 타이머로 독립 동작한다.
let laorTimer = null;
let krRankTimer = null;
let usRankTimer = null;
let laorRunning = false;
let krRankRunning = false;
let usRankRunning = false;

export function startAutoTradingScheduler() {
  if (!env.autoTradingSchedulerEnabled) return;
  if (!laorTimer) {
    const interval = Math.max(10_000, env.autoTradingSchedulerIntervalMs);
    laorTimer = setInterval(laorTick, interval);
    laorTimer.unref?.();
  }
  if (!krRankTimer) {
    const interval = Math.max(10_000, env.krRankSchedulerIntervalMs);
    krRankTimer = setInterval(krRankTick, interval);
    krRankTimer.unref?.();
  }
  if (!usRankTimer) {
    const interval = Math.max(10_000, env.usRankSchedulerIntervalMs);
    usRankTimer = setInterval(usRankTick, interval);
    usRankTimer.unref?.();
  }
}

export function stopAutoTradingScheduler() {
  if (laorTimer) clearInterval(laorTimer);
  if (krRankTimer) clearInterval(krRankTimer);
  if (usRankTimer) clearInterval(usRankTimer);
  laorTimer = null;
  krRankTimer = null;
  usRankTimer = null;
}

async function laorTick() {
  if (laorRunning) return;
  laorRunning = true;
  try {
    await evaluateRunningStrategies();
  } catch (error) {
    console.error('Auto trading scheduler failed:', error.message);
  } finally {
    laorRunning = false;
  }
}

async function krRankTick() {
  if (krRankRunning) return;
  krRankRunning = true;
  try {
    await evaluateRunningKrRankStrategies();
  } catch (error) {
    console.error('KR rank scheduler failed:', error.message);
  } finally {
    krRankRunning = false;
  }
}

async function usRankTick() {
  if (usRankRunning) return;
  usRankRunning = true;
  try {
    await evaluateRunningUsRankStrategies();
  } catch (error) {
    console.error('US rank scheduler failed:', error.message);
  } finally {
    usRankRunning = false;
  }
}
