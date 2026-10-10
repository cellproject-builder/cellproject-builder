import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { createVisualHandler } from './server/handler.mjs';
import { pwaBuildPlugin } from './src/pwa/buildPlugin';

export default defineConfig(({ command, mode }) => {
  // Dev-only: OPENROUTER do .env pré-popula a chave no IndexedDB pra quem
  // roda `npm run dev`. No build vira string vazia — a chave nunca entra no
  // bundle de produção (o contrato BYOK continua valendo).
  const env = loadEnv(mode, process.cwd(), '');
  const devKey =
    command === 'serve' && mode !== 'test'
      ? (env.OPENROUTER ?? env.VITE_DEV_OPENROUTER_API_KEY ?? '')
      : '';

  return {
    plugins: [react(), pwaBuildPlugin(), {
      name: 'local-visual-gateway',
      configureServer(server) {
        server.middlewares.use(createVisualHandler({
          local: true,
          typesafeKey: env.TYPESAFE_API_KEY || env.TYPESAFE || '',
        }));
      },
    }],
    define: {
      __DEV_OPENROUTER_KEY__: JSON.stringify(devKey),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      port: 5173,
      // Saved design reference pages are not app inputs and can be locked by Windows.
      watch: { ignored: (filePath) => /\/docs\/design(?:\/|$)/.test(filePath.replaceAll('\\', '/')) },
    },
    build: {
      rollupOptions: {
        output: {
          // Split stable vendor families into their own cacheable, parallel
          // chunks instead of one ~1.5 MB monolith that any app edit busts.
          manualChunks: (id) => {
            if (!id.includes('node_modules')) return;
            if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'react';
            if (id.includes('@xyflow')) return 'xyflow';
            if (id.includes('pdfjs-dist')) return 'pdf';
            if (/[\\/]node_modules[\\/]three[\\/]/.test(id)) return 'three';
            if (/[\\/]node_modules[\\/](ai|@ai-sdk|@openrouter)[\\/]/.test(id)) return 'ai-sdk';
            if (/[\\/]node_modules[\\/]zod[\\/]/.test(id)) return 'zod';
          },
        },
      },
    },
  };
});
