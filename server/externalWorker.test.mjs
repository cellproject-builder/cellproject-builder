import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { runExternalOperation, getExternalCatalog } from './externalWorker.mjs';
import { buildExternalWorker } from '../scripts/build-external-worker.mjs';

before(async () => { await buildExternalWorker(); });

const empty = () => ({ documents: [{ key: 'dynamic_diary-chat', value: '{"keep":true}', revision: 8 }], media: [] });
const state = snapshot => JSON.parse(snapshot.documents.find(d => d.key === 'cellproject-workspace').value).state;
const run = (snapshot, name, input = {}, projectId, kind = 'action') => runExternalOperation({ snapshot, projectId, operation: { kind, name, input } });
async function project(snapshot = empty(), name = 'Robot') {
  const output = await run(snapshot, 'project.create', { name, objective: 'Test a premise' });
  return { snapshot: output.snapshot, id: output.result.id };
}
const suggested = (tempId = 'step') => ({ tempId, kind: 'passo', name: 'Measure', fx: '', problem: '', confidence: 50, confidenceReason: '', pros: [], cons: [], oQue: 'Measure torque', porQue: 'Check capability', comoConfirmar: 'A private AI criterion', order: 0 });
const plan = () => ({ id: 'external-plan', title: 'Robot plan', pitch: 'Measure first', approach: 'Start with a test', strategy: 'hibrido', archetype: 'construir', rank: 1, rankReason: 'Test early', tree: { categorias: [{ tempId: 'execution', name: 'Execution', kind: 'execucao', oQue: '', porQue: '', children: [suggested()] }] } });

