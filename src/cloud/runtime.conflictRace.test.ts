import { expect, it, vi } from 'vitest';
import { CloudRuntime, type CloudSnapshot } from './runtime';

const envelope = (title: string) => JSON.stringify({ version: 2, state: { projects: {}, tasks: {}, comments: {}, sprints: {}, folders: {}, boards: {}, legacyImported: true, notes: { n: { id: 'n', title, blocks: [{ id: 'text', type: 'text', text: title }], projectId: null, taskId: null, folderId: null, pinned: false, deletedAt: null, createdAt: 1, updatedAt: 2 } } } });
const snapshot = (value: string, revision: number): CloudSnapshot => ({ documents: [{ key: 'cellproject-workspace', value, revision }], media: [] });

it('keeps the rejected queue paused when a background retry overlaps explicit conflict resolution', async () => {
  let remote = snapshot(envelope('Tablet'), 2), reads = 0;
  let finishRead!: (value: CloudSnapshot) => void;
  const load = vi.fn(async () => ++reads === 2 ? await new Promise<CloudSnapshot>(resolve => { finishRead = resolve; }) : remote);
  let puts = 0;
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
    if (++puts === 1) return Response.json({ error: 'revision_conflict' }, { status: 409 });
    const body = JSON.parse(String(init?.body));
    remote = snapshot(body.value, body.baseRevision + 1);
    return Response.json({ revision: remote.documents[0].revision });
  });
  const journal = new Map<string, unknown>();
  const persistence = { read: async <T,>(key: string) => structuredClone(journal.get(key) ?? null) as T | null, write: async (key: string, value: unknown) => { journal.set(key, structuredClone(value)); }, remove: async (key: string) => { journal.delete(key); } };
  const runtime = new CloudRuntime(snapshot(envelope('Before'), 1), fetcher, undefined, load, { persistence });
  await runtime.write('cellproject-workspace', envelope('PC'));
  const before = runtime.checkpoint();
  const resolving = runtime.resolveConflictCopies();
  await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(2));
  const retrying = runtime.retry();
  try {
    expect(runtime.getSnapshot().issue).toEqual(before.issue);
    expect(runtime.checkpoint().queue).toEqual(before.queue);
    expect(fetcher).toHaveBeenCalledOnce();
  } finally {
    finishRead(remote);
    await Promise.allSettled([resolving, retrying]);
    runtime.dispose();
  }
});
