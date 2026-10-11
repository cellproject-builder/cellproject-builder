import { afterEach, expect, it, vi } from 'vitest';
import { CloudRuntime, configureCloud } from './runtime';

afterEach(() => configureCloud(null));
it('coalesces actual workspace edits before flushing to the captured cloud backend', async () => {
  let finish!: (response: Response) => void;
  const firstReply = new Promise<Response>(resolve => { finish = resolve; });
  const fetcher = vi.fn<typeof fetch>().mockImplementationOnce(() => firstReply).mockResolvedValue(Response.json({ revision: 2 }));
  const cloud = new CloudRuntime({ documents: [], media: [] }, fetcher); configureCloud(cloud);
  const { useWorkspaceStore, flushWorkspacePersistence } = await import('@/workspace/store');
  if (!useWorkspaceStore.persist.hasHydrated()) await new Promise<void>(resolve => { const stop = useWorkspaceStore.persist.onFinishHydration(() => { stop(); resolve(); }); });
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  try {
    const id = useWorkspaceStore.getState().createNote({ title: 'first' });
    for (let i = 0; i < 100; i++) useWorkspaceStore.getState().updateNote(id, { title: `edit ${i}` });
    expect(fetcher).not.toHaveBeenCalled();
    const saving = flushWorkspacePersistence();
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    expect(cloud.getSnapshot().pending).toBe(1);
    expect(JSON.parse(cloud.get('cellproject-workspace')!).state.notes[id].title).toBe('edit 99');
    expect(fetcher.mock.calls[0][0]).toBe('/api/cloud/documents/cellproject-workspace');
    finish(Response.json({ revision: 1 })); await saving;
    expect(cloud.getSnapshot().pending).toBe(0);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(JSON.parse(JSON.parse(fetcher.mock.calls[0][1]!.body as string).value).state.notes[id].title).toBe('edit 99');
  } finally {
    finish(Response.json({ revision: 1 }));
    await flushWorkspacePersistence();
    vi.useRealTimers();
  }
});