test('catalog describes deterministic operations without internal AI generation', async () => {
  const catalog = await getExternalCatalog();
  assert.ok(catalog.length >= 55);
  for (const item of catalog) {
    assert.ok(item.inputSchema && ['read', 'write'].includes(item.permission));
    assert.equal(typeof item.projectRequired, 'boolean');
    assert.ok(!item.name.includes('generate'));
    assert.equal(item.inputSchema.type, 'object');
    assert.equal(item.inputSchema.additionalProperties, false);
  }
  const mutated = await getExternalCatalog(); mutated[0].name = 'changed';
  assert.notEqual((await getExternalCatalog())[0].name, 'changed');
});
test('worker mutations preserve unrelated encrypted document envelopes and revisions', async () => {
  const { snapshot, id } = await project();
  const output = await run(snapshot, 'task.create', { title: 'Test fit' }, id);
  assert.equal(state(output.snapshot).tasks[output.result.id].projectId, id);
  assert.deepEqual(output.snapshot.documents.find(d => d.key === 'dynamic_diary-chat'), empty().documents[0]);
  assert.equal(snapshot.documents.find(d => d.key === 'cellproject-workspace').revision, output.snapshot.documents.find(d => d.key === 'cellproject-workspace').revision);
});
test('strict schemas reject identity, evidence and history injection', async () => {
  const { snapshot, id } = await project();
  await assert.rejects(run(snapshot, 'task.create', { title: 'Bad', projectId: 'other' }, id), /invalid_input/);
  await assert.rejects(run(snapshot, 'plan.node.update', { nodeId: 'x', patch: { confirmado: true, history: [] } }, id), /invalid_input/);
});
test('project boundaries and real task date validation run through UI store', async () => {
  const a = await project(), b = await project(a.snapshot, 'Other');
  const created = await run(b.snapshot, 'task.create', { title: 'Scoped' }, a.id);
  await assert.rejects(run(created.snapshot, 'task.update', { id: created.result.id, patch: { title: 'Wrong project' } }, b.id), /project_scope/);
  await assert.rejects(run(created.snapshot, 'task.update', { id: created.result.id, patch: { dueDate: '2026-02-30' } }, a.id), /invalidDates/);
});
test('provider-free plan creation preserves evidence gates and hides unearned AI criteria', async () => {
  const p = await project();
  let out = await run(p.snapshot, 'plan.create', { plan: plan() }, p.id);
  const nodeId = Object.values(state(out.snapshot).projects[p.id].planner.project.nodes).find(n => n.kind === 'passo').id;
  const read = await run(out.snapshot, 'plan', {}, p.id, 'query');
  assert.equal(read.result.project.nodes[nodeId].comoConfirmar, '');
  out = await run(out.snapshot, 'plan.node.confirm', { nodeId }, p.id);
  assert.equal(state(out.snapshot).projects[p.id].planner.project.nodes[nodeId].state, 'validated');
  out = await run(out.snapshot, 'plan.criterion.set', { nodeId, text: 'Human criterion' }, p.id);
  out = await run(out.snapshot, 'plan.criterion.attest', { nodeId, observation: 'I measured 2 N' }, p.id);
  assert.equal(state(out.snapshot).projects[p.id].planner.project.nodes[nodeId].state, 'done');
  out = await run(out.snapshot, 'plan.failure.report', { nodeId, text: 'A physical failure' }, p.id);
  out = await run(out.snapshot, 'plan.node.confirm', { nodeId, force: true }, p.id);
  assert.notEqual(state(out.snapshot).projects[p.id].planner.project.nodes[nodeId].state, 'done');
});
test('inactive plan mutation preserves original active graph checkpoint byte for byte', async () => {
  const a = await project(), b = await project(a.snapshot, 'Other');
  const made = await run(b.snapshot, 'plan.create', { plan: plan() }, a.id);
  const workspace = state(made.snapshot), active = workspace.projects[a.id].planner;
  const graph = { key: 'cellproject-graph', value: JSON.stringify({ state: { ...active, plannerOwnerId: a.id }, version: 6 }), revision: 14 };
  const snapshot = { ...made.snapshot, documents: [...made.snapshot.documents.filter(d => d.key !== graph.key), graph] };
  const output = await run(snapshot, 'plan.create', { plan: plan() }, b.id);
  assert.deepEqual(output.snapshot.documents.find(d => d.key === graph.key), graph);
  assert.deepEqual(state(output.snapshot).projects[a.id], workspace.projects[a.id]);
  assert.ok(state(output.snapshot).projects[b.id].planner.project);
});
test('active plan mutation updates canonical workspace and graph together', async () => {
  const p = await project(), made = await run(p.snapshot, 'plan.create', { plan: plan() }, p.id);
  const active = state(made.snapshot).projects[p.id].planner;
  const graph = { key: 'cellproject-graph', value: JSON.stringify({ state: { ...active, plannerOwnerId: p.id }, version: 6 }), revision: 4 };
  const snapshot = { ...made.snapshot, documents: [...made.snapshot.documents.filter(d => d.key !== graph.key), graph] };
  const out = await run(snapshot, 'plan.rule.add', { text: 'Budget 100' }, p.id);
  const nextGraph = JSON.parse(out.snapshot.documents.find(d => d.key === graph.key).value).state;
  assert.deepEqual(nextGraph.project, state(out.snapshot).projects[p.id].planner.project);
  assert.deepEqual(nextGraph.project.rules, ['Budget 100']);
});
test('external decomposition stages before acceptance and failed actions are atomic', async () => {
  const p = await project(), made = await run(p.snapshot, 'plan.create', { plan: plan() }, p.id);
  const root = state(made.snapshot).projects[p.id].planner.project.rootId;
  const out = await run(made.snapshot, 'plan.stage', { parentId: root, nodes: [suggested('child')], edges: [] }, p.id);
  assert.equal(state(out.snapshot).projects[p.id].planner.pendingSuggestions.nodes.length, 1);
  const accepted = await run(out.snapshot, 'plan.suggestion.accept_all', {}, p.id);
  assert.equal(state(accepted.snapshot).projects[p.id].planner.pendingSuggestions, null);
  await assert.rejects(run(out.snapshot, 'plan.stage', { parentId: root, nodes: [suggested('same'), suggested('same')], edges: [] }, p.id), /invalid_input/);
});
test('notes and boards reuse notebook schemas and aggregate image/relationship checks', async () => {
  const p = await project();
  const note = await run(p.snapshot, 'note.create', { title: 'Evidence', text: 'Record' }, p.id);
  const out = await run(note.snapshot, 'note.update', { id: note.result.id, patch: { pinned: true } }, p.id);
  assert.equal(state(out.snapshot).notes[note.result.id].pinned, true);
  const board = await run(out.snapshot, 'board.create', { title: 'Research' });
  await assert.rejects(run(board.snapshot, 'board.document.set', { id: board.result.id, document: { version: 1, items: [], edges: [{ id: 'edge', source: 'missing', target: 'missing' }], viewport: { x: 0, y: 0, zoom: 1 } } }), /invalid_input/);
});
test('fresh workers isolate concurrent users and query returns no snapshot changes', async () => {
  const [a, b] = await Promise.all([project(empty(), 'A'), project(empty(), 'B')]);
  assert.equal(Object.keys(state(a.snapshot).projects).length, 1);
  assert.equal(Object.keys(state(b.snapshot).projects).length, 1);
  const out = await run(a.snapshot, 'projects', {}, undefined, 'query');
  assert.equal(out.result.items[0].name, 'A');
  assert.deepEqual(out.snapshot, a.snapshot);
});
test('strict plan import/export preserves UI backup behavior and rejects unsafe node fields', async () => {
  const p = await project(), created = await run(p.snapshot, 'plan.create', { plan: plan() }, p.id);
  const exported = await run(created.snapshot, 'plan.export', {}, p.id, 'query');
  assert.ok(exported.result.project.nodes);
  const restored = await run(created.snapshot, 'plan.import', { json: JSON.stringify(exported.result.project) }, p.id);
  assert.ok(state(restored.snapshot).projects[p.id].planner.archivedProject);
  const invalid = structuredClone(exported.result.project);
  invalid.nodes[invalid.rootId].state = 'injected';
  await assert.rejects(run(created.snapshot, 'plan.import', { json: JSON.stringify(invalid) }, p.id), /invalid_input/);
});
test('external alternatives retain paid expansions and select without a provider', async () => {
  const p = await project(), out = await run(p.snapshot, 'plan.outlines.set', { plans: [plan(), { ...plan(), id: 'second', title: 'Another' }] }, p.id);
  assert.equal(Object.keys(state(out.snapshot).projects[p.id].planner.objectiveDraft.expanded).length, 2);
  const selected = await run(out.snapshot, 'plan.outline.select', { outlineId: 'second' }, p.id);
  assert.equal(state(selected.snapshot).projects[p.id].planner.project.name, 'Robot');
  assert.equal(state(selected.snapshot).projects[p.id].planner.project.alternativePlans.length, 1);
});
test('structure applies real tree validation and prevents revision or cross-project source reuse', async () => {
  const p = await project(), out = await run(p.snapshot, 'plan.create', { plan: plan() }, p.id);
  const read = await run(out.snapshot, 'plan', {}, p.id, 'query'), root = read.result.project.rootId;
  const revised = await run(out.snapshot, 'plan.structure', { revision: read.result.revision, reason: 'Investigate', operations: [{ kind: 'add', key: 'new', parentId: root, name: 'New part', nodeKind: 'recurso', oQue: 'Part', porQue: 'Test' }] }, p.id);
  assert.equal(Object.values(state(revised.snapshot).projects[p.id].planner.project.nodes).filter(value => value.name === 'New part').length, 1);
  await assert.rejects(run(revised.snapshot, 'plan.structure', { revision: read.result.revision, reason: 'Stale', operations: [{ kind: 'update', nodeId: root, patch: { name: 'Stale' } }] }, p.id), /planChanged/);
});
test('external references count only with observed verification and removing them demotes done', async () => {
  const p = await project(), made = await run(p.snapshot, 'plan.create', { plan: plan() }, p.id);
  const nodeId = Object.values(state(made.snapshot).projects[p.id].planner.project.nodes).find(value => value.kind === 'passo').id;
  const added = await run(made.snapshot, 'plan.reference.add', { nodeId, reference: { kind: 'medida', label: 'Torque', value: '2 N' } }, p.id);
  const refId = state(added.snapshot).projects[p.id].planner.project.nodes[nodeId].groundTruthRefs[0].id;
  await assert.rejects(run(added.snapshot, 'plan.reference.verify', { nodeId, refId, observation: ' ' }, p.id), /invalid_input/);
  let out = await run(added.snapshot, 'plan.reference.verify', { nodeId, refId, observation: 'I checked the measurement' }, p.id);
  out = await run(out.snapshot, 'plan.node.confirm', { nodeId }, p.id);
  assert.equal(state(out.snapshot).projects[p.id].planner.project.nodes[nodeId].state, 'done');
  out = await run(out.snapshot, 'plan.reference.delete', { nodeId, refId }, p.id);
  assert.equal(state(out.snapshot).projects[p.id].planner.project.nodes[nodeId].state, 'validated');
});
const scene = label => ({ version: 1, label, objects: [{ id: 'body', type: 'box', position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], color: '#ffffff' }] });
test('visual revision reuses UI persistence rules, preserves layout, reverts and rejects executable geometry', async () => {
  const p = await project(), made = await run(p.snapshot, 'plan.create', { plan: plan() }, p.id);
  let out = await run(made.snapshot, 'visual.insert', { kind: 'model', label: 'Body', scene: scene('First') }, p.id);
  const artifactId = out.result.id;
  out = await run(out.snapshot, 'visual.update_geometry', { id: artifactId, patch: { x: 200, y: 150 } }, p.id);
  out = await run(out.snapshot, 'visual.revise', { id: artifactId, scene: scene('Second') }, p.id);
  const artifact = state(out.snapshot).projects[p.id].planner.project.visuals.artifacts[0];
  assert.equal(artifact.scene.label, 'Second'); assert.equal(artifact.x, 200); assert.equal(artifact.revisions.length, 2);
  out = await run(out.snapshot, 'visual.revert', { id: artifactId }, p.id);
  assert.equal(state(out.snapshot).projects[p.id].planner.project.visuals.artifacts[0].scene.label, 'First');
  await assert.rejects(run(out.snapshot, 'visual.revise', { id: artifactId, scene: { ...scene('Bad'), code: 'alert(1)' } }, p.id), /invalid_input/);
});
test('visual images require project-owned stored media and preserve global media metadata', async () => {
  const p = await project(), made = await run(p.snapshot, 'plan.create', { plan: plan() }, p.id);
  const media = { id: 'image-one', projectId: p.id, name: 'Image', mime: 'image/png', sha256: 'a'.repeat(64), size: 20 };
  const snapshot = { ...made.snapshot, media: [media] };
  const out = await run(snapshot, 'visual.image.insert', { mediaId: media.id, label: 'Reference', width: 200, height: 100 }, p.id);
  assert.equal(state(out.snapshot).projects[p.id].planner.project.visuals.artifacts[0].mediaId, media.id);
  assert.deepEqual(out.snapshot.media, [media]);
  await assert.rejects(run({ ...snapshot, media: [{ ...media, projectId: 'another' }] }, 'visual.image.insert', { mediaId: media.id, label: 'Wrong' }, p.id), /project_scope/);
});
test('sprint transitions, task import deduplication and note relationship checks match UI', async () => {
  const p = await project(), made = await run(p.snapshot, 'plan.create', { plan: plan() }, p.id);
  const tasks = await run(made.snapshot, 'task.import_plan', {}, p.id);
  assert.equal(tasks.result.added, 1);
  const again = await run(tasks.snapshot, 'task.import_plan', {}, p.id); assert.equal(again.result.added, 0);
  const sprint = await run(again.snapshot, 'sprint.create', { name: 'One', goal: 'Test', startDate: '2026-10-12', endDate: '2026-10-18' }, p.id);
  const taskId = Object.keys(state(sprint.snapshot).tasks)[0];
  let out = await run(sprint.snapshot, 'task.update', { id: taskId, patch: { sprintId: sprint.result.id } }, p.id);
  out = await run(out.snapshot, 'sprint.start', { id: sprint.result.id }, p.id);
  out = await run(out.snapshot, 'sprint.complete', { id: sprint.result.id }, p.id);
  assert.equal(state(out.snapshot).tasks[taskId].sprintId, null);
  const other = await project(out.snapshot, 'Other'), wrongTask = await run(other.snapshot, 'task.create', { title: 'Other' }, other.id);
  await assert.rejects(run(wrongTask.snapshot, 'note.create', { title: 'Wrong', taskId: wrongTask.result.id }, p.id), /invalidTask/);
});

