import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
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
          if (/[\\/]node_modules[\\/](ai|@ai-sdk|@openrouter)[\\/]/.test(id)) return 'ai-sdk';
          if (/[\\/]node_modules[\\/]zod[\\/]/.test(id)) return 'zod';
        },
      },
    },
  },
});
