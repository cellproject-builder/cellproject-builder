import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyPlanIntake } from './typesafe.mjs';
const input = { request: 'Adicione o controle descrito no arquivo', objective: 'Construir robô', nodes: [{ id: 'root', name: 'Robô', kind: 'root', parentId: null }], files: [{ id: 'f', name: 'control.ino', text: 'void setup() {}' }] };
const answer = { type: 'choice', choice: 'extend', confidence: .8, probabilities: { reference: .05, extend: .8, revise: .05, reorganize: .05, clarify: .05 } };
test('classifies plan intake with declared choices and preserves probability evidence', async () => {
  const result = await classifyPlanIntake(input, { key: 'secret', fetchImpl: async (_url, init) => {
    const body = JSON.parse(init.body);
    assert.equal(body.questions.plan_intent.type, 'choice');
    assert.deepEqual(Object.keys(body.questions.plan_intent.criteria), ['reference', 'extend', 'revise', 'reorganize', 'clarify']);
    assert.equal(body.state.files[0].text, 'void setup() {}');
    return new Response(JSON.stringify({ model: 'jev-latest', answers: { plan_intent: answer } }));
  } });
  assert.equal(result.choice, 'extend'); assert.equal(result.confidence, .8); assert.equal(result.probabilities.extend, .8);
});
test('rejects undeclared answers and invalid input before any provider call', async () => {
  await assert.rejects(classifyPlanIntake(input, { key: 'secret', fetchImpl: async () => new Response(JSON.stringify({ model: 'jev-latest', answers: { plan_intent: { ...answer, choice: 'delete_all' } } })) }), /invalid/);
  await assert.rejects(classifyPlanIntake({ ...input, files: [{ id: 'bad', name: 'x', text: 'x'.repeat(20_000) }] }, { key: 'secret', fetchImpl: () => assert.fail('Must validate first') }), /Invalid/);
  assert.equal(await classifyPlanIntake(input, {}), null);
});
