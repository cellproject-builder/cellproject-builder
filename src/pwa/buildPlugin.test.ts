import { expect, it, vi } from 'vitest';
import { pwaBuildPlugin } from './buildPlugin';

it('changes the worker release when bundled code changes and precaches only compiled public asset names', async () => {
  async function emit(code: string) {
    const plugin = pwaBuildPlugin(), emitFile = vi.fn();
    const registered = plugin.generateBundle;
    if (!registered) throw new Error('Missing generateBundle hook');
    const hook = typeof registered === 'function' ? registered : registered.handler;
    // This focused hook fixture supplies only the context method and bundle
    // fields the plugin reads; it is not a complete Rollup execution context.
    await Reflect.apply(hook, { emitFile }, [{}, { 'assets/index-release.js': { type: 'chunk', code }, 'assets/private.json': { type: 'asset', source: 'data' }, 'project.txt': { type: 'asset', source: 'data' } }, false]);
    return emitFile.mock.calls[0][0] as { fileName: string; source: string };
  }
  const first = await emit('version one'), second = await emit('version two');
  expect(first.fileName).toBe('service-worker.js'); expect(first.source).not.toBe(second.source);
  expect(first.source).not.toContain('__PWA_BUILD__'); expect(first.source).toContain('["/assets/index-release.js"]');
  expect(first.source).not.toContain('assets/private.json'); expect(first.source).not.toContain('project.txt');
});
