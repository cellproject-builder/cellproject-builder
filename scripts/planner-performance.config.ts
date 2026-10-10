import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from '../vite.config';

export default defineConfig(env => mergeConfig(viteConfig(env), defineConfig({
  test: {
    environment: 'jsdom', setupFiles: ['./src/test/setup.ts'],
    include: ['scripts/planner-performance.bench.ts'], testTimeout: 60_000,
    maxWorkers: 1,
  },
})));
