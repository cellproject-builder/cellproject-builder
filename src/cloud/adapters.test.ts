import { afterEach, expect, it, vi } from 'vitest';
import { CloudRuntime, configureCloud } from './runtime';

afterEach(() => configureCloud(null));
it('coalesces actual workspace edits instead of retaining a second store-level queue', async () => {
  let finish!: (response: Response) => void;
  const fetcher = vi.fn<typeof fetch>().mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; })).mockResolvedValue(Response.json({ revision: 2 }));
  const cloud = new CloudRuntime({ documents: [], media: [] }, fetcher); configureCloud(cloud);
  const { useWorkspaceStore, flushWorkspacePersistence } = await import('@/workspace/store');
  if (!useWorkspaceStore.persist.hasHydrated()) await new Promise<void>(resolve => { const stop = useWorkspaceStore.persist.onFinishHydration(() => { stop(); resolve(); }); });
  const id = useWorkspaceStore.getState().createNote({ title: 'first' });
  for (let i = 0; i < 100; i++) useWorkspaceStore.getState().updateNote(id, { title: `edit ${i}` });
  expect(cloud.getSnapshot().pending).toBe(2);
  expect(JSON.parse(cloud.get('cellproject-workspace')!).state.notes[id].title).toBe('edit 99');
  finish(Response.json({ revision: 1 })); await flushWorkspacePersistence();
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(JSON.parse(JSON.parse(fetcher.mock.calls[1][1]!.body as string).value).state.notes[id].title).toBe('edit 99');
});
