import { describe, expect, it } from 'vitest';
import { preserveConflictCopies } from './conflictCopies';

const W = 'cellproject-workspace', G = 'cellproject-graph';
const envelope = (state: unknown, version = 2) => JSON.stringify({ state, version });
const input = (key: string, base: unknown, local: unknown, remote: unknown) => ({ key, base: envelope(base, key === G ? 6 : 2), local: envelope(local, key === G ? 6 : 2), remote: envelope(remote, key === G ? 6 : 2) });
const plan = (id: string, text: string) => ({ id, name: 'Plano', objective: text, rootId: 'root', nodes: { root: { id: 'root', name: text, parentId: null, position: { x: 0, y: 0 } } }, edges: {}, createdAt: 1, updatedAt: 1 });
const snapshot = (text: string) => ({ project: plan('plan', text), archivedProject: plan('older-plan', 'Anterior'), selectedNodeId: 'root', focusedParentId: 'root', lens: 'structure', viewMode: 'graph', detailPanelOpen: true, lastTutorNodeId: null, drafts: {}, objectiveDraft: { name: 'Plano', objective: text, rules: [], expanded: {} }, pendingSuggestions: null, parkedSuggestions: {}, archivedPending: null, archivedSession: null });
const managed = (id: string, text: string) => ({ id, name: id, objective: text, archived: false, createdAt: 1, updatedAt: 1, planner: snapshot(text) });
const workspace = (text: string) => ({ projects: { a: managed('a', text), b: managed('b', text) }, tasks: {}, sprints: {}, comments: {}, notes: {}, folders: {}, boards: {}, legacyImported: true });
const state = (result: ReturnType<typeof preserveConflictCopies>, key: string) => {
  expect(result).not.toBeNull();
  return JSON.parse(result!.documents.find(item => item.key === key)!.value).state;
};

describe('conflict copies integration with planner ownership', () => {
  it('uses the explicit managed owner when imported copies have identical planner snapshots', () => {
    const base = workspace('Before'), local = workspace('Local'), remote = workspace('Remote');
    const result = preserveConflictCopies([
      input(W, base, local, remote),
      input(G, { ...snapshot('Before'), plannerOwnerId: 'a' }, { ...snapshot('Local'), plannerOwnerId: 'a' }, { ...snapshot('Remote'), plannerOwnerId: 'b' }),
    ]);
    const w = state(result, W), g = state(result, G);
    const copy = Object.values(w.projects).find((project: any) => project.name === 'a (cópia deste aparelho)') as any;
    expect(copy).toBeDefined();
    expect(g.plannerOwnerId).toBe(copy.id);
    const { plannerOwnerId: _owner, ...content } = g;
    expect(content).toEqual(copy.planner);
    expect(w.projects.a).toEqual(remote.projects.a);
    expect(w.projects.b).toEqual(remote.projects.b);
  });

  it('fails closed for a legacy singleton matching multiple managed snapshots', () => {
    expect(preserveConflictCopies([
      input(W, workspace('Before'), workspace('Local'), workspace('Remote')),
      input(G, snapshot('Before'), snapshot('Local'), snapshot('Remote')),
    ])).toBeNull();
  });

  it('fails closed for a nonexistent explicit owner instead of inferring a matching project', () => {
    const result = preserveConflictCopies([
      input(W, workspace('Before'), workspace('Local'), workspace('Remote')),
      input(G, { ...snapshot('Before'), plannerOwnerId: 'missing' }, { ...snapshot('Local'), plannerOwnerId: 'missing' }, { ...snapshot('Remote'), plannerOwnerId: 'missing' }),
    ]);
    expect(result).toBeNull();
  });

  it('remaps archived session identity while preserving every authored archive payload', () => {
    const archive = {
      projectId: 'older-plan',
      drafts: { root: { explain: '  Texto arquivado\nsem normalização  ' } },
      parkedSuggestions: { root: { parentId: 'root', criteria: ['critério'], children: [], createdAt: 7 } },
      objectiveDraft: { name: 'Arquivo', objective: 'Árvore\n anterior', rules: ['mantenha  espaços'], expanded: { outline: { value: 'texto' } } },
    };
    const create = (text: string) => {
      const item = managed('a', text);
      return { ...workspace(text), projects: { a: { ...item, planner: { ...item.planner, archivedSession: archive } } } };
    };
    const base = create('Before'), local = create('Local'), remote = create('Remote');
    const original = JSON.stringify([base, local, remote]);
    const result = preserveConflictCopies([input(W, base, local, remote)]);
    const w = state(result, W), copy = Object.values(w.projects).find((project: any) => project.id !== 'a') as any;
    expect(copy.planner.archivedProject.id).not.toBe('older-plan');
    expect(copy.planner.archivedSession.projectId).toBe(copy.planner.archivedProject.id);
    const { projectId: _id, ...payload } = copy.planner.archivedSession;
    const { projectId: _oldId, ...authored } = archive;
    expect(JSON.stringify(payload)).toBe(JSON.stringify(authored));
    expect(w.projects.a).toEqual(remote.projects.a);
    expect(JSON.stringify([base, local, remote])).toBe(original);
  });
});
