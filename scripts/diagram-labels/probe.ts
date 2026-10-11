import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { parseGeneratedDiagram } from '../../src/visuals/diagram/quality';
import { assessCoverage } from './coverage';
export { assessCoverage } from './coverage';

export function summarizeResponse(rawText: string, finishReason: string) {
  let diagram: unknown = null;
  let parser: { status: 'valid' | 'invalid'; error?: string; code?: string };
  try { diagram = JSON.parse(rawText.trim()); }
  catch { return { status: 'invalid' as const, diagram, parser: { status: 'invalid' as const, error: 'SyntaxError', code: 'invalidJson' }, coverage: assessCoverage(diagram) }; }
  try { parseGeneratedDiagram(diagram, []); parser = { status: 'valid' }; }
  catch (error) { parser = { status: 'invalid', error: error instanceof Error ? error.name : 'UnknownError', code: error instanceof Error && error.message === 'diagramLabelsMissing' ? error.message : 'diagramInvalid' }; }
  const coverage = assessCoverage(diagram);
  return { status: finishReason === 'length' ? 'incomplete' as const : parser.status === 'invalid' ? 'invalid' as const : !coverage.complete ? 'coverage-missing' as const : 'valid' as const, diagram, parser, coverage };
}

/** mkdir is the exclusive lock: any previous attempt, including interrupted, blocks another call. */
export async function preserveFirstAttempt(destination: string, manifest: unknown) {
  await mkdir(dirname(destination), { recursive: true });
  try { await mkdir(destination); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('preserveFirstSample'); throw error; }
  await writeFile(join(destination, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
}
