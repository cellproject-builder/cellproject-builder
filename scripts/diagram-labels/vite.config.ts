import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const repository = fileURLToPath(new URL('../..', import.meta.url));
export default defineConfig({
  root: repository, envDir: fileURLToPath(new URL('./no-env', import.meta.url)), envPrefix: [],
  plugins: [react()], define: { __DEV_OPENROUTER_KEY__: '""' },
  resolve: { alias: { '@': fileURLToPath(new URL('../../src', import.meta.url)) } },
  server: { host: '127.0.0.1', port: 5201, strictPort: true },
  build: { outDir: fileURLToPath(new URL('./dist', import.meta.url)), emptyOutDir: true, rollupOptions: { input: fileURLToPath(new URL('./index.html', import.meta.url)) } },
});