test('documented decomposition validates quoted evidence, applies a related child and exports UI text', async () => {
  const p = await project(), made = await run(p.snapshot, 'plan.create', { plan: plan() }, p.id);
  let out = await run(made.snapshot, 'visual.insert', { kind: 'model', label: 'Body', scene: scene('Body') }, p.id);
  const artifactId = out.result.id;
  const research = { identity: 'Sensor X', sources: [{ id: 'official', url: 'https://example.org/sensor', title: 'Sensor', text: 'Sensor X contains a detector chip.', retrievedAt: 1 }], parts: [{ id: 'detector', name: 'Detector', partNumber: null, quantity: null, role: 'Detects signal', specifications: ['detector chip'], evidence: [{ sourceId: 'official', quote: 'Sensor X contains a detector chip.' }], unknowns: [] }], unknowns: ['Physical dimensions unverified'] };
  await assert.rejects(run(out.snapshot, 'visual.decomposition.set', { id: artifactId, research: { ...research, parts: [{ ...research.parts[0], evidence: [{ sourceId: 'official', quote: 'An unsupported claim' }] }] } }, p.id), /invalid_input/);
  out = await run(out.snapshot, 'visual.decomposition.set', { id: artifactId, research }, p.id);
  const proposal = { dossier: out.result.dossier, baseDossierFingerprint: out.result.dossierFingerprint, assembly: { scene: { ...scene('Parts'), objects: [{ ...scene('Parts').objects[0], id: 'detector-body' }] }, groups: [{ partId: 'detector', objectIds: ['detector-body'], explodeOffset: [0, 0, 0] }], createdAt: 1, dossierId: out.result.dossier.id, dossierFingerprint: out.result.researchFingerprint, selectedPartIds: ['detector'], geometryBasis: 'generated', reusedObjectIds: [] } };
  const stagedSnapshot = out.snapshot;
  out = await run(out.snapshot, 'visual.decomposition.apply', { id: artifactId, proposal }, p.id);
  const artifacts = state(out.snapshot).projects[p.id].planner.project.visuals.artifacts;
  assert.equal(artifacts.length, 2); assert.equal(artifacts[1].sourceArtifactId, artifactId);
  const exported = await run(out.snapshot, 'visual.decomposition.export', { id: artifactId }, p.id, 'query');
  assert.match(exported.result.text, /Sensor X contains a detector chip/); assert.deepEqual(exported.snapshot, out.snapshot);
  const changed = await run(stagedSnapshot, 'visual.revise', { id: artifactId, scene: scene('Changed') }, p.id);
  await assert.rejects(run(changed.snapshot, 'visual.decomposition.apply', { id: artifactId, proposal }, p.id), /decompositionStale/);
});

