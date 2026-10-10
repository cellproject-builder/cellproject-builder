import test from 'node:test';
import assert from 'node:assert/strict';
import { createLimits } from './limits.mjs';
test('resolution/review limits reject excess concurrency, requests, and expire without queuing', () => {
  let now = 0; const limits = createLimits(() => now);
  const a = limits.enter('review', 'a'), b = limits.enter('review', 'b');
  assert.throws(() => limits.enter('review', 'c')); a(); b();
  for (let i = 0; i < 6; i++) limits.enter('resolve', 'a')();
  assert.throws(() => limits.enter('resolve', 'a'));
  for (let i = 0; i < 6; i++) limits.enter('resolve', 'b')();
  assert.throws(() => limits.enter('resolve', 'c'));
  now = 60_000; assert.doesNotThrow(() => limits.enter('resolve', 'a')());
  for (let i = 0; i < 12; i++) limits.enter('media', 'a')();
});
