import { env } from '../config/env.js';
import { evaluateRunningStrategies } from './autoTradingService.js';

let timer = null;
let running = false;

export function startAutoTradingScheduler() {
  if (!env.autoTradingSchedulerEnabled || timer) return;
  const interval = Math.max(10_000, env.autoTradingSchedulerIntervalMs);
  timer = setInterval(tick, interval);
  timer.unref?.();
}

export function stopAutoTradingScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}

async function tick() {
  if (running) return;
  running = true;
  try {
    await evaluateRunningStrategies();
  } catch (error) {
    console.error('Auto trading scheduler failed:', error.message);
  } finally {
    running = false;
  }
}
