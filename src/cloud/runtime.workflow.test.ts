import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { WorkspaceData } from '@/data/workspaceTransfer';
import type { Task } from '@/workspace/types';
import { CloudConflictError, CloudRuntime, configureCloud, type CheckpointStore, type CloudSnapshot, type RuntimeCheckpoint } from './runtime';

const KEY = 'cellproject-workspace';
const initialWorkspace = (): WorkspaceData => ({
  projects: { project: { id: 'project', name: 'Projeto de teste', objective: 'Investigar uma entrega', archived: false, createdAt: 1, updatedAt: 1 } },
  tasks: { task: { id: 'task', projectId: 'project', title: 'Conferir a entrega', description: '', status: 'todo', priority: 'medium', dueDate: '', sprintId: null, createdAt: 1, updatedAt: 1 } },
  comments: {}, sprints: {}, notes: {}, folders: {}, boards: {}, legacyImported: true,
});
const encode = (state: WorkspaceData) => JSON.stringify({ version: 2, state });
const decode = (value: string): WorkspaceData => (JSON.parse(value) as { state: WorkspaceData }).state;

/** The same revision and operation identity checks used by the document endpoint. */
function casServer() {
  let value = encode(initialWorkspace()), revision = 1;
  const receipts = new Map<string, { body: string; revision: number }>();
  const accepted: { operationId: string; baseRevision: number; revision: number; state: WorkspaceData }[] = [];
  let rejected = 0;
  const snapshot = (): CloudSnapshot => ({ documents: [{ key: KEY, value, revision }], media: [] });
  const fetcher: typeof fetch = async (path, init) => {
    if (String(path) !== `/api/cloud/documents/${KEY}` || init?.method !== 'PUT' || typeof init.body !== 'string') throw new Error('Unexpected test server request');
    const body = JSON.parse(init.body) as { operationId: string; baseRevision: number; value: string };
    const receipt = receipts.get(body.operationId);
    if (receipt) return receipt.body === init.body ? Response.json({ revision: receipt.revision }) : Response.json({ error: 'vault_operation_conflict' }, { status: 409 });
    if (body.baseRevision !== revision) { rejected++; return Response.json({ error: 'revision_conflict' }, { status: 409 }); }
    value = body.value; revision++;
    receipts.set(body.operationId, { body: init.body, revision });
    accepted.push({ operationId: body.operationId, baseRevision: body.baseRevision, revision, state: decode(value) });
    return Response.json({ revision });
  };
  return { snapshot, fetcher, accepted, current: () => decode(value), rejectionCount: () => rejected };
}

function checkpointStore(): CheckpointStore {
  const slots = new Map<string, unknown>();
  return {
    read: async <T,>(slot: string) => (slots.has(slot) ? structuredClone(slots.get(slot)) : null) as T | null,
    write: async (slot, value) => { slots.set(slot, structuredClone(value)); },
    remove: async slot => { slots.delete(slot); },
  };
}

const runtimes: CloudRuntime[] = [];
beforeEach(() => configureCloud(null));
afterEach(() => { runtimes.splice(0).forEach(runtime => runtime.dispose()); configureCloud(null); });

