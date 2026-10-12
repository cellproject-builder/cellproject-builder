import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => { history.replaceState({}, '', '/'); vi.resetModules(); });

it.each(['/demo', '/demo/'])('keeps %s isolated after client-side navigation and clears edits on reload', async (path) => {
  history.replaceState({}, '', path);
  vi.resetModules();
  const session = await import('./session');
  session.demoStorage.setItem('workspace', 'example edit');
  history.replaceState({}, '', '/');
  expect(session.isPublicDemo()).toBe(true);
  expect(session.demoStorage.getItem('workspace')).toBe('example edit');

  history.replaceState({}, '', path);
  vi.resetModules();
  const reloaded = await import('./session');
  expect(reloaded.isPublicDemo()).toBe(true);
  expect(reloaded.demoStorage.getItem('workspace')).toBeNull();
});

it.each(['/', '/demo-other', '/demo/project', '/workspace?demo=1'])('keeps normal storage mode for %s even after navigation to the demo', async (path) => {
  history.replaceState({}, '', path);
  vi.resetModules();
  const session = await import('./session');
  history.replaceState({}, '', '/demo');
  expect(session.isPublicDemo()).toBe(false);
});
