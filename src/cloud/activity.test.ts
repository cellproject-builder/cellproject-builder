import { expect, it } from 'vitest';
import { assertDataTransitionIdle, hasActiveDataIngestions, registerDataIngestion } from './activity';
import { extractPlanFile } from '@/attachments/files';

it('guards data transitions during chat, planner work and ingestion, and releases each operation only once', () => {
  expect(() => assertDataTransitionIdle(true, false)).toThrow('chat');
  expect(() => assertDataTransitionIdle(false, true)).toThrow('chat');
  const finish = registerDataIngestion(); expect(() => assertDataTransitionIdle(false, false)).toThrow('anexos');
  finish(); finish(); expect(hasActiveDataIngestions()).toBe(false); expect(() => assertDataTransitionIdle(false, false)).not.toThrow();
});
it('tracks file extraction before the first await and releases after success and validation failure', async () => {
  let finish!: (bytes: ArrayBuffer) => void;
  const file = new File(['source'], 'source.ts', { type: 'text/plain' });
  Object.defineProperty(file, 'arrayBuffer', { value: () => new Promise<ArrayBuffer>(resolve => { finish = resolve; }) });
  const running = extractPlanFile(file);
  expect(hasActiveDataIngestions()).toBe(true); expect(() => assertDataTransitionIdle(false, false)).toThrow('anexos');
  finish(new TextEncoder().encode('source').buffer); await running; expect(hasActiveDataIngestions()).toBe(false);
  await expect(extractPlanFile(new File(['x'], 'binary.exe'))).rejects.toThrow('attachmentUnsupported'); expect(hasActiveDataIngestions()).toBe(false);
});