test('unrelated loading markers and legacy graph migration never alter project scope', async () => {
  const a = await project(), b = await project(a.snapshot, 'Other'), input = structuredClone(b.snapshot);
  const doc = input.documents.find(value => value.key === 'cellproject-workspace'), envelope = JSON.parse(doc.value);
  envelope.state.legacyImported = false;
  envelope.state.projects[b.id].planner = { project: null, objectiveDraft: { generatingSince: 20, expansion: { outlineId: 'paid', startedAt: 10 } } };
  doc.value = JSON.stringify(envelope);
  const out = await run(input, 'task.create', { title: 'One' }, a.id);
  assert.deepEqual(state(out.snapshot).projects[b.id], envelope.state.projects[b.id]);
  assert.equal(state(out.snapshot).legacyImported, false);
});

test('explicit empty canonical editor remains authoritative and inactive mutations preserve its bytes', async () => {
  const a = await project(), aPlan = await run(a.snapshot, 'plan.create', { plan: plan() }, a.id);
  const b = await project(aPlan.snapshot, 'Other');
  const graphDocument = { key: 'cellproject-graph', value: JSON.stringify({ version: 6, state: { project: null, plannerOwnerId: a.id, objectiveDraft: { name: 'Fresh draft', objective: 'New work' } } }), revision: 9 };
  const input = { ...b.snapshot, documents: [...b.snapshot.documents, graphDocument] };
  const out = await run(input, 'plan.create', { plan: plan() }, b.id);
  assert.deepEqual(out.snapshot.documents.find(value => value.key === 'cellproject-graph'), graphDocument);
  assert.deepEqual(state(out.snapshot).projects[a.id], state(input).projects[a.id]);
  const active = await run(input, 'plan.create', { plan: { ...plan(), title: 'Replacement' } }, a.id);
  assert.equal(JSON.parse(active.snapshot.documents.find(value => value.key === 'cellproject-graph').value).state.project.name, 'Robot');
  assert.equal(state(active.snapshot).projects[a.id].planner.project.name, 'Robot');
});

