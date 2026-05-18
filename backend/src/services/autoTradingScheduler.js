import { env } from '../config/env.js';
import { evaluateRunningStrategies } from './autoTradingService.js';
import { evaluateRunningStrategies as evaluateRunningKrRankStrategies } from './krRankService.js';

// 라오어 무한매수법은 기본 10분 간격, 한국 국장 상승률 랭킹 전략은 진입 시각(09:10·11:30)을
// 놓치지 않도록 1분 간격으로 평가한다. 두 스케줄러는 별도 타이머로 독립 동작한다.
let laorTimer = null;
let krRankTimer = null;
let laorRunning = false;
let krRankRunning = false;

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
}

export function stopAutoTradingScheduler() {
  if (laorTimer) clearInterval(laorTimer);
  if (krRankTimer) clearInterval(krRankTimer);
  laorTimer = null;
  krRankTimer = null;
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
