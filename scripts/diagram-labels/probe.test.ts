import { mkdtemp, readFile, rmdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { parseGeneratedDiagram } from '../../src/visuals/diagram/quality';
import { diagramLabelsFixture } from './fixture';
import { assessCoverage, preserveFirstAttempt, summarizeResponse } from './probe';

const temporary: string[] = [];
afterEach(async () => {
  for (const parent of temporary.splice(0)) {
    const destination = join(parent, 'attempt');
    for (const name of ['manifest.json', 'response.txt', 'diagram.json']) {
      await unlink(join(destination, name)).catch(() => {});
    }
    await rmdir(destination).catch(() => {});
    await rmdir(parent);
  }
});

it('provides fourteen distinct named servos and all requested explanatory parts in the manual fixture', () => {
  const fixture = diagramLabelsFixture(), source = JSON.stringify(fixture);
  expect(parseGeneratedDiagram(fixture, [])).toEqual(fixture);
  expect(assessCoverage(fixture)).toMatchObject({ complete: true, esp32: true, pca9685: true, source: true, capacitor: true, legend: true, distinctServoLabels: 14, missingServoLabels: [] });
  expect(fixture.elements.length).toBeLessThanOrEqual(100);
  expect(fixture.elements.some(element => element.nodeId)).toBe(false);
  expect(fixture.elements.some(element => element.type === 'rect' && element.x === 0 && element.y === 0 && element.width === 560 && element.height === 500 && element.fill !== 'none')).toBe(false);
  expect(JSON.stringify(fixture)).toBe(source);
});

it('does not count repeated labels, internal IDs or explanation as missing visible servo names', () => {
  const fixture = diagramLabelsFixture();
  fixture.elements = fixture.elements.filter(element => element.type !== 'text' || !element.text?.includes('B-Garra'));
  fixture.elements.push({ id: 'servo-b-garra-hidden-id', type: 'text', x: 10, y: 20, text: 'Servo A-J1' });
  fixture.explanation += ' Servo B-Garra';
  expect(assessCoverage(fixture)).toMatchObject({ complete: false, distinctServoLabels: 13, missingServoLabels: ['B-Garra'] });
});

it('preserves raw JSON while recording a failed generation quality gate, with no repair', () => {
  const fixture = diagramLabelsFixture();
  fixture.elements = fixture.elements.filter(element => element.type !== 'text');
  const rawText = ' \n' + JSON.stringify(fixture) + '\n ';
  const source = JSON.stringify(fixture), result = summarizeResponse(rawText, 'stop');
  expect(result.diagram).toEqual(fixture);
  expect(result.parser).toEqual({ status: 'invalid', error: 'DiagramLabelsMissingError', code: 'diagramLabelsMissing' });
  expect(result.status).toBe('invalid');
  expect(result.coverage.complete).toBe(false);
  expect(JSON.stringify(fixture)).toBe(source);
});

it('records truncated and malformed first responses as failures', () => {
  expect(summarizeResponse(JSON.stringify(diagramLabelsFixture()), 'length').status).toBe('incomplete');
  expect(summarizeResponse('{not-json', 'stop')).toMatchObject({ status: 'invalid', diagram: null, parser: { status: 'invalid', error: 'SyntaxError', code: 'invalidJson' } });
});

it('atomically reserves the first attempt and refuses to replace its saved response', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'diagram-labels-')); temporary.push(parent);
  const destination = join(parent, 'attempt');
  await preserveFirstAttempt(destination, { status: 'started', promptHash: 'synthetic' });
  await writeFile(join(destination, 'response.txt'), 'first response', { flag: 'wx' });
  await expect(preserveFirstAttempt(destination, { status: 'started', promptHash: 'second' })).rejects.toThrow('preserveFirstSample');
  expect(await readFile(join(destination, 'response.txt'), 'utf8')).toBe('first response');
  expect(JSON.parse(await readFile(join(destination, 'manifest.json'), 'utf8')).promptHash).toBe('synthetic');
});