test('missing records and no-input note titles are handled without corrupting persisted data', async () => {
  const p = await project();
  for (const [name, input] of [['task.update', { id: 'missing', patch: { title: 'x' } }], ['comment.delete', { id: 'missing' }], ['sprint.start', { id: 'missing' }], ['note.trash', { id: 'missing' }], ['plan.node.delete', { nodeId: 'missing' }]]) await assert.rejects(run(p.snapshot, name, input, p.id), /Missing/);
  const out = await run(p.snapshot, 'note.create', {}, p.id);
  assert.equal(typeof state(out.snapshot).notes[out.result.id].title, 'string');
});

test('external visual proposals use UI provenance, approval mode and context staleness', async () => {
  const p = await project(), made = await run(p.snapshot, 'plan.create', { plan: plan() }, p.id);
  let out = await run(made.snapshot, 'visual.proposal.create', { kind: 'model', label: 'Body', scene: scene('Body'), prompt: { text: 'Illustrate the body' } }, p.id);
  assert.equal(state(out.snapshot).projects[p.id].planner.project.visuals.artifacts.length, 0);
  assert.equal(state(out.snapshot).projects[p.id].planner.project.visuals.proposals[0].status, 'ready');
  const proposalId = out.result.id;
  const applied = await run(out.snapshot, 'visual.proposal.apply', { id: proposalId }, p.id);
  assert.equal(state(applied.snapshot).projects[p.id].planner.project.visuals.artifacts[0].origin.instruction, 'Illustrate the body');
  const changed = await run(out.snapshot, 'plan.rule.add', { text: 'Maximum cost 10' }, p.id);
  await assert.rejects(run(changed.snapshot, 'visual.proposal.apply', { id: proposalId }, p.id), /visualProposalStale/);
  out = await run(out.snapshot, 'visual.proposal.reject', { id: proposalId }, p.id);
  out = await run(out.snapshot, 'visual.proposal.delete_history', { id: proposalId }, p.id);
  assert.equal(state(out.snapshot).projects[p.id].planner.project.visuals.proposals.length, 0);
});