describe('two-device task status workflow', () => {
  it('preserves remote descriptions through offline status intent, stale stores, alternating writes and checkpoint reload despite skewed clocks', async () => {
    const server = casServer(), persistence = checkpointStore(), original = server.snapshot();
    let onlineA = false;
    let clientA = new CloudRuntime(original, server.fetcher, undefined, async () => server.snapshot(), { persistence, networkReady: () => onlineA });
    const clientB = new CloudRuntime(original, server.fetcher, undefined, async () => server.snapshot());
    runtimes.push(clientA, clientB);
    let storeA = initialWorkspace(), storeB = initialWorkspace();
    // These are deliberately different device clocks, not a global ordering rule.
    let clockA = 10, clockB = 4_000_000;
    const editA = async (patch: Partial<Task>) => {
      storeA = { ...storeA, tasks: { ...storeA.tasks, task: { ...storeA.tasks.task, ...patch, updatedAt: clockA++ } } };
      await clientA.write(KEY, encode(storeA));
    };
    const editB = async (patch: Partial<Task>) => {
      storeB = { ...storeB, tasks: { ...storeB.tasks, task: { ...storeB.tasks.task, ...patch, updatedAt: clockB++ } } };
      await clientB.write(KEY, encode(storeB));
    };
    const expectCanonical = (description: string, status: Task['status'], priority: Task['priority'] = 'medium') => {
      expect(server.current().tasks.task).toMatchObject({ description, status, priority });
      expect(Object.keys(server.current().projects)).toEqual(['project']);
      expect(Object.keys(server.current().tasks)).toEqual(['task']);
    };

    await editB({ description: 'Descrição escrita no tablet com contexto completo.', status: 'doing' });
    await clientB.flush();
    await editA({ status: 'review' });
    expect(clientA.getSnapshot()).toMatchObject({ pending: 1, localSaved: true, offline: true });
    expectCanonical('Descrição escrita no tablet com contexto completo.', 'doing');
    onlineA = true; clientA.notifyNetworkState();
    await clientA.retry();
    await expect(clientA.flush()).resolves.toBeUndefined();
    expect(clientA.getSnapshot()).toMatchObject({ pending: 0, issue: null });
    expectCanonical('Descrição escrita no tablet com contexto completo.', 'review');

    // Rebase has updated the runtime, while the editor still holds its previous full document.
    expect(storeA.tasks.task.description).toBe('');
    expect(decode(clientA.get(KEY)!).tasks.task.description).toBe('Descrição escrita no tablet com contexto completo.');
    await editA({ status: 'done' }); await clientA.flush();
    expectCanonical('Descrição escrita no tablet com contexto completo.', 'done');
    // An unrelated edit from B's old view must not reassert its old `doing` status.
    await editB({ priority: 'high' }); await clientB.flush();
    expectCanonical('Descrição escrita no tablet com contexto completo.', 'done', 'high');

    for (const [nextA, nextB] of [['todo', 'review'], ['doing', 'done'], ['review', 'todo']] as const) {
      await editA({ status: nextA }); await clientA.flush();
      expectCanonical('Descrição escrita no tablet com contexto completo.', nextA, 'high');
      await editB({ status: nextB }); await clientB.flush();
      expectCanonical('Descrição escrita no tablet com contexto completo.', nextB, 'high');
      expect(clientA.getSnapshot().issue).toBeNull();
      expect(clientB.getSnapshot().issue).toBeNull();
    }

    // Reload the offline durable queue before the other client makes another real edit.
    onlineA = false; clientA.notifyNetworkState();
    await editA({ status: 'doing' });
    const saved = await persistence.read<RuntimeCheckpoint>('runtime');
    expect(saved?.queue).toHaveLength(1);
    clientA.dispose();
    await editB({ description: 'Descrição revisada no tablet enquanto o PC estava offline.', status: 'review' }); await clientB.flush();
    clientA = new CloudRuntime(server.snapshot(), server.fetcher, undefined, async () => server.snapshot(), { persistence, networkReady: () => onlineA, checkpoint: saved });
    runtimes.push(clientA);
    storeA = decode(clientA.get(KEY)!);
    expect(storeA.tasks.task.status).toBe('doing');
    onlineA = true; clientA.notifyNetworkState();
    await clientA.retry(); await clientA.flush();
    expectCanonical('Descrição revisada no tablet enquanto o PC estava offline.', 'doing', 'high');
    await editA({ status: 'done' }); await clientA.flush();
    expectCanonical('Descrição revisada no tablet enquanto o PC estava offline.', 'done', 'high');
    expect((await persistence.read<RuntimeCheckpoint>('runtime'))?.queue).toEqual([]);

    await clientA.refreshRemote({ keys: [KEY], apply: documents => { storeA = decode(documents.find(document => document.key === KEY)!.value); } });
    await clientB.refreshRemote({ keys: [KEY], apply: documents => { storeB = decode(documents.find(document => document.key === KEY)!.value); } });
    expect(decode(clientA.get(KEY)!)).toEqual(server.current());
    expect(decode(clientB.get(KEY)!)).toEqual(server.current());
    expect(server.rejectionCount()).toBeGreaterThanOrEqual(4);
    expect(new Set(server.accepted.map(operation => operation.operationId)).size).toBe(server.accepted.length);
    expect(server.accepted.every(operation => operation.revision === operation.baseRevision + 1)).toBe(true);
  });

  it('keeps divergent task descriptions in conflict instead of applying a broad local overwrite', async () => {
    const server = casServer(), base = server.snapshot();
    const clientA = new CloudRuntime(base, server.fetcher, undefined, async () => server.snapshot());
    const clientB = new CloudRuntime(base, server.fetcher, undefined, async () => server.snapshot());
    runtimes.push(clientA, clientB);
    const local = initialWorkspace(), remote = initialWorkspace();
    remote.tasks.task = { ...remote.tasks.task, description: 'Texto do tablet', status: 'doing', updatedAt: 4_000_000 };
    local.tasks.task = { ...local.tasks.task, description: 'Texto incompatível do PC', status: 'review', updatedAt: 10 };
    await clientB.write(KEY, encode(remote)); await clientB.flush();
    await clientA.write(KEY, encode(local));
    await expect(clientA.flush()).rejects.toBeInstanceOf(CloudConflictError);
    expect(clientA.getSnapshot()).toMatchObject({ pending: 1, issue: { kind: 'conflict' } });
    expect(server.current().tasks.task).toMatchObject({ description: 'Texto do tablet', status: 'doing' });
    expect(decode(clientA.get(KEY)!).tasks.task).toMatchObject({ description: 'Texto incompatível do PC', status: 'review' });
    expect(Object.keys(server.current().projects)).toEqual(['project']);
  });

  it('recovers an already rejected legacy checkpoint whose confirmed remote state is newer than its explicit status intent', async () => {
    const server = casServer(), base = server.snapshot(), persistence = checkpointStore();
    const tablet = new CloudRuntime(base, server.fetcher, undefined, async () => server.snapshot());
    runtimes.push(tablet);
    const remote = initialWorkspace();
    remote.tasks.task = { ...remote.tasks.task, description: 'Contexto novo já confirmado no tablet', status: 'doing', updatedAt: 4_000_000 };
    await tablet.write(KEY, encode(remote)); await tablet.flush();
    const local = initialWorkspace();
    local.tasks.task = { ...local.tasks.task, status: 'review', updatedAt: 10 };
    const operationId = 'legacy-task-status-draft';
    const saved: RuntimeCheckpoint = {
      version: 1, confirmed: server.snapshot(), drafts: [[KEY, encode(local)]],
      queue: [{ key: KEY, value: encode(local), operationId, baseValue: base.documents[0].value, rejected: true }],
      issue: { kind: 'conflict', key: KEY, message: 'Conflito preservado por uma versão anterior' },
    };
    expect(Object.hasOwn(saved.queue[0], 'baseRevision')).toBe(false);
    const retired: string[] = [];
    const recovered = new CloudRuntime(server.snapshot(), server.fetcher, undefined, async () => server.snapshot(), {
      persistence, checkpoint: saved, rejectOperation: async id => { retired.push(id); },
    });
    runtimes.push(recovered);
    await recovered.retry();
    await expect(recovered.flush()).resolves.toBeUndefined();
    expect(server.current().tasks.task).toMatchObject({ description: 'Contexto novo já confirmado no tablet', status: 'review' });
    expect(Object.keys(server.current().projects)).toEqual(['project']);
    expect(Object.keys(server.current().tasks)).toEqual(['task']);
    expect(recovered.getSnapshot()).toMatchObject({ pending: 0, issue: null, localSaved: true });
    expect((await persistence.read<RuntimeCheckpoint>('runtime'))?.queue).toEqual([]);
    expect(retired).toEqual([operationId]);
    expect(server.accepted.at(-1)?.operationId).not.toBe(operationId);
  });
});
