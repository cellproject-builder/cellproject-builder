import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig(({ mode }) => {
  if (!['baseline', 'candidate'].includes(mode)) throw new Error('Use --mode baseline ou --mode candidate.');
  const base = path.resolve(__dirname, '../..');
  const variant = mode === 'baseline' ? path.join(base, '.codex-audit-interaction/baseline') : base;
  return {
    root: __dirname,
    envDir: path.join(__dirname, 'no-env'),
    plugins: [react()],
    resolve: { alias: { '@': path.join(variant, 'src') } },
    define: { __DEV_OPENROUTER_KEY__: '""', __INTERACTION_VARIANT__: JSON.stringify(mode) },
    build: {
      outDir: path.join(base, '.codex-audit-interaction/dist', `encrypted-${mode}`),
      emptyOutDir: true, sourcemap: true, target: 'esnext',
      rollupOptions: { input: path.join(__dirname, 'encrypted.html') },
    },
    base: `/encrypted-${mode}/`,
  };
});
