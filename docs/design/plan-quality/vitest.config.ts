import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('../../../src', import.meta.url)) } },
  test: { environment: 'node', include: ['docs/design/plan-quality/*.test.ts'], testTimeout: 30_000 },
});
