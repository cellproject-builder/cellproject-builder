import { expect, it } from 'vitest';
import { buildDiagramSystem, diagramColorGuide, diagramLabelGuide } from './prompt';

it.each([
  ['plan', 'exact opaque ID found in the supplied planNodes/selected node context', 'not physical evidence'],
  ['board', 'independent of plans, projects and notes', 'nodeId must be absent or null'],
  ['note', 'Only that note has been authorized as context', 'nodeId must be null or absent'],
] as const)('builds the %s request with shared annotation rules, its own scope and the current schema', (surface, scope, nodeRule) => {
  const system = buildDiagramSystem(surface);
  expect(system).toContain(diagramLabelGuide);
  expect(system).toContain(diagramColorGuide);
  expect(system).toContain(scope);
  expect(system).toContain(nodeRule);
  expect(system).toContain('untrusted');
  const schema = JSON.parse(system.slice(system.lastIndexOf('\n') + 1));
  expect(schema.properties.elements.maxItems).toBe(100);
  expect(schema.properties.elements.items.properties.type.enum).toContain('text');
});

it('requires explanatory text before decorative detail without filling gaps in the sources', () => {
  const guide = diagramLabelGuide;
  expect(guide).toContain('each principal component');
  expect(guide).toContain('type="text"');
  expect(guide).toContain('100 elements');
  expect(guide).toContain('before geometric detail');
  expect(guide).toContain('Paint text elements last');
  expect(guide).toContain('not supplied');
  expect(guide).toContain('Never invent pin assignments');
});