test('board item paste/relink, comment deletion, note library and preferences persist correctly', async () => {
  const p = await project(); let snapshot = p.snapshot;
  const apply = async (name, input = {}, projectId) => { const out = await run(snapshot, name, input, projectId); snapshot = out.snapshot; return out.result; };
  const taskId = (await apply('task.create', { title: 'Observation' }, p.id)).id;
  const commentId = (await apply('comment.create', { taskId, body: 'Observed first' }, p.id)).id;
  await apply('comment.update', { id: commentId, body: 'Observed again' }, p.id);
  const folderId = (await apply('folder.create', { name: 'Sources' })).id;
  const noteId = (await apply('personal_note.create', { text: 'Source', folderId })).id;
  await apply('personal_note.append_block', { id: noteId, block: { type: 'bullet', text: 'Another source' } });
  await apply('personal_note.trash', { id: noteId }); await apply('personal_note.restore', { id: noteId });
  await apply('note.move', { id: noteId, projectId: p.id, taskId });
  await apply('folder.delete', { id: folderId });
  await apply('task.delete', { id: taskId }, p.id);
  assert.equal(state(snapshot).notes[noteId].taskId, null); assert.equal(state(snapshot).notes[noteId].folderId, null); assert.equal(Object.keys(state(snapshot).comments).length, 0);
  const boardId = (await apply('board.create', { title: 'Investigation' })).id;
  const item = id => ({ id, kind: 'card', text: id, color: '#ffffff', fontSize: 16, x: 0, y: 0, width: 100, height: 100 });
  await apply('board.item.put', { id: boardId, item: item('one') }); await apply('board.item.put', { id: boardId, item: item('two') });
  await apply('board.edge.put', { id: boardId, edge: { id: 'link', source: 'one', target: 'two' } });
  await apply('board.items.paste', { id: boardId, items: [item('one'), item('two')], edges: [{ id: 'link', source: 'one', target: 'two' }], point: { x: 300, y: 250 } });
  assert.equal(state(snapshot).boards[boardId].document.items.length, 4); assert.equal(state(snapshot).boards[boardId].document.edges.length, 2);
  await apply('board.item.delete', { id: boardId, itemIds: ['one'] }); assert.equal(state(snapshot).boards[boardId].document.edges.length, 1);
  await apply('board.viewport.set', { id: boardId, viewport: { x: 10, y: 20, zoom: 2 } });
  await apply('board.update', { id: boardId, patch: { archived: true } });
  await assert.rejects(run(snapshot, 'board.item.put', { id: boardId, item: item('three') }), /boardArchived/);
  await apply('preference.language', { locale: 'en' }); await apply('preference.theme', { theme: 'light' }); await apply('preference.sidebar', { collapsed: true });
  assert.equal(JSON.parse(snapshot.documents.find(value => value.key === 'cellproject-locale').value).state.locale, 'en');
  assert.equal(snapshot.documents.find(value => value.key === 'dynamic_diary-theme').value, 'light');
});

