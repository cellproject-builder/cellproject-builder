import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useGraphStore, flushGraphPersistence, parseImportedProject } from '@/store';
import { useWorkspaceStore } from '@/workspace/store';
import { buildDemoProject } from '@/data/demoProject';
import { initializeWorkspace } from '@/workspace/planner';
import { addLocalImage, attachVisualFile, readVisualMedia } from './media';
import { applyVisualProposal, currentVisualScope, getVisualWorkspace, listMentionTargets, removeVisualArtifact, resolveVisualContext, saveVisualDraft, setVisualArtifactLink, storeVisualProposal } from './domain';
import { collectVisualMediaIds, exportVisualPlan, prepareVisualPlanImport, watchVisualImportContext } from './portable';
import { normalizeStoredProjectVisuals } from './projectBoundary';
import type { SceneV1, VisualArtifact } from './types';

beforeEach(async () => {
  await Promise.all([useGraphStore.persist.rehydrate(), useWorkspaceStore.persist.rehydrate()]);
  useWorkspaceStore.setState({ projects: {}, notes: {}, activeProjectId: null, legacyImported: true });
  useGraphStore.setState({ project: { ...buildDemoProject(), id: 'portable-plan' } });
  initializeWorkspace();
});

describe('portable visual plans', () => {
  it('preserves the raw legacy JSON shape without visual data', async () => {
    const project = useGraphStore.getState().project!;
    expect(await exportVisualPlan(project)).toEqual(project);
    expect((await prepareVisualPlanImport(JSON.parse(JSON.stringify(project)))).rootId).toBe(project.rootId);
  });

  it('roundtrips a node link and free image through export, import and reload', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 1, height: 1, close: () => {} })));
    try {
      const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jx1sAAAAASUVORK5CYII='), c => c.charCodeAt(0));
      const linked = await addLocalImage(new File([bytes], 'linked.png', { type: 'image/png' }), { x: 13, y: -27 });
      const free = await addLocalImage(new File([bytes], 'free.png', { type: 'image/png' }), { x: -31, y: 62 });
      const nodeId = useGraphStore.getState().project!.rootId;
      setVisualArtifactLink(linked.id, nodeId);
      setVisualArtifactLink(free.id, null);
      const restored = await prepareVisualPlanImport(JSON.parse(JSON.stringify(await exportVisualPlan(useGraphStore.getState().project!))));
      expect(restored.visuals?.artifacts.map(a => ({ linkedNodeId: a.linkedNodeId, x: a.x, y: a.y }))).toEqual([
        { linkedNodeId: nodeId, x: 13, y: -27 }, { linkedNodeId: null, x: -31, y: 62 },
      ]);
      useGraphStore.setState({ project: restored });
      await flushGraphPersistence(); await useGraphStore.persist.rehydrate();
      expect(useGraphStore.getState().project?.visuals?.artifacts).toEqual(restored.visuals?.artifacts);
      const missingTarget = { ...restored, visuals: { ...restored.visuals!, artifacts: [{ ...linked, linkedNodeId: 'missing-concept' }] } };
      expect(parseImportedProject(missingTarget)?.visuals?.artifacts[0]).toMatchObject({ linkedNodeId: null, x: 13, y: -27 });
      expect(normalizeStoredProjectVisuals(missingTarget)?.visuals?.artifacts[0]).toMatchObject({ linkedNodeId: null, x: 13, y: -27 });
    } finally { vi.unstubAllGlobals(); }
  });

  it('roundtrips a migrated decomposition beside its untouched original without multiplying children', async () => {
    const scene: SceneV1 = { version: 1, label: 'Arduino USB', objects: [{ id: 'usb', type: 'box', position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], color: '#999999' }] };
    const parent: VisualArtifact = { id: 'original-model', label: 'Arduino', kind: 'model', scene, mediaId: null, source: null,
      x: 21, y: 34, width: 280, height: 220, linkedNodeId: useGraphStore.getState().project!.rootId,
      revisions: [{ scene, mediaId: null, createdAt: 1 }], revisionIndex: 0,
      decomposition: { version: 1, id: 'usb-dossier', identity: 'Arduino UNO R3', artifactFingerprint: 'original-model-fingerprint', sourceImageIds: [], researchedAt: 1, unknowns: [],
        sources: [{ id: 'datasheet', url: 'https://example.com/usb', title: 'USB', text: 'USB type B', retrievedAt: 1 }],
        parts: [{ id: 'usb', name: 'USB', role: 'USB', partNumber: null, quantity: null, specifications: [], evidence: [{ sourceId: 'datasheet', quote: 'USB type B' }], unknowns: [] }],
        assembly: { scene, createdAt: 2, dossierId: 'usb-dossier', selectedPartIds: ['usb'], groups: [{ partId: 'usb', objectIds: ['usb'], explodeOffset: [3, 0, 0] }], geometryBasis: 'source', reusedObjectIds: ['usb'] },
      },
    };
    const project = { ...useGraphStore.getState().project!, visuals: { version: 1 as const, mode: 'approval' as const, artifacts: [parent], proposals: [], drafts: { search: { text: '', mentions: [], attachments: [] }, model: { text: '', mentions: [], attachments: [] } } } };
    const exported = await exportVisualPlan(project);
    const restored = await prepareVisualPlanImport(JSON.parse(JSON.stringify(exported)));
    expect(restored.visuals?.artifacts).toHaveLength(2);
    const child = restored.visuals!.artifacts[1];
    const migratedDossier = { ...parent.decomposition!, assemblyArtifactId: child.id };
    expect(restored.visuals?.artifacts[0]).toEqual({ ...parent, decomposition: migratedDossier });
    expect(child).toMatchObject({ sourceArtifactId: parent.id, scene, linkedNodeId: parent.linkedNodeId, decomposition: migratedDossier });
    expect(child.x).toBeGreaterThan(parent.x + parent.width);
    useGraphStore.setState({ project: restored });
    await flushGraphPersistence(); await useGraphStore.persist.rehydrate();
    const reopened = useGraphStore.getState().project!;
    expect(reopened.visuals?.artifacts).toEqual(restored.visuals?.artifacts);
    const twice = await prepareVisualPlanImport(JSON.parse(JSON.stringify(await exportVisualPlan(reopened))));
    expect(twice.visuals?.artifacts).toEqual(restored.visuals?.artifacts);
  });

  it('exports and imports original draft attachment bytes without mutating the editor', async () => {
    const attachment = await attachVisualFile(new File(['original content'], 'part.md', { type: 'text/markdown' }));
    saveVisualDraft('model', { text: 'Make a part', mentions: [], attachments: [attachment] });
    const project = useGraphStore.getState().project!;
    const exported = await exportVisualPlan(project) as { format: string; version: number; project: unknown; media: Array<{ base64: string }> };
    expect(exported).toMatchObject({ format: 'cellproject-visual-plan', version: 1 });
    expect(exported.media[0].base64).toBe(btoa('original content'));
    const restored = await prepareVisualPlanImport(JSON.parse(JSON.stringify(exported)));
    expect(restored.visuals?.drafts.model.attachments[0]).toEqual(attachment);
    expect(useGraphStore.getState().project).toBe(project);
  });

  it('exports a model source image after its canvas image and generation proposal were removed', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 1, height: 1, close: () => {} })));
    try {
      const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jx1sAAAAASUVORK5CYII='), c => c.charCodeAt(0));
      const image = await addLocalImage(new File([bytes], 'Arduino-reference.png', { type: 'image/png' }), { x: 0, y: 0 });
      const input = { text: 'Arduino UNO R3 from this reference.', mentions: [listMentionTargets('').find(target => target.id === image.id)!], attachments: [] };
      const scene = { version: 1 as const, label: 'Arduino UNO R3', objects: [{ id: 'pcb', type: 'box' as const, position: [0, 0, 0] as [number, number, number], rotation: [0, 0, 0] as [number, number, number], scale: [1, 1, 1] as [number, number, number], color: '#008080' }] };
      storeVisualProposal({ id: 'portable-origin', projectId: useGraphStore.getState().project!.id, label: scene.label, scene, input, contextFingerprint: resolveVisualContext(input).fingerprint, referencedMediaIds: [image.mediaId!], createdAt: 1, status: 'ready' }, currentVisualScope());
      const model = applyVisualProposal('portable-origin');
      removeVisualArtifact(image.id);
      useGraphStore.setState(state => ({ project: { ...state.project!, visuals: { ...getVisualWorkspace(state.project), proposals: [] } } }));
      const project = useGraphStore.getState().project!;
      expect(collectVisualMediaIds(project)).toEqual([image.mediaId]);
      const exported = await exportVisualPlan(project);
      expect('media' in exported && exported.media.map(media => media.id)).toEqual([image.mediaId]);
      const restored = await prepareVisualPlanImport(JSON.parse(JSON.stringify(exported)));
      expect(restored.visuals?.artifacts[0].origin).toEqual(model.origin);
      await expect(prepareVisualPlanImport({ ...exported, media: [] })).rejects.toThrow('visualMediaMissing');
    } finally { vi.unstubAllGlobals(); }
  });

  it('rejects invalid concepts and visual scenes before writing embedded media', async () => {
    const draft = { text: '', mentions: [], attachments: [] };
    const malicious = { ...useGraphStore.getState().project!, visuals: { version: 1, mode: 'approval', artifacts: [{ kind: 'model', scene: { code: 'execute()' } }], proposals: [], drafts: { model: draft, search: draft } } };
    const media = [{ id: 'invalid-before-write', name: 'a.txt', mime: 'text/plain', base64: btoa('a') }];
    await expect(prepareVisualPlanImport({ format: 'cellproject-visual-plan', version: 1, project: malicious, media })).rejects.toThrow();
    expect(await readVisualMedia('invalid-before-write')).toBeNull();
    expect(parseImportedProject(malicious)).toBeNull();
    await expect(prepareVisualPlanImport({ format: 'cellproject-visual-plan', version: 1, project: { nodes: {}, edges: {}, rootId: 'missing' }, media })).rejects.toThrow();
    expect(await readVisualMedia('invalid-before-write')).toBeNull();
  });

  it('rejects a bundle missing a referenced media record', async () => {
    const attachment = await attachVisualFile(new File(['original'], 'part.txt', { type: 'text/plain' }));
    saveVisualDraft('search', { text: '', mentions: [], attachments: [attachment] });
    const exported = await exportVisualPlan(useGraphStore.getState().project!) as unknown as Record<string, unknown>;
    await expect(prepareVisualPlanImport({ ...exported, media: [] })).rejects.toThrow('visualMediaMissing');
  });

  it('isolates malformed persisted visual data while preserving all concept nodes', () => {
    const project = useGraphStore.getState().project!;
    const normalized = normalizeStoredProjectVisuals({ ...project, visuals: { code: 'execute()' } } as never)!;
    expect(normalized.nodes).toBe(project.nodes);
    expect(normalized.visuals).toBeUndefined();
  });

  it('blocks asynchronous import after navigating away and back', () => {
    const original = useGraphStore.getState().project!;
    const guard = watchVisualImportContext();
    useGraphStore.setState({ project: { ...original, id: 'other-import-context' } });
    useGraphStore.setState({ project: original });
    expect(() => guard.assert()).toThrow('visualImportContextChanged');
    guard.dispose();
  });

  it('preserves the complete server textual assessment through image export, import and reload', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 1, height: 1, close: () => {} })));
    try {
      const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jx1sAAAAASUVORK5CYII='), c => c.charCodeAt(0));
      const artifact = await addLocalImage(new File([bytes], 'reviewed.png', { type: 'image/png' }), { x: 1, y: 2 });
      // Exact shape returned by server/typesafe.mjs, including calibrated distribution/provenance.
      const assessment = { kind: 'textual' as const, model: 'jev-latest', rubricVersion: 'reference-relevance-v1', score: 1.999, confidence: .99, probabilities: { '0': .1, '1': .2, '2': .3, '3': .4 }, legend: { '0': 'irrelevant', '1': 'family', '2': 'useful', '3': 'exact' }, assessedAt: 1791574000000 };
      const source = { id: 'candidate', sessionId: 'session', title: 'Reviewed image', description: 'Real metadata', imageUrl: '/api/visuals/media?sessionId=session&candidateId=candidate', sourcePageUrl: 'https://example.com/image', credit: null, license: null, width: 1, height: 1, assessment };
      useGraphStore.setState(state => ({ project: { ...state.project!, visuals: { ...state.project!.visuals!, artifacts: [{ ...artifact, source }] } } }));
      const exported = await exportVisualPlan(useGraphStore.getState().project!);
      const restored = await prepareVisualPlanImport(JSON.parse(JSON.stringify(exported)));
      expect(restored.visuals?.artifacts[0].source?.assessment).toEqual(assessment);
      useGraphStore.setState({ project: restored });
      await flushGraphPersistence(); await useGraphStore.persist.rehydrate();
      expect(useGraphStore.getState().project?.visuals?.artifacts[0].source?.assessment).toEqual(assessment);
      const malformed = JSON.parse(JSON.stringify(restored));
      malformed.visuals.artifacts[0].source.assessment.probabilities['0'] = 2;
      expect(parseImportedProject(malformed)).toBeNull();
      malformed.visuals.artifacts[0].source.assessment = { score: 2.35, confidence: .91 };
      expect(parseImportedProject(malformed)?.visuals?.artifacts[0].source?.assessment).toEqual({ score: 2.35, confidence: .91 });
    } finally { vi.unstubAllGlobals(); }
  });
});
