import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';

/** A changed build produces a changed worker, without caching development/HMR bundles. */
export function pwaBuildPlugin(): Plugin {
  let root = '';
  return {
    name: 'public-shell-pwa', apply: 'build',
    configResolved(config) { root = config.root; },
    async generateBundle(_options, bundle) {
      const files = Object.keys(bundle).filter(name => /^assets\/[A-Za-z0-9_.-]+\.(m?js|css|woff2?|ttf|png|jpg|jpeg|svg|webp)$/.test(name)).sort();
      const release = createHash('sha256');
      for (const name of files) { const item = bundle[name]; release.update(name); release.update(item.type === 'chunk' ? item.code : item.source); }
      release.update(await readFile(resolve(root, 'index.html')));
      const template = await readFile(resolve(root, 'public/service-worker.js'), 'utf8'); release.update(template);
      for (const name of ['manifest.webmanifest', 'pwa/icon-192.png', 'pwa/icon-512.png', 'pwa/maskable-512.png', 'pwa/apple-touch-icon.png']) release.update(await readFile(resolve(root, 'public', name)));
      const source = template.replaceAll('__PWA_BUILD__', release.digest('hex').slice(0, 16)).replace('/*__PWA_ASSETS__*/ []', JSON.stringify(files.map(name => '/' + name)));
      this.emitFile({ type: 'asset', fileName: 'service-worker.js', source });
    },
  };
}
