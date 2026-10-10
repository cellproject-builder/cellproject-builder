import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useGraphStore } from '@/store';
import { useWorkspaceStore } from '@/workspace/store';
import { buildDemoProject } from '@/data/demoProject';
import { initializeWorkspace } from '@/workspace/planner';
import { generateVisualDiagram, reviseVisualDiagram } from './generation';
import { torqueDiagram } from './fixture';
import { applyVisualProposal, getVisualWorkspace, revertVisualArtifact, setDiagramParameter, updateVisualArtifact } from '../domain';
vi.mock('ai', () => ({ generateText: vi.fn() }));
vi.mock('@/ai/client', () => ({ aiModel: {}, assertAIReady: vi.fn(), callOpts: () => ({ maxOutputTokens: 8000 }) }));
import { generateText } from 'ai';
const input = { text: 'Comparar carga e alcance', mentions: [], attachments: [], artifactKind: 'diagram' as const };
beforeEach(async () => {
  await Promise.all([useGraphStore.persist.rehydrate(), useWorkspaceStore.persist.rehydrate()]);
  useWorkspaceStore.setState({ projects: {}, notes: {}, activeProjectId: null, legacyImported: true });
  useGraphStore.setState({ project: { ...buildDemoProject(), id: 'diagram-generation' }, selectedNodeId: null }); initializeWorkspace(); vi.mocked(generateText).mockReset();
});
afterEach(() => vi.restoreAllMocks());
function response() { const id = useGraphStore.getState().project!.rootId; return { text: JSON.stringify(torqueDiagram(id, id)), finishReason: 'stop' } as Awaited<ReturnType<typeof generateText>>; }
it('generates a bounded JSON document in the existing proposal cycle and respects approval/automatic mode', async () => {
  vi.mocked(generateText).mockResolvedValue(response());
  const p = await generateVisualDiagram(input, { signal: new AbortController().signal });
  expect(p).toMatchObject({ kind: 'diagram', scene: null, status: 'ready' }); expect(getVisualWorkspace(useGraphStore.getState().project).artifacts).toHaveLength(0);
  expect(vi.mocked(generateText).mock.calls[0][0]).toMatchObject({ maxRetries: 0 });
  expect(vi.mocked(generateText).mock.calls[0][0].system).toContain('not physical evidence');
  useGraphStore.setState(state => ({ project: { ...state.project!, visuals: { ...state.project!.visuals!, mode: 'automatic' } } }));
  const applied = await generateVisualDiagram(input, { signal: new AbortController().signal });
  expect(applied.status).toBe('applied'); expect(getVisualWorkspace(useGraphStore.getState().project).artifacts[0].kind).toBe('diagram');
});
it('keeps changed context stale and refuses invalid payloads without applying or silently retrying', async () => {
  const valid = response();
  vi.mocked(generateText).mockImplementation(async () => { useGraphStore.setState(state => ({ project: { ...state.project!, objective: 'Requisito mudou' } })); return valid; });
  expect((await generateVisualDiagram(input, { signal: new AbortController().signal })).status).toBe('stale');
  expect(getVisualWorkspace(useGraphStore.getState().project).artifacts).toEqual([]);
  vi.mocked(generateText).mockResolvedValue({ ...valid, text: '{"script":"alert(1)"}' });
  await expect(generateVisualDiagram(input, { signal: new AbortController().signal })).rejects.toThrow();
  expect(generateText).toHaveBeenCalledTimes(2);
});
it('revises the selected diagram with its current document, keeps user layout and restores prior parameters on undo', async () => {
  vi.mocked(generateText).mockResolvedValue(response());
  const p = await generateVisualDiagram(input, { signal: new AbortController().signal }); const original = applyVisualProposal(p.id);
  setDiagramParameter(original.id, 'mass', .7);
  const updated = JSON.parse(response().text); updated.title = 'Torque revisado';
  vi.mocked(generateText).mockImplementation(async () => { updateVisualArtifact(original.id, { x: 400, width: 700 }); return { ...response(), text: JSON.stringify(updated) }; });
  const revised = await reviseVisualDiagram(original.id, { ...input, text: 'Melhorar explicação e preservar premissas' }, { signal: new AbortController().signal });
  expect(revised).toMatchObject({ id: original.id, kind: 'diagram', x: 400, width: 700, revisionIndex: 1, label: 'Torque revisado', diagramValues: { mass: .7 } });
  const prompt = vi.mocked(generateText).mock.calls.at(-1)![0]; expect(JSON.stringify(prompt)).toContain('sourceDiagram');
  expect(getVisualWorkspace(useGraphStore.getState().project).artifacts).toHaveLength(1);
  expect(getVisualWorkspace(useGraphStore.getState().project).proposals).toHaveLength(1);
  setDiagramParameter(original.id, 'mass', .3); revertVisualArtifact(original.id);
  expect(getVisualWorkspace(useGraphStore.getState().project).artifacts[0]).toMatchObject({ diagramValues: { mass: .7 }, revisionIndex: 0, label: original.label });
});
it('rejects a revision when the source diagram changes during inference', async () => {
  vi.mocked(generateText).mockResolvedValue(response());
  const p = await generateVisualDiagram(input, { signal: new AbortController().signal }); const original = applyVisualProposal(p.id);
  vi.mocked(generateText).mockImplementation(async () => { setDiagramParameter(original.id, 'mass', .9); return response(); });
  await expect(reviseVisualDiagram(original.id, { ...input, text: 'Trocar o desenho' }, { signal: new AbortController().signal })).rejects.toThrow('visualContextChanged');
  expect(getVisualWorkspace(useGraphStore.getState().project).artifacts[0]).toMatchObject({ revisionIndex: 0, diagramValues: { mass: .9 } });
});
