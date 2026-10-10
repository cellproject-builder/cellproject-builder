import test from 'node:test';
import assert from 'node:assert/strict';
import { runPlannerGatewayLoad } from './planner-load.mjs';

test('real loopback HTTP bursts retain admission, association and recovery at 20 and 50 clients', async () => {
  const report = await runPlannerGatewayLoad({ concurrencies: [20, 50] });
  assert.equal(report.scenarios.length, 11);
  assert.equal(report.externalNetworkRequests, 0);
  for (const scenario of report.scenarios) {
    assert.equal(scenario.passed, true, scenario.name);
    assert.ok(scenario.httpAttempts > 0, scenario.name);
    assert.ok(scenario.latencyMs.all.p95 >= 0, scenario.name);
    assert.ok(scenario.checks.length >= 3, scenario.name);
  }
  const mixed = report.scenarios.filter(scenario => scenario.name.startsWith('mixed-burst-'));
  assert.deepEqual(mixed.map(scenario => scenario.concurrency), [20, 50]);
  for (const scenario of mixed) {
    assert.equal(scenario.admitted, 12);
    assert.equal(scenario.statuses['429'], scenario.concurrency - 12);
    assert.deepEqual(scenario.peakUpstreamActive, { planning: 6, intake: 2, persistence: 4 });
  }
  const stream = report.scenarios.find(scenario => scenario.name === 'stream-cancel-recovery');
  assert.equal(stream.upstreamAborts, 2);
  assert.equal(stream.recoveryAdmitted, 6);
  assert.equal(stream.peakUpstreamActive.planning, 6);
  const recovery = report.scenarios.find(scenario => scenario.name === 'failure-and-auth-recovery');
  assert.equal(recovery.recoveryAdmitted, 12);
  assert.equal(recovery.retryBodiesPreserved, true);
  const retry = report.scenarios.find(scenario => scenario.name === 'ambiguous-write-retry');
  assert.equal(retry.committedEffects, 1);
  assert.equal(retry.explicitClientRetries, 1);
  assert.equal(retry.statuses['409'], 1);
});

test('the HTTP harness rejects a deliberately misassociated planning response', async () => {
  await assert.rejects(
    runPlannerGatewayLoad({ concurrencies: [20], onlyMixed: true, fixtureFault: 'wrong-ai-marker' }),
    /Planning response association/,
  );
});
