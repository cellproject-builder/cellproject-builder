import { afterEach, expect, it, vi } from 'vitest';
import { CloudRuntime, configureCloud } from './runtime';
const snapshot = { documents: [{ key: 'cellproject-workspace', value: '{"state":{},"version":2}', revision: 4 }], media: [] };
const draft = '{"state":{"notes":{"n":"work after session expired"}},"version":2}';
afterEach(() => configureCloud(null));
it('resumes the same queued operation after the original user signs in in another tab', async () => {
  let writes = 0;
  const fetcher = vi.fn<typeof fetch>(async path => String(path).endsWith('/config') ? Response.json({ enabled: true, authenticated: true, user: { id: 'original-user' } }) : writes++ ? Response.json({ revision: 5 }) : Response.json({}, { status: 401 }));
  const runtime = new CloudRuntime(snapshot, fetcher); configureCloud(runtime);
  await runtime.write('cellproject-workspace', draft); const originalBody = fetcher.mock.calls[0][1]!.body;
  expect(runtime.getSnapshot().issue?.kind).toBe('session');
  await runtime.resumeAfterAuthentication('original-user');
  expect(fetcher.mock.calls[2][1]!.body).toBe(originalBody); expect(runtime.getSnapshot()).toMatchObject({ pending: 0, issue: null });
  expect(runtime.get('cellproject-workspace')).toBe(draft);
});
it('refuses another user without discarding drafts or retrying writes', async () => {
  const fetcher = vi.fn<typeof fetch>(async path => String(path).endsWith('/config') ? Response.json({ enabled: true, authenticated: true, user: { id: 'other-user' } }) : Response.json({}, { status: 403 }));
  const runtime = new CloudRuntime(snapshot, fetcher); configureCloud(runtime); await runtime.write('cellproject-workspace', draft);
  await expect(runtime.resumeAfterAuthentication('original-user')).rejects.toThrow('mesma conta');
  expect(fetcher).toHaveBeenCalledTimes(2); expect(runtime.getSnapshot()).toMatchObject({ pending: 1, issue: { kind: 'session' } }); expect(runtime.get('cellproject-workspace')).toBe(draft);
});
it('preserves CAS conflicts after reauthentication and never converts recovery into an overwrite', async () => {
  let writes = 0;
  const fetcher = vi.fn<typeof fetch>(async path => String(path).endsWith('/config') ? Response.json({ enabled: true, authenticated: true, user: { id: 'original-user' } }) : Response.json({}, { status: writes++ ? 409 : 401 }));
  const runtime = new CloudRuntime(snapshot, fetcher); configureCloud(runtime); await runtime.write('cellproject-workspace', draft);
  await runtime.resumeAfterAuthentication('original-user'); expect(runtime.getSnapshot()).toMatchObject({ pending: 1, issue: { kind: 'conflict' } });
  await runtime.resumeAfterAuthentication('original-user'); expect(fetcher).toHaveBeenCalledTimes(3); expect(runtime.get('cellproject-workspace')).toBe(draft);
});
