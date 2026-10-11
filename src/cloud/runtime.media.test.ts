import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { CloudRuntime, configureCloud, sha256, type CloudMedia } from './runtime';

const runtimes = new Set<CloudRuntime>();
const decode = (bytes: ArrayBuffer | null) => new TextDecoder().decode(bytes!);
async function file(id: string, content: string | ArrayBuffer) {
  const bytes = typeof content === 'string' ? new TextEncoder().encode(content).buffer : content;
  const metadata: CloudMedia = { id, mime: 'application/pdf', name: `${id}.pdf`, size: bytes.byteLength, sha256: await sha256(bytes) };
  return { bytes, metadata };
}
function runtime(media: CloudMedia[], fetcher: typeof fetch) {
  const value = new CloudRuntime({ documents: [], media }, fetcher); runtimes.add(value); return value;
}
beforeEach(() => { vi.stubGlobal('crypto', webcrypto); configureCloud(null); });
afterEach(() => { configureCloud(null); for (const value of runtimes) value.dispose(); runtimes.clear(); vi.unstubAllGlobals(); });

describe('runtime media byte cache', () => {
  it('downloads one immutable media once for simultaneous readers and returns independent buffers', async () => {
    const original = await file('manual', 'original');
    const responses: ((response: Response) => void)[] = [];
    const fetcher = vi.fn<typeof fetch>(() => new Promise(resolve => { responses.push(resolve); }));
    const cloud = runtime([original.metadata], fetcher);
    const reads = [cloud.readMedia('manual'), cloud.readMedia('manual'), cloud.readMedia('manual')];
    const calls = fetcher.mock.calls.length;
    for (const finish of responses) finish(new Response(original.bytes));
    const [first, second, third] = await Promise.all(reads);
    expect(calls).toBe(1); expect(decode(first)).toBe('original');
    expect(first).not.toBe(second); expect(second).not.toBe(third);
    new Uint8Array(first!)[0] = 88;
    expect(decode(second)).toBe('original'); expect(decode(await cloud.readMedia('manual'))).toBe('original');
    const cached = cloud.cachedMedia('manual')!; new Uint8Array(cached)[0] = 88;
    expect(decode(cloud.cachedMedia('manual'))).toBe('original');
  });

  it('keeps different media reads concurrent instead of putting them in one download queue', async () => {
    const one = await file('one', 'one'), two = await file('two', 'two');
    const responses = new Map<string, (response: Response) => void>();
    const fetcher = vi.fn<typeof fetch>(path => new Promise(resolve => { responses.set(String(path), resolve); }));
    const cloud = runtime([one.metadata, two.metadata], fetcher);
    let firstSettled = false;
    const first = cloud.readMedia('one').then(bytes => { firstSettled = true; return bytes; });
    const second = cloud.readMedia('two');
    expect(responses.size).toBe(2);
    responses.get('/api/cloud/media/two')!(new Response(two.bytes));
    expect(decode(await second)).toBe('two'); expect(firstSettled).toBe(false);
    responses.get('/api/cloud/media/one')!(new Response(one.bytes));
    expect(decode(await first)).toBe('one');
  });

  it('evicts the least recently used bytes above 32 MiB across reads and writes and reclaims removed entries', async () => {
    const files = await Promise.all(['a', 'b', 'c', 'd'].map((id, index) => file(id, new Uint8Array(9 * 1024 * 1024).fill(index + 1).buffer)));
    const fetcher = vi.fn<typeof fetch>(async path => new Response(files.find(item => String(path).endsWith('/' + item.metadata.id))!.bytes));
    const cloud = runtime(files.map(item => item.metadata), fetcher);
    for (const id of ['a', 'b', 'c']) await cloud.readMedia(id);
    expect(cloud.cachedMedia('a')?.byteLength).toBe(9 * 1024 * 1024);
    await cloud.writeMedia({ ...files[3].metadata, bytes: files[3].bytes });
    expect(cloud.cachedMedia('b') === null).toBe(true);
    for (const id of ['a', 'c', 'd']) expect(cloud.cachedMedia(id)?.byteLength).toBe(9 * 1024 * 1024);
    await cloud.adoptRecoveredSnapshot({ documents: [], media: files.filter(item => item.metadata.id !== 'a').map(item => item.metadata) });
    expect(cloud.cachedMedia('a')).toBeNull();
    await cloud.readMedia('b');
    for (const id of ['b', 'c', 'd']) expect(cloud.cachedMedia(id)?.byteLength).toBe(9 * 1024 * 1024);
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it('does not let a previous catalog identity overwrite a newer file after its download finishes', async () => {
    const old = await file('manual', 'old'), fresh = await file('manual', 'fresh');
    const responses: ((response: Response) => void)[] = [];
    const fetcher = vi.fn<typeof fetch>(() => new Promise(resolve => { responses.push(resolve); }));
    const cloud = runtime([old.metadata], fetcher);
    const stale = cloud.readMedia('manual').then(value => ({ value }), error => ({ error }));
    await cloud.adoptRecoveredSnapshot({ documents: [], media: [fresh.metadata] });
    const freshRead = cloud.readMedia('manual');
    responses[0](new Response(old.bytes)); const staleOutcome = await stale;
    const joinedRead = cloud.readMedia('manual'), calls = fetcher.mock.calls.length;
    for (const finish of responses.slice(1)) finish(new Response(fresh.bytes));
    const current = await Promise.all([freshRead, joinedRead]);
    expect(staleOutcome).toHaveProperty('error'); expect(current.map(decode)).toEqual(['fresh', 'fresh']); expect(calls).toBe(2);
    expect(decode(cloud.cachedMedia('manual'))).toBe('fresh');
  });

  it('invalidates a pending read when the catalog removes its media', async () => {
    const original = await file('manual', 'original'); let finish!: (response: Response) => void;
    const cloud = runtime([original.metadata], vi.fn<typeof fetch>(() => new Promise(resolve => { finish = resolve; })));
    const stale = cloud.readMedia('manual').then(value => ({ value }), error => ({ error }));
    await cloud.adoptRecoveredSnapshot({ documents: [], media: [] });
    finish(new Response(original.bytes));
    expect(await stale).toHaveProperty('error'); expect(cloud.cachedMedia('manual')).toBeNull();
    expect(await cloud.readMedia('manual')).toBeNull();
  });

  it('lets a confirmed write supersede a pending read without losing its owned bytes', async () => {
    const original = await file('manual', 'original'); let finish!: (response: Response) => void;
    const cloud = runtime([original.metadata], vi.fn<typeof fetch>(() => new Promise(resolve => { finish = resolve; })));
    const pending = cloud.readMedia('manual').then(value => ({ value }), error => ({ error }));
    await cloud.writeMedia({ ...original.metadata, bytes: original.bytes });
    finish(new Response(original.bytes));
    expect(await pending).toHaveProperty('error'); expect(decode(cloud.cachedMedia('manual'))).toBe('original');
  });

  it('owns a copy before hashing a write so caller mutation cannot corrupt the verified cache', async () => {
    const original = await file('manual', 'original'), cloud = runtime([original.metadata], vi.fn<typeof fetch>());
    const writing = cloud.writeMedia({ ...original.metadata, bytes: original.bytes });
    new Uint8Array(original.bytes).fill(88);
    await writing; expect(decode(cloud.cachedMedia('manual'))).toBe('original');
  });

  it('does not repopulate media when disposed while hashing an existing file write', async () => {
    const original = await file('manual', 'original'), cloud = runtime([original.metadata], vi.fn<typeof fetch>());
    const writing = cloud.writeMedia({ ...original.metadata, bytes: original.bytes }); cloud.dispose();
    await expect(writing).rejects.toThrow('Sessão encerrada'); expect(cloud.cachedMedia('manual')).toBeNull();
  });

  it('clears a failed shared read so a later retry still checks integrity and succeeds', async () => {
    const original = await file('manual', 'original');
    const fetcher = vi.fn<typeof fetch>().mockImplementationOnce(async () => new Response('corrupt')).mockImplementationOnce(async () => new Response(original.bytes));
    const cloud = runtime([original.metadata], fetcher);
    const first = cloud.readMedia('manual'), second = cloud.readMedia('manual');
    const outcomes = await Promise.allSettled([first, second]);
    expect(outcomes.map(item => item.status)).toEqual(['rejected', 'rejected']);
    expect(cloud.cachedMedia('manual')).toBeNull();
    expect(decode(await cloud.readMedia('manual'))).toBe('original'); expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('keeps bytes isolated when the active account runtime changes during a read', async () => {
    const old = await file('manual', 'old account'), fresh = await file('manual', 'new account');
    let finish!: (response: Response) => void;
    const before = runtime([old.metadata], vi.fn<typeof fetch>(() => new Promise(resolve => { finish = resolve; })));
    configureCloud(before);
    const pending = before.readMedia('manual').then(value => ({ value }), error => ({ error }));
    const after = runtime([fresh.metadata], vi.fn<typeof fetch>(async () => new Response(fresh.bytes))); configureCloud(after);
    expect(decode(await after.readMedia('manual'))).toBe('new account');
    finish(new Response(old.bytes)); expect(await pending).toHaveProperty('error');
    expect(before.cachedMedia('manual')).toBeNull(); expect(decode(after.cachedMedia('manual'))).toBe('new account');
  });
});
