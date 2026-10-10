import { z } from 'zod';
import type { CustomVisualGeometry, SceneV1 } from './types';

const coordinate = z.number().finite().min(-10_000).max(10_000);
const point2 = z.tuple([coordinate, coordinate]);
const point3 = z.tuple([coordinate, coordinate, coordinate]);
const length = z.number().finite().positive().max(10_000);
type Point = [number, number];
const cross = (a: Point, b: Point, c: Point) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
const epsilon = 1e-9;
function onSegment(a: Point, b: Point, p: Point) {
  return Math.abs(cross(a, b, p)) < epsilon && p[0] >= Math.min(a[0], b[0]) - epsilon && p[0] <= Math.max(a[0], b[0]) + epsilon
    && p[1] >= Math.min(a[1], b[1]) - epsilon && p[1] <= Math.max(a[1], b[1]) + epsilon;
}
function intersect(a: Point, b: Point, c: Point, d: Point) {
  return cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0
    || onSegment(a, b, c) || onSegment(a, b, d) || onSegment(c, d, a) || onSegment(c, d, b);
}
function edges(points: Point[]) { return points.map((p, i) => [p, points[(i + 1) % points.length]] as const); }
function simplePolygon(points: Point[]) {
  if (new Set(points.map(p => p.join(','))).size !== points.length) return false;
  if (Math.abs(edges(points).reduce((sum, [a, b]) => sum + a[0] * b[1] - b[0] * a[1], 0)) < epsilon) return false;
  const segments = edges(points);
  return !segments.some(([a, b], i) => segments.some(([c, d], j) => j > i + 1 && !(i === 0 && j === segments.length - 1) && intersect(a, b, c, d)));
}
function inside(point: Point, polygon: Point[]) {
  if (edges(polygon).some(([a, b]) => onSegment(a, b, point))) return false;
  let result = false;
  for (const [a, b] of edges(polygon)) if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) result = !result;
  return result;
}
const polygonsIntersect = (a: Point[], b: Point[]) => edges(a).some(([p, q]) => edges(b).some(([r, s]) => intersect(p, q, r, s)));

/** Validate before allocating GPU buffers. All geometry is data, never executable code. */
export const customGeometrySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('extrude'), points: z.array(point2).min(3).max(128), holes: z.array(z.array(point2).min(3).max(128)).max(16), depth: length, bevel: z.number().finite().nonnegative().max(1000) }).strict(),
  z.object({ kind: z.literal('lathe'), points: z.array(point2).min(2).max(128), segments: z.number().int().min(3).max(128) }).strict(),
  z.object({ kind: z.literal('tube'), points: z.array(point3).min(2).max(128), radius: length, segments: z.number().int().min(2).max(256), radialSegments: z.number().int().min(3).max(32), closed: z.boolean() }).strict(),
  z.object({ kind: z.literal('buffer'), vertices: z.array(point3).min(3).max(4096), indices: z.array(z.number().int().nonnegative().max(4095)).min(3).max(24576) }).strict(),
]).superRefine((geometry, ctx) => {
  const invalid = () => ctx.addIssue({ code: 'custom', message: 'visualGeometryInvalid' });
  if (geometry.kind === 'extrude') {
    const polygons = [geometry.points, ...geometry.holes];
    if (polygons.reduce((sum, points) => sum + points.length, 0) > 512 || geometry.bevel > geometry.depth / 2 || polygons.some(p => !simplePolygon(p))) return invalid();
    if (geometry.holes.some(hole => !inside(hole[0], geometry.points) || polygonsIntersect(hole, geometry.points))) return invalid();
    if (geometry.holes.some((hole, i) => geometry.holes.some((other, j) => j > i && (polygonsIntersect(hole, other) || inside(hole[0], other) || inside(other[0], hole))))) invalid();
  } else if (geometry.kind === 'lathe') {
    if (geometry.points.some(p => p[0] < 0) || !geometry.points.some(p => p[0] > 0) || geometry.points.some((p, i) => i > 0 && p.every((v, axis) => v === geometry.points[i - 1][axis]))) invalid();
  } else if (geometry.kind === 'tube') {
    if (geometry.closed && geometry.points.length < 3 || geometry.points.some((p, i) => i > 0 && p.every((v, axis) => v === geometry.points[i - 1][axis]))
      || geometry.closed && geometry.points[0].every((v, axis) => v === geometry.points.at(-1)![axis])) invalid();
  } else {
    if (geometry.indices.length % 3 || geometry.indices.some(index => index >= geometry.vertices.length)) return invalid();
    for (let i = 0; i < geometry.indices.length; i += 3) {
      const [a, b, c] = geometry.indices.slice(i, i + 3).map(index => geometry.vertices[index]);
      const u = b.map((v, axis) => v - a[axis]), v = c.map((value, axis) => value - a[axis]);
      const normal = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      if (normal.every(value => Math.abs(value) < 1e-12)) return invalid();
    }
  }
});

// A provider-friendly subset. Topology and resource bounds are enforced locally above.
const providerPoints = z.array(z.array(z.number()));
// z.discriminatedUnion emits oneOf in Zod 4. Azure's structured output accepts
// anyOf here, so keep the discriminator only in the stricter local validator.
export const generationGeometrySchema = z.union([
  z.object({ kind: z.literal('extrude'), points: providerPoints, holes: z.array(providerPoints), depth: z.number(), bevel: z.number() }).strict(),
  z.object({ kind: z.literal('lathe'), points: providerPoints, segments: z.number() }).strict(),
  z.object({ kind: z.literal('tube'), points: providerPoints, radius: z.number(), segments: z.number(), radialSegments: z.number(), closed: z.boolean() }).strict(),
  z.object({ kind: z.literal('buffer'), vertices: providerPoints, indices: z.array(z.number()) }).strict(),
]);

/** Upper bounds include extrusion bevel surfaces and the renderer's primitive tessellation. */
export function geometryTriangleBudget(geometry?: CustomVisualGeometry | null) {
  if (!geometry) return 1008;
  switch (geometry.kind) {
    case 'extrude': return (geometry.points.length + geometry.holes.reduce((sum, hole) => sum + hole.length, 0) + geometry.holes.length * 2) * (geometry.bevel ? 18 : 6);
    case 'lathe': return (geometry.points.length - 1) * geometry.segments * 2;
    case 'tube': return geometry.segments * geometry.radialSegments * 2;
    case 'buffer': return geometry.indices.length / 3;
  }
}
export const withinGeometryBudget = (objects: SceneV1['objects']) => objects.reduce((sum, object) => sum + geometryTriangleBudget(object.geometry), 0) <= 600_000;
