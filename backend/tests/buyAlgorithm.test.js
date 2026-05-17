import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveBigBuyPremiumRate } from '../src/services/buyAlgorithm.js';

test('resolveBigBuyPremiumRate uses fixed 0.1 when omitted', () => {
  assert.equal(resolveBigBuyPremiumRate({ splitCount: 40 }), 0.1);
});

test('resolveBigBuyPremiumRate default is independent of splitCount', () => {
  assert.equal(resolveBigBuyPremiumRate({ splitCount: 10 }), 0.1);
  assert.equal(resolveBigBuyPremiumRate({ splitCount: 200 }), 0.1);
});

test('resolveBigBuyPremiumRate keeps explicit override', () => {
  assert.equal(resolveBigBuyPremiumRate({ splitCount: 40, override: 0.05 }), 0.05);
});
