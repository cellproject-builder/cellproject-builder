import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generateObject } from 'ai';
import { useGraphStore } from '@/store';
import { useWorkspaceStore } from '@/workspace/store';
import { buildDemoProject } from '@/data/demoProject';
import { initializeWorkspace } from '@/workspace/planner';
import { applyVisualProposal, findMentionTarget, getVisualWorkspace, normalizeVisualWorkspace, resolveVisualContext, mutateVisualWorkspace, setVisualArtifactLink } from './domain';
import { generateVisualModel } from './generation';
import { groundedText } from '@/ai/research';
import { readSpecificationDocuments } from './decompositionResearch';
import { readVisualImage } from './media';
import type { VisualPromptInput } from './types';
import { copyArtifactSnapshot, parseArtifactClipboard, pasteArtifactSnapshot } from './artifactClipboard';
import { modelAssemblyCurrent, modelAssemblyTxt } from './modelAssembly';
import { visualError } from './ui/strings';
import { exportVisualPlan, prepareVisualPlanImport } from './portable';

vi.mock('ai', async importOriginal => ({ ...await importOriginal<typeof import('ai')>(), generateObject: vi.fn() }));
vi.mock('@/ai/client', () => ({ aiModel: { id: 'main' }, assertAIReady: vi.fn(), callOpts: () => ({ maxOutputTokens: 12000 }) }));
vi.mock('@/ai/research', () => ({ groundedText: vi.fn() }));
vi.mock('./decompositionResearch', () => ({ readSpecificationDocuments: vi.fn() }));
vi.mock('./media', async importOriginal => ({ ...await importOriginal<typeof import('./media')>(), readVisualMedia: vi.fn(async () => new Blob(['local'])), readVisualImage: vi.fn(async () => ({ image: new Uint8Array([1]), mediaType: 'image/png' })) }));

const selection: { subject: string; summary: string; nodeIds: string[]; imageIds: string[]; researchTargets: string[] } = { subject: 'Servo and bracket', summary: 'Use the drive and its support.', nodeIds: ['drive', 'bracket'], imageIds: [], researchTargets: [] };
const modulePlan = {
  units: 'illustrative', sharedConstraints: ['A common shaft axis along X.'], unknowns: ['No measured fit.'],
  modules: [
    { id: 'servo', name: 'Servo', prompt: 'Build the complete servo housing and shaft.', nodeIds: ['drive'], sourceIds: [] as string[], center: [-1, 0, 0], size: [2, 2, 2], primitiveBudget: 16 },
    { id: 'support', name: 'Support', prompt: 'Build the support matching the servo interface.', nodeIds: ['bracket'], sourceIds: [] as string[], center: [1, 0, 0], size: [2, 2, 2], primitiveBudget: 16 },
  ],
  interfaces: [{ id: 'mount', moduleIds: ['servo', 'support'], anchor: [0, 0, 0], description: 'Common illustrative mounting interface.' }],
};
const moduleResult = (id: string, x: number) => ({ scene: { version: 1, label: id, objects: [{ id: 'body', type: 'box', position: [x, 0, 0], rotation: [0, 0, 0], scale: [2, 2, 2], color: '#8899aa', geometry: null }] }, interfaceObjects: [{ interfaceId: 'mount', objectId: 'body' }] });
const options = () => ({ signal: new AbortController().signal });
function input(): VisualPromptInput { return { text: 'Build this assembly', generationMode: 'advanced', mentions: [findMentionTarget('assembly', 'node')!], attachments: [] }; }
function mutateNode(id: string, patch: Record<string, unknown>) { useGraphStore.setState(state => ({ project: { ...state.project!, nodes: { ...state.project!.nodes, [id]: { ...state.project!.nodes[id], ...patch } } } })); }
function queue(selectionOverride = selection, plan = modulePlan) {
  vi.mocked(generateObject).mockResolvedValueOnce({ object: selectionOverride, finishReason: 'stop' } as never)
    .mockResolvedValueOnce({ object: plan, finishReason: 'stop' } as never)
    .mockResolvedValueOnce({ object: moduleResult('Servo', -1), finishReason: 'stop' } as never)
    .mockResolvedValueOnce({ object: moduleResult('Support', 1), finishReason: 'stop' } as never);
}
beforeEach(async () => {
  await Promise.all([useGraphStore.persist.rehydrate(), useWorkspaceStore.persist.rehydrate()]);
  useWorkspaceStore.setState({ projects: {}, notes: {}, activeProjectId: null, legacyImported: true });
  const demo = buildDemoProject(), template = demo.nodes[demo.rootId];
  const node = (id: string, name: string, parentId: string | null, notes = '') => ({ ...template, id, name, parentId, notes, oQue: name, comoConfirmar: 'HIDDEN-CRITERION', explicacao: 'HIDDEN-EXPLANATION' });
  useGraphStore.setState({ project: { ...demo, id: 'advanced-plan', rootId: 'root', nodes: {
    root: node('root', 'Robot', null), assembly: node('assembly', 'Arm assembly', 'root'),
    drive: node('drive', 'Servo motor', 'assembly', 'DRIVE-BODY: chosen servo'), bracket: node('bracket', 'Servo bracket', 'assembly', 'BRACKET-BODY: support'),
    prerequisite: node('prerequisite', 'Measured shaft', 'root'), unrelated: node('unrelated', 'Budget and presentation', 'root', 'UNRELATED-BODY'),
  }, edges: { incoming: { id: 'incoming', source: 'prerequisite', target: 'assembly', kind: 'optional' } } }, selectedNodeId: 'assembly' });
  initializeWorkspace(); vi.clearAllMocks(); vi.mocked(generateObject).mockReset();
});

