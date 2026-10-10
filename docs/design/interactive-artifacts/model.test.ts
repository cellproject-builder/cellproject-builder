import { describe, expect, it } from 'vitest';
import { parseDiagram, evaluateDiagram, sampleContext, demoDiagram, isCurrentReview, generationDiagramSchema } from './model';
import { zodSchema } from '@ai-sdk/provider-utils';

describe('experimental diagram contract', () => {
  it('updates the diagram calculation without turning it into physical evidence', () => {
    const model = parseDiagram(demoDiagram, sampleContext.nodes.map(n => n.id));
    expect(evaluateDiagram(model, {}).torque).toBeCloseTo(.1962);
    expect(evaluateDiagram(model, { mass: .4, reach: .2 }).torque).toBeCloseTo(.7848);
    expect(sampleContext.observations[0].id).toBe('obs-jitter');
    expect(sampleContext.nodes.find(n => n.id === 'servo')?.status).toBe('unverified');
  });
  it('rejects unknown plan links and duplicated IDs', () => {
    expect(() => parseDiagram({ ...demoDiagram, elements: [{ ...demoDiagram.elements[0], nodeId: 'foreign-project' }] }, ['servo'])).toThrow();
    expect(() => parseDiagram({ ...demoDiagram, parameters: [...demoDiagram.parameters, demoDiagram.parameters[0]] }, ['servo', 'test'])).toThrow();
  });
  it('rejects executable SVG attributes and invalid arithmetic dependencies', () => {
    expect(() => parseDiagram({ ...demoDiagram, elements: [{ ...demoDiagram.elements[0], onClick: 'fetch(secret)' }] }, ['servo', 'test'])).toThrow();
    expect(() => parseDiagram({ ...demoDiagram, calculations: [{ id: 'torque', op: 'product', inputs: ['torque', 'mass'] }] }, ['servo', 'test'])).toThrow();
  });
  it('clamps controls, ignores unknown overrides and refuses nonfinite arithmetic', () => {
    expect(evaluateDiagram(demoDiagram, { mass: 99 }).mass).toBe(1);
    expect(evaluateDiagram(demoDiagram, { gravity: 2 }).gravity).toBe(9.81);
    expect(() => evaluateDiagram(demoDiagram, { mass: NaN })).toThrow();
    const zero = { ...demoDiagram, calculations: [{ id: 'bad', op: 'quotient' as const, inputs: ['mass', 'zero'] }], constants: { gravity: 9.81, zero: 0 } };
    expect(() => evaluateDiagram(zero, {})).toThrow();
  });
  it('invalidates advice on context change without rewriting the original plan', () => {
    const original = JSON.stringify(sampleContext);
    expect(isCurrentReview({ contextRevision: 'fixture-v1' }, sampleContext)).toBe(true);
    expect(isCurrentReview({ contextRevision: 'fixture-v0' }, sampleContext)).toBe(false);
    evaluateDiagram(demoDiagram, { mass: .8 });
    expect(JSON.stringify(sampleContext)).toBe(original);
  });
  it('uses homogeneous array items for provider transport while preserving strict local viewBox validation', () => {
    const schema = zodSchema(generationDiagramSchema).jsonSchema as any;
    expect(Array.isArray(schema.properties.viewBox.items)).toBe(false);
    expect(() => parseDiagram({ ...demoDiagram, viewBox: [10, 0, 460, 220] }, ['servo', 'test'])).toThrow();
  });
});
