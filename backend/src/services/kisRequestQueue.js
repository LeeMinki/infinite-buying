import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';

// 시세·계좌·주문·GET 재시도가 같은 App Key의 호출 예산을 공유한다.
// 계정 식별값은 보관하지 않고 해시만 큐 키로 사용한다. 서로 다른 키는 독립 진행한다.
export const KIS_MIN_INTERVAL_MS = 220;

export function createKisRequestQueue({
  minIntervalMs = KIS_MIN_INTERVAL_MS,
  now = () => performance.now(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
} = {}) {
  const queues = new Map();
  return function run(context, work) {
    const key = createHash('sha256')
      .update(`${context.baseUrl}\0${context.appKey}`)
      .digest('hex');
    let state = queues.get(key);
    if (!state) {
      state = { tail: Promise.resolve(), nextStart: 0 };
      queues.set(key, state);
    }
    const next = state.tail.then(async () => {
      const wait = state.nextStart - now();
      if (wait > 0) await sleep(wait);
      state.nextStart = now() + minIntervalMs;
      return work();
    });
    // 실패한 호출도 호출 간격을 소비하며 뒤따른 요청을 막지는 않는다.
    state.tail = next.then(() => undefined, () => undefined);
    return next;
  };
}

export const runKisRequest = createKisRequestQueue();