describe('advanced modular generation', () => {
  it('preserves custom geometry and the assembly contract through application, recovery, TXT and independent copies', async () => {
    const generated = moduleResult('Servo', -1);
    const custom = { ...generated.scene.objects[0], type: 'custom', scale: [1, 1, 1], geometry: { kind: 'extrude', points: [[-1, -1], [1, -1], [1, 1], [-1, 1]], holes: [], depth: 2, bevel: 0 } };
    vi.mocked(generateObject).mockResolvedValueOnce({ object: selection, finishReason: 'stop' } as never).mockResolvedValueOnce({ object: modulePlan, finishReason: 'stop' } as never)
      .mockResolvedValueOnce({ object: { ...generated, scene: { ...generated.scene, objects: [custom] } }, finishReason: 'stop' } as never)
      .mockResolvedValueOnce({ object: moduleResult('Support', 1), finishReason: 'stop' } as never);
    const proposal = await generateVisualModel(input(), options()), original = applyVisualProposal(proposal.id);
    expect(original.scene!.objects[0].geometry).toEqual(custom.geometry);
    const recovered = normalizeVisualWorkspace(JSON.parse(JSON.stringify(getVisualWorkspace(useGraphStore.getState().project)))).artifacts[0];
    expect(modelAssemblyCurrent(recovered)).toBe(true);
    const portable = await prepareVisualPlanImport(JSON.parse(JSON.stringify(await exportVisualPlan(useGraphStore.getState().project!))));
    expect(portable.visuals!.artifacts[0].scene).toEqual(original.scene);
    expect(portable.visuals!.artifacts[0].assembly).toEqual(original.assembly);
    expect(modelAssemblyCurrent(portable.visuals!.artifacts[0])).toBe(true);
    const copy = await pasteArtifactSnapshot(parseArtifactClipboard(copyArtifactSnapshot(original.id))!);
    expect(copy.scene).toEqual(original.scene); expect(copy.scene).not.toBe(original.scene);
    expect(copy.assembly).toEqual(original.assembly); expect(copy.assembly).not.toBe(original.assembly);
    expect(copy.scene!.objects[0].geometry).not.toBe(original.scene!.objects[0].geometry);
    expect(modelAssemblyTxt(copy)).toContain('"kind": "extrude"');
    expect(modelAssemblyTxt(copy)).toContain(modulePlan.modules[0].prompt);
    const geometry = copy.scene!.objects[0].geometry!;
    if (geometry.kind === 'extrude') geometry.depth = 1;
    expect(modelAssemblyCurrent(copy)).toBe(false); expect(modelAssemblyCurrent(original)).toBe(true);
    expect(() => modelAssemblyTxt(copy)).toThrow('visualAssemblyInvalid');
    const request = vi.mocked(generateObject).mock.calls[2][0];
    expect(request.system).toContain('type:"custom"'); expect(request.system).toContain('1 to 16 objects');
    expect(request.system).toContain('Max 128 points per contour');
  });
  it('discovers the selected branch and prerequisites, then sends only relevant bodies to individual module calls', async () => {
    queue(); const progress = vi.fn();
    const proposal = await generateVisualModel(input(), { ...options(), onProgress: progress });
    const calls = vi.mocked(generateObject).mock.calls.map(([request]) => request);
    expect(calls).toHaveLength(4);
    const outline = JSON.parse(calls[0].prompt as string);
    expect(outline.context).toContain('Servo motor'); expect(outline.context).toContain('Measured shaft');
    expect(outline.context).not.toContain('UNRELATED-BODY'); expect(outline.context).not.toContain('HIDDEN-');
    expect(outline.context).not.toContain('DRIVE-BODY');
    expect(calls[1].prompt).toContain('DRIVE-BODY'); expect(calls[1].prompt).toContain('BRACKET-BODY');
    expect(calls[2].prompt).toContain(modulePlan.modules[0].prompt);
    expect(calls[2].prompt).not.toContain('BRACKET-BODY'); expect(calls[3].prompt).not.toContain('DRIVE-BODY');
    expect(JSON.parse(calls[2].prompt as string).contract).toEqual(JSON.parse(calls[3].prompt as string).contract);
    expect(proposal.scene.objects.map(object => object.id)).toEqual(['servo/body', 'support/body']);
    expect(proposal.assembly?.groups.map(group => group.name)).toEqual(['Servo', 'Support']);
    expect(proposal.assembly?.plan.interfaces).toEqual(modulePlan.interfaces);
    expect(progress).toHaveBeenCalled(); expect(groundedText).not.toHaveBeenCalled();
    expect(getVisualWorkspace(useGraphStore.getState().project).artifacts).toHaveLength(0);
    const artifact = applyVisualProposal(proposal.id);
    expect(artifact.assembly).toEqual(proposal.assembly);
    expect(normalizeVisualWorkspace(JSON.parse(JSON.stringify(getVisualWorkspace(useGraphStore.getState().project)))).artifacts[0].assembly).toEqual(proposal.assembly);
  });
  it('reads actual documentation for selected search targets before planning and preserves retrieval gaps', async () => {
    queue({ ...selection, researchTargets: ['Exact servo variant'] });
    vi.mocked(groundedText).mockResolvedValue({ sources: [{ url: 'https://manufacturer.example/servo', title: 'Servo datasheet' }] } as never);
    vi.mocked(readSpecificationDocuments).mockResolvedValue({ sources: [{ id: 'datasheet', url: 'https://manufacturer.example/servo', title: 'Servo', text: 'Housing description from the actual document.', retrievedAt: 1 }], unknowns: ['No mounting drawing.'] });
    const proposal = await generateVisualModel(input(), options());
    expect(readSpecificationDocuments).toHaveBeenCalledTimes(1);
    expect(vi.mocked(generateObject).mock.calls[1][0].prompt).toContain('Housing description from the actual document.');
    expect(proposal.assembly?.unknowns).toContain('No mounting drawing.');
    expect(proposal.assembly?.sources[0].id).toBe('datasheet');
  });
  it('constrains documentary source IDs separately from selected images before asking for a plan', async () => {
    mutateVisualWorkspace(workspace => ({ ...workspace, artifacts: [{ id: 'servo-image', kind: 'image', label: 'Servo photo', linkedNodeId: 'drive',
      x: 0, y: 0, width: 100, height: 100, mediaId: 'servo-photo', scene: null, source: null,
      revisions: [{ scene: null, mediaId: 'servo-photo', createdAt: 1 }], revisionIndex: 0 }] }));
    queue({ ...selection, imageIds: ['servo-image'], researchTargets: ['Exact servo variant'] });
    vi.mocked(groundedText).mockResolvedValue({ sources: [{ url: 'https://manufacturer.example/servo', title: 'Servo datasheet' }] } as never);
    vi.mocked(readSpecificationDocuments).mockResolvedValue({ sources: [{ id: 'datasheet', url: 'https://manufacturer.example/servo', title: 'Servo', text: 'Manufacturer description.', retrievedAt: 1 }], unknowns: [] });
    await generateVisualModel(input(), options());
    const request = vi.mocked(generateObject).mock.calls[1][0];
    const grammar = (request as { schema: { safeParse: (value: unknown) => { success: boolean } } }).schema;
    const candidate = structuredClone(modulePlan);
    candidate.modules[0].sourceIds = ['servo-image'];
    expect(grammar.safeParse(candidate).success).toBe(false);
    candidate.modules[0].sourceIds = ['datasheet'];
    expect(grammar.safeParse(candidate).success).toBe(true);
    candidate.modules[0].nodeIds = ['unrelated'];
    expect(grammar.safeParse(candidate).success).toBe(false);
    expect(JSON.parse(request.prompt as string).allowedReferences).toEqual({ nodeIds: ['assembly', 'drive', 'bracket'], sourceIds: ['datasheet'] });
  });
  it('requires empty documentary citations when no actual document was retrieved', async () => {
    queue(); await generateVisualModel(input(), options());
    const grammar = (vi.mocked(generateObject).mock.calls[1][0] as { schema: { safeParse: (value: unknown) => { success: boolean } } }).schema;
    const candidate = structuredClone(modulePlan); candidate.modules[0].sourceIds = ['invented-document'];
    expect(grammar.safeParse(candidate).success).toBe(false);
    expect(grammar.safeParse(modulePlan).success).toBe(true);
  });
  it('invalidates the proposal when a descendant changes before application', async () => {
    queue(); const proposal = await generateVisualModel(input(), options());
    mutateNode('drive', { notes: 'Changed motor' });
    expect(() => applyVisualProposal(proposal.id)).toThrow('visualProposalStale');
    expect(getVisualWorkspace(useGraphStore.getState().project).artifacts).toHaveLength(0);
  });
  it('invalidates an assembly when a related image is relinked inside the same selected branch', async () => {
    mutateVisualWorkspace(workspace => ({ ...workspace, artifacts: [{ id: 'reference', kind: 'image', label: 'Servo photo', linkedNodeId: 'drive',
      x: 0, y: 0, width: 100, height: 100, mediaId: 'servo-photo', scene: null, source: null,
      revisions: [{ scene: null, mediaId: 'servo-photo', createdAt: 1 }], revisionIndex: 0 }] }));
    queue(); const request = input(), fingerprint = resolveVisualContext(request).fingerprint;
    const proposal = await generateVisualModel(request, options());
    setVisualArtifactLink('reference', 'bracket');
    expect(resolveVisualContext(request).fingerprint).not.toBe(fingerprint);
    expect(() => applyVisualProposal(proposal.id)).toThrow('visualProposalStale');
    expect(getVisualWorkspace(useGraphStore.getState().project).artifacts).toHaveLength(1);
  });
  it('ignores unrelated edits but detects transient selected-branch changes during any module request', async () => {
    const request = input(), fingerprint = resolveVisualContext(request).fingerprint;
    mutateNode('unrelated', { notes: 'Another budget' }); expect(resolveVisualContext(request).fingerprint).toBe(fingerprint);
    queue();
    vi.mocked(generateObject).mockReset();
    vi.mocked(generateObject).mockResolvedValueOnce({ object: selection, finishReason: 'stop' } as never).mockResolvedValueOnce({ object: modulePlan, finishReason: 'stop' } as never)
      .mockImplementationOnce(async () => { const previous = useGraphStore.getState().project!.nodes.drive.notes; mutateNode('drive', { notes: 'temporary' }); mutateNode('drive', { notes: previous }); return { object: moduleResult('Servo', -1), finishReason: 'stop' } as never; });
    await expect(generateVisualModel(request, options())).rejects.toThrow('visualContextChanged');
    expect(getVisualWorkspace(useGraphStore.getState().project).proposals).toHaveLength(0);
  });
  it.each(['bounds', 'interface', 'budget', 'reference'] as const)('rejects an inconsistent module contract (%s) without storing a partial scene', async failure => {
    const plan = structuredClone(modulePlan), generated = moduleResult('Servo', -1);
    if (failure === 'bounds') generated.scene.objects[0].position = [-100, 0, 0];
    if (failure === 'interface') generated.interfaceObjects[0].objectId = 'missing';
    if (failure === 'budget') generated.scene.objects = Array.from({ length: 17 }, (_, i) => ({ ...generated.scene.objects[0], id: `body-${i}` }));
    if (failure === 'reference') plan.modules[0].nodeIds = ['unrelated'];
    vi.mocked(generateObject).mockResolvedValueOnce({ object: selection, finishReason: 'stop' } as never).mockResolvedValueOnce({ object: plan, finishReason: 'stop' } as never).mockResolvedValueOnce({ object: generated, finishReason: 'stop' } as never);
    await expect(generateVisualModel(input(), options())).rejects.toThrow('visualAssemblyInvalid');
    expect(getVisualWorkspace(useGraphStore.getState().project).proposals).toHaveLength(0);
    expect(getVisualWorkspace(useGraphStore.getState().project).artifacts).toHaveLength(0);
  });
  it('identifies the failing module and actual geometry limit instead of blaming its references', async () => {
    const generated = moduleResult('Servo', -1);
    generated.scene.objects[0].position = [-100, 0, 0];
    vi.mocked(generateObject).mockResolvedValueOnce({ object: selection, finishReason: 'stop' } as never)
      .mockResolvedValueOnce({ object: modulePlan, finishReason: 'stop' } as never)
      .mockResolvedValueOnce({ object: generated, finishReason: 'stop' } as never);
    const failure = await generateVisualModel(input(), options()).catch(error => error);
    expect(failure).toMatchObject({ message: 'visualAssemblyInvalid', stage: 'module', code: 'bounds', moduleName: 'Servo' });
    const message = visualError(failure, { generate: 'Gerar modelo', assemblyInvalid: 'GENERIC' } as never);
    expect(message).toContain('Servo'); expect(message).toContain('limites');
    expect(message).not.toContain('GENERIC'); expect(message).not.toContain('referências');
    expect(getVisualWorkspace(useGraphStore.getState().project).proposals).toHaveLength(0);
    expect(generateObject).toHaveBeenCalledTimes(3); // No hidden paid repair or partial assembly.
  });
  it('distinguishes an inconsistent planning anchor from an invalid generated module', async () => {
    const plan = structuredClone(modulePlan); plan.interfaces[0].anchor = [100, 0, 0];
    vi.mocked(generateObject).mockResolvedValueOnce({ object: selection, finishReason: 'stop' } as never)
      .mockResolvedValueOnce({ object: plan, finishReason: 'stop' } as never);
    const failure = await generateVisualModel(input(), options()).catch(error => error);
    expect(failure).toMatchObject({ message: 'visualAssemblyInvalid', stage: 'plan', code: 'anchors' });
    expect(visualError(failure, { generate: 'Generate model', assemblyInvalid: 'GENERIC' } as never)).toContain('Assembly plan');
    expect(generateObject).toHaveBeenCalledTimes(2);
  });
  it('stops subsequent module requests on cancellation', async () => {
    const controller = new AbortController();
    vi.mocked(generateObject).mockResolvedValueOnce({ object: selection, finishReason: 'stop' } as never).mockResolvedValueOnce({ object: modulePlan, finishReason: 'stop' } as never)
      .mockImplementationOnce(async () => { controller.abort(); return { object: moduleResult('Servo', -1), finishReason: 'stop' } as never; });
    await expect(generateVisualModel(input(), { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(generateObject).toHaveBeenCalledTimes(3); expect(getVisualWorkspace(useGraphStore.getState().project).proposals).toHaveLength(0);
  });
  it('does not load inferred image pixels without explicit image-analysis consent', async () => {
    queue(); await generateVisualModel(input(), options()); expect(readVisualImage).not.toHaveBeenCalled();
  });
});
