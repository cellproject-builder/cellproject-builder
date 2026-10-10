import * as THREE from 'three';
import type { SceneV1 } from '../types';

/** Shared native geometry factory for rendering and assembly-envelope validation. */
export function objectGeometry(object: SceneV1['objects'][number]): THREE.BufferGeometry {
  switch (object.type) {
    case 'box': return new THREE.BoxGeometry(1, 1, 1);
    case 'sphere': return new THREE.SphereGeometry(.5, 28, 18);
    case 'cylinder': return new THREE.CylinderGeometry(.5, .5, 1, 28);
    case 'cone': return new THREE.ConeGeometry(.5, 1, 28);
    case 'torus': return new THREE.TorusGeometry(.5, .16, 12, 32);
  }
  const definition = object.geometry;
  if (!definition) throw new Error('visualGeometryInvalid');
  let geometry: THREE.BufferGeometry;
  switch (definition.kind) {
    case 'extrude': {
      const shape = new THREE.Shape(definition.points.map(p => new THREE.Vector2(...p)));
      shape.holes = definition.holes.map(points => new THREE.Path(points.map(p => new THREE.Vector2(...p))));
      geometry = new THREE.ExtrudeGeometry(shape, { depth: definition.depth, steps: 1, curveSegments: 1,
        bevelEnabled: definition.bevel > 0, bevelThickness: definition.bevel, bevelSize: definition.bevel, bevelSegments: 3 });
      geometry.translate(0, 0, -definition.depth / 2);
      break;
    }
    case 'lathe': geometry = new THREE.LatheGeometry(definition.points.map(p => new THREE.Vector2(...p)), definition.segments); break;
    case 'tube': geometry = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(definition.points.map(p => new THREE.Vector3(...p)), definition.closed, 'centripetal'), definition.segments, definition.radius, definition.radialSegments, definition.closed); break;
    case 'buffer':
      geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(definition.vertices.flat(), 3));
      geometry.setIndex(definition.indices);
      geometry.computeVertexNormals();
  }
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return geometry;
}
