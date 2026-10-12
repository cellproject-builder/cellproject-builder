import { expect, it, vi } from 'vitest';
import { CloudRuntime, type CloudSnapshot } from './runtime';

const envelope = (title: string) => JSON.stringify({ version: 2, state: { projects: {}, tasks: {}, comments: {}, sprints: {}, folders: {}, boards: {}, legacyImported: true, notes: { n: { id: 'n', title, blocks: [{ id: 'text', type: 'text', text: title }], projectId: null, taskId: null, folderId: null, pinned: false, deletedAt: null, createdAt: 1, updatedAt: 2 } } } });
const snapshot = (value: string, revision = 1): CloudSnapshot => ({ documents: [{ key: 'cellproject-workspace', value, revision }], media: [] });
const rejected = () => Response.json({ error: 'revision_conflict' }, { status: 409 });
function fixture() {
  let remote = snapshot(envelope('Tablet'), 2);
  const journal = new Map<string, unknown>();
  const persistence = { read: async <T,>(key: string) => structuredClone(journal.get(key) ?? null) as T | null, write: vi.fn(async (key: string, value: unknown) => { journal.set(key, structuredClone(value)); }), remove: async (key: string) => { journal.delete(key); } };
  const retire = vi.fn(async (_id: string) => {});
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(rejected()).mockImplementation(async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    const checkpoint = journal.get('runtime') as ReturnType<CloudRuntime['checkpoint']>;
    expect(checkpoint.queue[0].operationId).toBe(body.operationId);
    expect(checkpoint.queue[0].value).toBe(body.value);
    remote = snapshot(body.value, body.baseRevision + 1);
    return Response.json({ revision: remote.documents[0].revision });
  });
  const load = vi.fn(async () => remote);
  const runtime = new CloudRuntime(snapshot(envelope('Before')), fetcher, undefined, load, { persistence, rejectOperation: retire });
  return { runtime, fetcher, load, journal, persistence, retire, remote: () => remote };
}

it('resolves an incompatible note only by preserving both versions with a fresh durable CAS identity', async () => {
  const f = fixture(); await f.runtime.write('cellproject-workspace', envelope('PC'));
  const rejectedId = f.runtime.checkpoint().queue[0].operationId;
  expect(f.runtime.getSnapshot().issue?.kind).toBe('conflict');
  expect(await f.runtime.resolveConflictCopies()).toBe(1);
  const notes = Object.values(JSON.parse(f.remote().documents[0].value).state.notes) as { id: string; title: string; blocks: { text: string }[] }[];
  expect(notes.find(note => note.id === 'n')!.blocks[0].text).toBe('Tablet');
  expect(notes.find(note => note.id !== 'n')!.blocks[0].text).toBe('PC');
  expect(f.runtime.getSnapshot()).toMatchObject({ pending: 0, issue: null, localSaved: true });
  expect(f.retire).toHaveBeenCalledWith(rejectedId);
  const replacement = JSON.parse(String(f.fetcher.mock.calls[1][1]?.body));
  expect(replacement.baseRevision).toBe(2); expect(replacement.operationId).not.toBe(rejectedId);
});

it('keeps the rejected draft and identity when the replacement checkpoint cannot be saved', async () => {
  const f = fixture(); await f.runtime.write('cellproject-workspace', envelope('PC'));
  const before = f.runtime.checkpoint();
  f.persistence.write.mockRejectedValue(new Error('quota'));
  await expect(f.runtime.resolveConflictCopies()).rejects.toThrow('quota');
  expect(f.runtime.checkpoint().queue).toEqual(before.queue);
  expect(f.runtime.get('cellproject-workspace')).toBe(envelope('PC'));
  expect(f.fetcher).toHaveBeenCalledOnce(); expect(f.retire).not.toHaveBeenCalled();
});

it('invalidates the resolution if the user edits while reading the remote version', async () => {
  const f = fixture(); await f.runtime.write('cellproject-workspace', envelope('PC'));
  let finish!: (value: CloudSnapshot) => void;
  f.load.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const pending = f.runtime.resolveConflictCopies();
  await vi.waitFor(() => expect(f.load).toHaveBeenCalledTimes(2));
  await f.runtime.write('cellproject-workspace', envelope('Newer PC draft'));
  finish(f.remote());
  await expect(pending).rejects.toThrow(/mudaram/);
  expect(f.runtime.get('cellproject-workspace')).toBe(envelope('Newer PC draft'));
  expect(f.fetcher).toHaveBeenCalledOnce(); expect(f.retire).not.toHaveBeenCalled();
});

it('does not resolve an ambiguous rejection, an offline owner, or a busy editor', async () => {
  const load = vi.fn(async () => snapshot(envelope('Tablet'), 2));
  const ambiguous = new CloudRuntime(snapshot(envelope('Before')), vi.fn(async () => Response.json({ error: 'vault_operation_conflict' }, { status: 409 })), undefined, load);
  await ambiguous.write('cellproject-workspace', envelope('PC'));
  await expect(ambiguous.resolveConflictCopies()).rejects.toThrow(); expect(load).not.toHaveBeenCalled();
  const f = fixture(); await f.runtime.write('cellproject-workspace', envelope('PC'));
  await expect(f.runtime.resolveConflictCopies({ isIdle: () => false })).rejects.toThrow();
  expect(f.load).toHaveBeenCalledOnce(); expect(f.fetcher).toHaveBeenCalledOnce();
  const offline = new CloudRuntime(snapshot(envelope('Before')), fetch, undefined, load, { checkpoint: f.runtime.checkpoint(), networkReady: () => false });
  await expect(offline.resolveConflictCopies()).rejects.toThrow(); expect(load).not.toHaveBeenCalled();
});