test('account content commands serialize only their own documents and retain transport revisions', async () => {
  const initial = { documents: [{ key: 'cellproject-config', value: '{"state":{"providers":{}}}', revision: 31 }], media: [] };
  let out = await run(initial, 'conversation.new', { title: 'External work' }); const conversationId = out.result.id;
  const chatDocument = out.snapshot.documents.find(value => value.key === 'dynamic_diary-chat'); chatDocument.revision = 3;
  out = await run(out.snapshot, 'conversation.message.append', { id: conversationId, role: 'assistant', text: 'Externally produced answer' });
  assert.equal(out.snapshot.documents.find(value => value.key === 'dynamic_diary-chat').revision, 3);
  const read = await run(out.snapshot, 'conversation', { id: conversationId }, undefined, 'query'); assert.equal(read.result.messages[0].text, 'Externally produced answer'); assert.deepEqual(read.snapshot, out.snapshot);
  const summary = { titulo: 'Servo', autores: null, dominio: 'robotics', tags: ['servo'], resumo: ['A supplied source'], fatos: [], nivel: 'iniciante' };
  out = await run(out.snapshot, 'knowledge.add', { filename: 'Servo.pdf', sizeBytes: 20, pageCount: 1, extractedText: 'A supplied source body', summary });
  const kbId = out.result.id;
  assert.equal(JSON.parse(out.snapshot.documents.find(value => value.key === 'cellproject-kb').value).state.docs[kbId].summary.titulo, 'Servo');
  out = await run(out.snapshot, 'knowledge.delete', { id: kbId }); assert.equal(Object.keys(JSON.parse(out.snapshot.documents.find(value => value.key === 'cellproject-kb').value).state.docs).length, 0);
  assert.deepEqual(out.snapshot.documents.find(value => value.key === 'cellproject-config'), initial.documents[0]);
  await assert.rejects(run(out.snapshot, 'conversation.new', {}, 'another-project'), /account_scope/);
});

test('rich conversation sources resolve current references and persist shared attachment deduplication across workers', async () => {
  const p = await project({ documents: [], media: [] });
  let out = await run(p.snapshot, 'note.create', { title: 'Servo measurements' }, p.id); const noteId = out.result.id;
  out = await run(out.snapshot, 'note.update', { id: noteId, patch: { blocks: [{ id: 'body', type: 'text', text: 'Observed torque was 2 N' }] } }, p.id);
  out = await run(out.snapshot, 'conversation.new', { title: 'External research' }); const conversationId = out.result.id;
  const choices = await run(out.snapshot, 'conversation.references', { query: 'Servo measurements', referenceProjectId: p.id }, undefined, 'query');
  const choice = choices.result.items.find(value => value.id === noteId); assert.ok(choice);
  assert.ok(!JSON.stringify(choice).includes('Observed torque'));
  const reference = { id: choice.id, kind: choice.kind, projectId: choice.projectId, planId: choice.planId, fingerprint: choice.fingerprint };
  const file = { name: 'Measurements.txt', kind: 'text', size: 25, text: 'Externally extracted source', truncated: false };
  out = await run(out.snapshot, 'conversation.message.append', { id: conversationId, role: 'user', referenceProjectId: p.id, references: [reference], files: [file] });
  assert.equal(out.result.message.references[0].id, noteId); assert.equal(out.result.message.references[0].kind, 'note');
  const persisted = state(out.snapshot).projects[p.id].attachments;
  assert.equal(persisted.length, 1); assert.equal(persisted[0].text, file.text); assert.equal(persisted[0].id, out.result.message.files[0].id);
  out = await run(out.snapshot, 'conversation.message.append', { id: conversationId, role: 'user', referenceProjectId: p.id, files: [file] });
  assert.deepEqual(state(out.snapshot).projects[p.id].attachments, persisted);
  const read = await run(out.snapshot, 'conversation', { id: conversationId }, undefined, 'query');
  assert.match(read.result.modelHistory[0].content, /untrusted source data/);
  out = await run(out.snapshot, 'note.update', { id: noteId, patch: { blocks: [{ id: 'body', type: 'text', text: 'Changed measurements' }] } }, p.id);
  await assert.rejects(run(out.snapshot, 'conversation.message.append', { id: conversationId, role: 'user', text: 'Stale', references: [reference] }), /chatReferenceChanged/);
  await assert.rejects(run(out.snapshot, 'conversation.references', {}, p.id, 'query'), /account_scope/);
  await assert.rejects(run(out.snapshot, 'conversation.message.append', { id: conversationId, role: 'user', files: [file] }, p.id), /account_scope/);
});

