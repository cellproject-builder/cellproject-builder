import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const evidence = resolve(import.meta.dirname, '../../docs/design/pdf-performance');
const read = async name => JSON.parse(await readFile(resolve(evidence, name), 'utf8'));
const results = await read('browser-results.json');
for (const variant of ['baseline', 'candidate']) {
  assert.equal(results[variant].length, 18, `${variant}: three scenarios × two surfaces × three repetitions`);
  for (const surface of ['board', 'planner']) for (const scenario of ['tour', 'dense', 'release']) {
    const rows = results[variant].filter(row => row.surface === surface && row.scenario === scenario);
    assert.equal(rows.length, 3);
    for (const row of rows) {
      assert.equal(row.after.errors, 0); assert.equal(row.after.busy, 0);
      if (scenario === 'tour') for (const key of ['liveWorkers', 'canvases', 'busy', 'errors']) assert.equal(row.before[key], 0, `unclean initial ${key}`);
      if (scenario === 'dense') assert.equal(row.after.canvases, 30);
      if (variant === 'candidate') {
        assert(row.after.maxWorkers <= 2); assert.equal(row.after.liveWorkers, 0);
        if (scenario === 'release') assert.equal(row.after.rasterBytes, 0);
      }
    }
  }
}
const capacity = await read('browser-100-cards.json');
for (const surface of ['board', 'planner']) for (const scenario of ['dense', 'release']) {
  const row = capacity.find(item => item.surface === surface && item.scenario === scenario);
  assert(row); assert.equal(row.after.errors, 0); assert.equal(row.after.busy, 0);
  assert(row.after.maxWorkers <= 2); assert.equal(row.after.liveWorkers, 0);
  assert.equal(row.after.canvases, scenario === 'dense' ? 100 : 0);
  if (scenario === 'release') assert.equal(row.after.rasterBytes, 0);
}
const reader = await read('browser-reader.json');
for (const row of Object.values(reader)) { assert.equal(row.after.errors, 0); assert.equal(row.after.busy, 0); }
for (const key of ['minimized', 'closed']) { assert.equal(reader[key].after.liveWorkers, 0); assert.equal(reader[key].after.rasterBytes, 0); }
assert.equal(reader.restoredPage2.after.liveWorkers, 1); assert.equal(reader.restoredPage2.after.canvases, 1);
console.log('PDF evidence: 36 comparison samples, 4 capacity samples and 3 reader samples satisfy acceptance criteria.');
