import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
export default defineConfig(({ mode }) => {
  const base = path.resolve(__dirname, '../..');
  const source = path.join(base, '.codex-audit-interaction', mode === 'baseline' ? 'pdf-baseline' : 'pdf-candidate');
  return { root: __dirname, envDir: path.join(__dirname, 'no-env'), plugins:[react()], resolve:{alias:{'@':path.join(source,'src')}}, define:{__DEV_OPENROUTER_KEY__:'""'}, build:{outDir:path.join(base,'.codex-audit-interaction/pdf-dist',mode),emptyOutDir:true,sourcemap:true,target:'esnext'}, base:`/${mode}/` };
});