test('import and image insertion cannot borrow another project media or attachment references', async () => {
  const a = await project(), made = await run(a.snapshot, 'plan.create', { plan: plan() }, a.id), b = await project(made.snapshot, 'Other');
  const second = await run(b.snapshot, 'plan.create', { plan: plan() }, b.id);
  const media = { id: 'legacy-image', projectId: 'external-plan', name: 'Legacy', mime: 'image/png', sha256: 'a'.repeat(64), size: 20 };
  // Reused imported inner IDs do not confer ownership to either managed project.
  await assert.rejects(run({ ...second.snapshot, media: [media] }, 'visual.image.insert', { mediaId: media.id, label: 'Wrong' }, a.id), /project_scope/);
  const exported = await run(second.snapshot, 'plan.export', {}, a.id, 'query'), imported = exported.result.project;
  imported.nodes[imported.rootId].sourceAttachmentIds = ['other-project-source'];
  await assert.rejects(run(second.snapshot, 'plan.import', { json: JSON.stringify(imported) }, a.id), /attachmentMissing/);
});

test('cached alternative selection rejects changed source attachments, matching the UI context gate', async () => {
  const p = await project(), alternatives = await run(p.snapshot, 'plan.outlines.set', { plans: [plan()] }, p.id);
  const out = await run(alternatives.snapshot, 'attachment.add', { files: [{ id: 'source', name: 'Source.txt', kind: 'text', size: 8, text: 'A source', fingerprint: 'fingerprint', truncated: false, addedAt: 1 }] }, p.id);
  await assert.rejects(run(out.snapshot, 'plan.outline.select', { outlineId: plan().id }, p.id), /planContextChanged/);
});

test('cached alternatives retain the same pending rules and trimmed planning context as the UI', async () => {
  const p = await project(), draft = await run(p.snapshot, 'plan.draft.update', { objective: '  Test a premise  ', rules: ['Measure first'], ruleDraft: 'measure FIRST; Record failures\nVerify sources', planApproach: 'reverse_engineering', referenceTarget: ' Existing servo ' }, p.id);
  const alternatives = await run(draft.snapshot, 'plan.outlines.set', { plans: [plan()] }, p.id);
  const saved = state(alternatives.snapshot).projects[p.id].planner.objectiveDraft;
  assert.deepEqual(saved.rules, ['Measure first', 'Record failures', 'Verify sources']);
  assert.equal(saved.ruleDraft, ''); assert.equal(saved.plansFor.objective, 'Test a premise');
  const selected = await run(alternatives.snapshot, 'plan.outline.select', { outlineId: plan().id }, p.id);
  assert.deepEqual(state(selected.snapshot).projects[p.id].planner.project.rules, saved.rules);
});

test('task import reads the authoritative canonical editor when its managed checkpoint is older', async () => {
  const p = await project(), made = await run(p.snapshot, 'plan.create', { plan: plan() }, p.id);
  const planner = state(made.snapshot).projects[p.id].planner, canonical = structuredClone(planner), leaf = Object.values(canonical.project.nodes).find(node => node.kind === 'passo'); leaf.name = 'Canonical step';
  const snapshot = { ...made.snapshot, documents: [...made.snapshot.documents, { key: 'cellproject-graph', revision: 9, value: JSON.stringify({ state: { ...canonical, plannerOwnerId: p.id }, version: 6 }) }] };
  const out = await run(snapshot, 'task.import_plan', {}, p.id);
  assert.equal(Object.values(state(out.snapshot).tasks)[0].title, 'Canonical step');
});
