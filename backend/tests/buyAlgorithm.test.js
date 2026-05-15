import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveBigBuyPremiumRate } from '../src/services/buyAlgorithm.js';

test('resolveBigBuyPremiumRate uses 0.1 / splitCount when omitted', () => {
  assert.equal(resolveBigBuyPremiumRate({ splitCount: 40 }), 0.0025);
});

test('resolveBigBuyPremiumRate keeps explicit override', () => {
  assert.equal(resolveBigBuyPremiumRate({ splitCount: 40, override: 0.05 }), 0.05);
});
