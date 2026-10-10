import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useGraphStore, EMPTY_OBJECTIVE_DRAFT, flushGraphPersistence } from '@/store';
import { useWorkspaceStore as store, flushWorkspacePersistence } from './store';
import { initializeWorkspace, openPlanner, capturePlanner, connectPlanner } from './planner';
import type { AIPlan } from '@/types';
import { registerAIAction } from '@/ai/actions';
import { workspaceRepository } from '@/data/workspaceRepository';
import type { SceneV1, VisualArtifact } from '@/visuals/types';

const plan: AIPlan = { id: 'plan', title: 'Plano', pitch: '', approach: '', strategy: 'reaproveitar', archetype: 'construir', rank: 1, rankReason: '', tree: { categorias: [{ tempId: 'cat', name: 'Execução', kind: 'execucao', oQue: '', porQue: '', children: [{ tempId: 'step', kind: 'passo', name: 'Construir', fx: '', problem: '', confidence: 80, confidenceReason: '', pros: [], cons: [], oQue: 'Construir algo', porQue: 'Entregar', comoConfirmar: 'Medir' }] }] } };

beforeEach(async () => {
  await Promise.all([store.persist.rehydrate(), useGraphStore.persist.rehydrate()]);
  store.setState({ projects: {}, tasks: {}, notes: {}, sprints: {}, folders: {}, legacyImported: false, activeProjectId: null, surface: 'projects' });
  useGraphStore.setState({ project: null, archivedProject: null, pendingSuggestions: null, parkedSuggestions: {}, drafts: {}, aiJobs: {}, objectiveDraft: { ...EMPTY_OBJECTIVE_DRAFT } });
});

