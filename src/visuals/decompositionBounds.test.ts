import { describe, expect, it } from 'vitest';
import { Box3, Vector3 } from 'three';
import { decompositionObjectBounds } from './decompositionLayout';
import type { SceneV1 } from './types';

type Object = SceneV1['objects'][number];
const object = (type: Object['type'], patch: Partial<Object> = {}): Object => ({
  id: 'part', type, position: [0, 0, 0], rotation: [0, 0, 0], scale: [2, 2, 2], color: '#999999', ...patch,
});
// The same 3% tolerance used to validate a 2 × 2 × 2 assembly module.
const envelope = () => new Box3(new Vector3(-1.06, -1.06, -1.06), new Vector3(1.06, 1.06, 1.06));

describe('assembly object bounds', () => {
  it('accepts a rotated spherical joint that still fits its original module', () => {
    const bounds = decompositionObjectBounds(object('sphere', { rotation: [0, 0, Math.PI / 4] }));
    expect(envelope().containsBox(bounds)).toBe(true);
    expect(bounds.getSize(new Vector3()).x).toBeLessThanOrEqual(2.000001);
  });

  it('accepts a cylinder rotated around its shaft without enlarging its diameter', () => {
    const bounds = decompositionObjectBounds(object('cylinder', { rotation: [0, Math.PI / 4, 0] }));
    expect(envelope().containsBox(bounds)).toBe(true);
    expect(bounds.getSize(new Vector3()).z).toBeLessThanOrEqual(2.000001);
  });

  it('bounds a tilted cone by its apex and base rather than the corners of an enclosing cube', () => {
    const bounds = decompositionObjectBounds(object('cone', { scale: [1, 1, 1], rotation: [0, 0, Math.PI / 4] }));
    expect(bounds.min.x).toBeCloseTo(-Math.SQRT1_2 / 2, 6);
    expect(bounds.max.x).toBeCloseTo(Math.SQRT1_2, 6);
    expect(bounds.min.y).toBeCloseTo(-Math.SQRT1_2, 6);
    expect(bounds.max.y).toBeCloseTo(Math.SQRT1_2 / 2, 6);
  });

  it('keeps an in-plane rotated ring inside its diameter and tube depth', () => {
    const bounds = decompositionObjectBounds(object('torus', { scale: [1, 1, 1], rotation: [0, 0, Math.PI / 4] }));
    const ringEnvelope = new Box3(new Vector3(-.7, -.7, -.2), new Vector3(.7, .7, .2));
    expect(ringEnvelope.containsBox(bounds)).toBe(true);
    expect(bounds.getSize(new Vector3()).z).toBeCloseTo(.32, 6);
  });

  it('still rejects a genuine protrusion beyond the module tolerance', () => {
    const bounds = decompositionObjectBounds(object('sphere', { position: [.2, 0, 0], rotation: [0, 0, Math.PI / 4] }));
    expect(envelope().containsBox(bounds)).toBe(false);
    expect(bounds.max.x).toBeGreaterThan(1.19);
  });

  it('uses fresh world transforms for repeated instances of the same primitive', () => {
    const first = decompositionObjectBounds(object('cylinder', { position: [10, -4, 3], scale: [2, 4, 6] }));
    const second = decompositionObjectBounds(object('cylinder', { position: [-2, 1, 5], scale: [4, 2, 2] }));
    expect(first.min.toArray()).toEqual([9, -6, 0]);
    expect(first.max.toArray()).toEqual([11, -2, 6]);
    expect(second.min.toArray()).toEqual([-4, 0, 4]);
    expect(second.max.toArray()).toEqual([0, 2, 6]);
  });

  it('preserves cached custom geometry bounds across independent transforms', () => {
    const geometry: NonNullable<Object['geometry']> = { kind: 'extrude', points: [[-1, -1], [1, -1], [1, 1], [-1, 1]], holes: [], depth: 2, bevel: 0 };
    const first = decompositionObjectBounds(object('custom', { geometry, scale: [1, 1, 1], position: [3, 4, 5] }));
    const second = decompositionObjectBounds(object('custom', { geometry, scale: [2, 3, 4] }));
    expect(first.min.toArray()).toEqual([2, 3, 4]);
    expect(first.max.toArray()).toEqual([4, 5, 6]);
    expect(second.min.toArray()).toEqual([-2, -3, -4]);
    expect(second.max.toArray()).toEqual([2, 3, 4]);
  });
  it('accepts a custom revolved shaft rotated around its axis without enlarging its envelope', () => {
    const geometry: NonNullable<Object['geometry']> = { kind: 'lathe', points: [[1, -1], [1, 1]], segments: 32 };
    const bounds = decompositionObjectBounds(object('custom', { geometry, scale: [1, 1, 1], rotation: [0, Math.PI / 4, 0] }));
    expect(envelope().containsBox(bounds)).toBe(true);
  });
  it('does not add nonexistent rotated corners to a custom triangular mesh', () => {
    const geometry: NonNullable<Object['geometry']> = { kind: 'buffer', vertices: [[-1, -1, 0], [1, -1, 0], [0, 1, 0]], indices: [0, 1, 2] };
    const bounds = decompositionObjectBounds(object('custom', { geometry, scale: [1, 1, 1], rotation: [0, 0, Math.PI / 4] }));
    expect(bounds.min.x).toBeCloseTo(-Math.SQRT1_2, 6);
    expect(bounds.max.y).toBeCloseTo(Math.SQRT1_2, 6);
  });
});
