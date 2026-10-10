import { describe, expect, it } from 'vitest';
import { sceneSchema } from './normalize';
import { VisualAssemblyError } from './advancedErrors';

const object = () => ({ id: 'private-object-id', type: 'box', position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], color: '#112233', geometry: null });
const invalid = (scene: unknown) => {
  const result = sceneSchema.safeParse(scene);
  if (result.success) throw new Error('Fixture must fail local validation');
  return new VisualAssemblyError('module', 'scene', 'Public fixture', { scene, issues: result.error.issues });
};

describe('safe advanced scene validation details', () => {
  it('identifies a nonpositive scale without retaining the object or its values', () => {
    const scene = { version: 1, label: 'PRIVATE LABEL', objects: [{ ...object(), scale: [1, 0, 1] }] };
    const failure = invalid(scene);
    expect(failure.sceneDiagnostics).toEqual({ objectCount: 1, inspectedObjectCount: 1, customObjectCount: 0, issueCount: 1, omittedIssueCount: 0,
      issues: [{ path: ['objects', 0, 'scale', 1], code: 'too_small', reason: 'minimum' }] });
    expect(JSON.stringify(failure)).not.toContain('PRIVATE LABEL');
    expect(JSON.stringify(failure)).not.toContain('private-object-id');
    expect(failure).not.toHaveProperty('cause');
  });

  it('reports invalid topology and duplicate IDs through fixed known reasons', () => {
    const custom = { ...object(), type: 'custom', geometry: { kind: 'extrude', points: [[0, 0], [1, 0], [2, 0]], holes: [], depth: 1, bevel: 0 } };
    const geometryFailure = invalid({ version: 1, label: 'Shape', objects: [custom] });
    expect(geometryFailure.sceneDiagnostics).toMatchObject({ objectCount: 1, customObjectCount: 1,
      issues: [{ path: ['objects', 0, 'geometry'], code: 'custom', reason: 'invalid-geometry' }] });
    const repeated = invalid({ version: 1, label: 'Shape', objects: [object(), object()] });
    expect(repeated.sceneDiagnostics?.issues).toEqual([{ path: ['objects'], code: 'custom', reason: 'duplicate-id' }]);
  });

  it('identifies the actual mesh budget failure without retaining mesh points', () => {
    const tube = { kind: 'tube', points: [[0, 0, 0], [1, 1, 1]], radius: 0.1, segments: 256, radialSegments: 32, closed: false };
    const objects = Array.from({ length: 37 }, (_, index) => ({ ...object(), id: `private-tube-${index}`, type: 'custom', geometry: tube }));
    const failure = invalid({ version: 1, label: 'Private scene', objects });
    expect(failure.sceneDiagnostics).toMatchObject({ objectCount: 37, customObjectCount: 37,
      issues: [{ path: ['objects'], code: 'custom', reason: 'triangle-budget' }] });
    expect(JSON.stringify(failure)).not.toContain('private-tube');
    expect(JSON.stringify(failure)).not.toContain('points');
  });

  it('does not copy arbitrary issue paths, messages, codes or extra provider fields', () => {
    const secret = 'PRIVATE-PROVIDER-BODY';
    const failure = new VisualAssemblyError('module', 'scene', 'Public fixture', {
      scene: { label: secret, objects: [object()], prompt: secret },
      issues: [{ path: ['objects', 0, secret, Symbol(secret), -1, Infinity, 'geometry'], code: secret, message: secret, input: secret }],
      body: secret,
    } as never);
    expect(failure.sceneDiagnostics).toEqual({ objectCount: 1, inspectedObjectCount: 1, customObjectCount: 0, issueCount: 1, omittedIssueCount: 0,
      issues: [{ path: ['objects', 0, '?', '?', '?', '?', 'geometry'], code: 'validation', reason: 'validation' }] });
    expect(JSON.stringify(failure)).not.toContain(secret);
  });

  it('caps issue lists, paths and object inspection while retaining total counts', () => {
    const scene = { objects: Array.from({ length: 600 }, () => ({ type: 'custom' })) };
    const issues = Array.from({ length: 20 }, () => ({ path: Array.from({ length: 30 }, () => 'objects'), code: 'custom', message: 'PRIVATE' }));
    const failure = new VisualAssemblyError('module', 'scene', 'Public fixture', { scene, issues });
    expect(failure.sceneDiagnostics).toMatchObject({ objectCount: 600, inspectedObjectCount: 512, customObjectCount: 512, issueCount: 20, omittedIssueCount: 8 });
    expect(failure.sceneDiagnostics?.issues).toHaveLength(12);
    expect(failure.sceneDiagnostics?.issues[0].path).toHaveLength(8);
    expect(Object.isFrozen(failure.sceneDiagnostics)).toBe(true);
    expect(Object.isFrozen(failure.sceneDiagnostics?.issues[0].path)).toBe(true);
  });

  it('keeps existing non-scene failures free of diagnostics', () => {
    expect(new VisualAssemblyError('plan', 'references').sceneDiagnostics).toBeUndefined();
  });
});
