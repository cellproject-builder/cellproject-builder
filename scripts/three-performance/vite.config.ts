import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// run.mjs copies this file beside the prepared fixture and frozen source trees.
const fixture = path.dirname(fileURLToPath(import.meta.url));
const run = path.dirname(fixture);
const manifest = JSON.parse(readFileSync(path.join(run, 'preparation.json'), 'utf8'));

export default defineConfig(({ mode }) => {
  if (!['baseline', 'candidate', 'baseline-off', 'candidate-off'].includes(mode)) throw new Error('Use run.mjs to prepare and build an explicit comparison.');
  const variant = mode.startsWith('baseline') ? 'baseline' : 'candidate';
  const source = path.join(run, 'sources', variant, 'src');
  return {
    root: fixture,
    base: `/${mode}/`,
    envDir: path.join(fixture, 'no-env'),
    plugins: [{
      name: 'synthetic-unused-storage-boundaries', enforce: 'pre',
      resolveId(specifier, importer) {
        if (importer?.replaceAll('\\', '/').endsWith('/src/visuals/rendering/VisualCanvasLayer.tsx') && ['../media', '../decompositionState'].includes(specifier)) return path.join(fixture, 'unused-boundaries.ts');
      },
    }, react()],
    resolve: { alias: {
      '@three-audit/VisualCanvasLayer': path.join(source, 'visuals/rendering/VisualCanvasLayer.tsx'),
      '@three-audit/viewStore': path.join(source, 'visuals/rendering/viewStore.ts'),
      '@': source,
    } },
    define: {
      __THREE_AUDIT_VARIANT__: JSON.stringify(`${mode}:${manifest[variant].label}`),
      __THREE_AUDIT_WEBGL_DEFAULT__: JSON.stringify(!mode.endsWith('-off')),
    },
    build: { outDir: path.join(run, 'dist', mode), emptyOutDir: true, sourcemap: true, minify: 'esbuild' },
  };
});
