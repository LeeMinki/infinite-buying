import assert from 'node:assert/strict';
import test from 'node:test';
import { createKisRequestQueue } from '../src/services/kisRequestQueue.js';

test('같은 App Key는 호출·실패·재호출 모두 최소 간격을 공유한다', async () => {
  let clock = 0;
  const starts = [];
  const run = createKisRequestQueue({ now: () => clock, sleep: async (ms) => { clock += ms; } });
  const context = { baseUrl: 'https://example.invalid', appKey: 'fake-key' };
  const outcomes = await Promise.allSettled([
    run(context, () => { starts.push(clock); return 'quote'; }),
    run({ ...context }, () => { starts.push(clock); throw new Error('rate limited'); }),
    run(context, () => { starts.push(clock); return 'history'; })
  ]);
  assert.deepEqual(starts, [0, 220, 440]);
  assert.deepEqual(outcomes.map((outcome) => outcome.status), ['fulfilled', 'rejected', 'fulfilled']);
});

test('서로 다른 App Key는 다른 계정의 느린 응답을 기다리지 않는다', async () => {
  const run = createKisRequestQueue();
  let finishSlow;
  const slow = run({ baseUrl: 'https://example.invalid', appKey: 'slow' }, () => new Promise((resolve) => { finishSlow = resolve; }));
  await Promise.resolve();
  assert.equal(await run({ baseUrl: 'https://example.invalid', appKey: 'fast' }, () => 'done'), 'done');
  finishSlow('finished');
  assert.equal(await slow, 'finished');
});
