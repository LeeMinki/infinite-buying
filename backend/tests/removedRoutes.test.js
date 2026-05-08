import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

test('removed historical validation routes are not mounted', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const appPath = path.resolve(here, '..', 'src', 'app.js');
  const content = fs.readFileSync(appPath, 'utf8');
  assert.equal(content.includes('/api/simulations'), false);
  assert.equal(content.includes('/api/trading-modes'), false);
});