describe('planner bridge', () => {
  it('migrates paid drafts, outlines, cached plans and selection without an existing graph', () => {
    const draft = { ...EMPTY_OBJECTIVE_DRAFT, name: 'Rascunho pago', objective: 'Construir', rules: ['Até R$300'], plans: [plan], outlines: [{ ...plan, outline: { categorias: [] } }], expanded: { plan }, selectedId: 'plan' };
    useGraphStore.setState({ objectiveDraft: draft });
    initializeWorkspace();
    const migrated = Object.values(store.getState().projects)[0];
    expect(migrated.name).toBe('Rascunho pago');
    const other = store.getState().createProject('Outro');
    openPlanner(other);
    openPlanner(migrated.id);
    expect(useGraphStore.getState().objectiveDraft).toMatchObject(draft);
  });

  it('clears interrupted generation markers after reload while preserving the draft', () => {
    initializeWorkspace();
    const id = store.getState().createProject('Em geração');
    openPlanner(id);
    useGraphStore.getState().setObjectiveDraft({ name: 'Em geração', plans: [plan], generatingSince: Date.now(), expansion: { outlineId: 'plan', startedAt: Date.now() } });
    store.getState().savePlanner(id, capturePlanner());
    initializeWorkspace(); // restart: no real AI request survived the reload
    expect(() => openPlanner(id)).not.toThrow();
    expect(useGraphStore.getState().objectiveDraft.generatingSince).toBeNull();
    expect(useGraphStore.getState().objectiveDraft.expansion).toBeNull();
    expect(useGraphStore.getState().objectiveDraft.plans).toEqual([plan]);
  });

  it('keeps a live action locked even when a legacy reset clears aiJobs', () => {
    initializeWorkspace();
    const a = store.getState().createProject('A');
    const b = store.getState().createProject('B');
    openPlanner(a);
    const finish = registerAIAction();
    try {
      useGraphStore.getState().resetProject();
      expect(() => openPlanner(b)).toThrow('plannerBusy');
    } finally { finish(); }
    expect(() => openPlanner(b)).not.toThrow();
  });

  it('imports existing projects once without discarding the archived project', () => {
    useGraphStore.getState().createProjectFromPlan('Objetivo', 'Existente', plan);
    const original = useGraphStore.getState().project!;
    useGraphStore.getState().resetProject();
    useGraphStore.getState().createProjectFromPlan('Outro', 'Atual', plan);
    initializeWorkspace();
    expect(Object.keys(store.getState().projects)).toHaveLength(2);
    expect(store.getState().projects[original.id].planner?.project?.id).toBe(original.id);
    initializeWorkspace();
    expect(Object.keys(store.getState().projects)).toHaveLength(2);
    expect(store.getState().surface).toBe('projects');
  });

  it('preserves each project planner draft and blocks switching during AI jobs', () => {
    initializeWorkspace();
    const a = store.getState().createProject('A');
    const b = store.getState().createProject('B');
    openPlanner(a);
    useGraphStore.getState().setObjectiveDraft({ name: 'Rascunho A' });
    openPlanner(b);
    expect(useGraphStore.getState().objectiveDraft.name).toBe('B');
    openPlanner(a);
    expect(useGraphStore.getState().objectiveDraft.name).toBe('Rascunho A');
    useGraphStore.setState({ aiJobs: { fake: { explain: { startedAt: Date.now(), kind: 'explain' } } } });
    expect(() => openPlanner(b)).toThrow('plannerBusy');
    expect(useGraphStore.getState().objectiveDraft.name).toBe('Rascunho A');
  });

  it('imports only actionable plan leaves, keeps origin and does not duplicate', () => {
    initializeWorkspace();
    const id = store.getState().createProject('Gestão');
    useGraphStore.getState().createProjectFromPlan('Objetivo', 'Plano', plan);
    store.getState().savePlanner(id, capturePlanner());
    expect(store.getState().importPlanTasks(id)).toBe(1);
    expect(store.getState().importPlanTasks(id)).toBe(0);
    const task = Object.values(store.getState().tasks)[0];
    expect(task.sourceNodeId).toBeDefined();
    store.getState().updateTask(task.id, { status: 'done' });
    expect(store.getState().projects[id].planner?.project?.nodes[task.sourceNodeId!].confirmado).toBe(false);
  });

  it('does not rewrite a valid documented model when an idle workspace remounts or initializes again', async () => {
    initializeWorkspace();
    const id = store.getState().createProject('Arduino documentado');
    openPlanner(id);
    useGraphStore.getState().createProjectFromPlan('Arduino Uno', 'Placa', plan);
    const scene: SceneV1 = { version: 1, label: 'Arduino Uno', objects: [
      { id: 'mcu-body', type: 'box', position: [0,0,0], rotation: [0,0,0], scale: [2,1,1], color: '#444444' },
    ] };
    const object: VisualArtifact = { id: 'documented-model', label: scene.label, kind: 'model', x: 10, y: 20, width: 300, height: 220,
      mediaId: null, scene, source: null, revisions: [{ scene, mediaId: null, createdAt: 1 }], revisionIndex: 0,
      decomposition: { version: 1, id: 'dossier', identity: scene.label, artifactFingerprint: 'record-fingerprint', sourceImageIds: [], researchedAt: 1, assemblyArtifactId: 'documented-parts',
        sources: [{ id: 'official', url: 'https://docs.arduino.cc/hardware/uno-rev3/', title: 'Arduino Uno Rev3', text: 'The Arduino Uno uses the ATmega328P microcontroller.', retrievedAt: 1 }],
        parts: [{ id: 'mcu', name: 'Microcontrolador', partNumber: 'ATmega328P', quantity: null, role: 'Executa o programa', specifications: ['ATmega328P'],
          evidence: [{ sourceId: 'official', quote: 'The Arduino Uno uses the ATmega328P microcontroller.' }], unknowns: [] }], unknowns: [],
        assembly: { scene, groups: [{ partId: 'mcu', objectIds: ['mcu-body'], explodeOffset: [0,2,0] }], createdAt: 2, dossierId: 'dossier', dossierFingerprint: 'research-fingerprint', selectedPartIds: ['mcu'] },
      },
    };
    // Deliberately use a different property order from the validator. Equality
    // here is structural; serializing objects with ordered keys is insufficient.
    useGraphStore.setState(state => ({ project: { ...state.project!, visuals: { mode: 'approval', version: 1, drafts: {
      model: { attachments: [], mentions: [], text: '' }, search: { attachments: [], mentions: [], text: '' },
    }, proposals: [], artifacts: [object, { ...object, id: 'documented-parts', sourceArtifactId: object.id, x: 374 }] } } }));
    store.getState().savePlanner(id, capturePlanner());
    await Promise.all([flushWorkspacePersistence(), flushGraphPersistence()]);
    const projectBefore = useGraphStore.getState().project;
    const managedBefore = store.getState().projects[id];
    const graphChanged = vi.fn(), workspaceChanged = vi.fn();
    const offGraph = useGraphStore.subscribe(graphChanged), offWorkspace = store.subscribe(workspaceChanged), disconnect = connectPlanner();
    const save = vi.spyOn(workspaceRepository, 'setItem');
    try {
      initializeWorkspace(); initializeWorkspace();
      await Promise.all([flushWorkspacePersistence(), flushGraphPersistence()]);
      expect(useGraphStore.getState().project).toBe(projectBefore);
      expect(store.getState().projects[id]).toBe(managedBefore);
      expect(useGraphStore.getState().project?.visuals?.artifacts[0].decomposition).toEqual(object.decomposition);
      expect(useGraphStore.getState().project?.visuals?.artifacts).toHaveLength(2);
      expect(graphChanged).not.toHaveBeenCalled();
      expect(workspaceChanged).not.toHaveBeenCalled();
      expect(save).not.toHaveBeenCalled();
    } finally { save.mockRestore(); disconnect(); offGraph(); offWorkspace(); }
  });
});
