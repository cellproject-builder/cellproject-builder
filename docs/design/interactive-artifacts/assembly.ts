import { Euler, Quaternion, Vector3 } from 'three';
import type { SceneV1 } from '../../../src/visuals/types';

export interface SavedPart {
  id: string; name: string; source: string; scene: SceneV1;
  position: [number, number, number]; rotation: [number, number, number];
  explodeOffset: [number, number, number];
}
export interface PartConnection { from: string; to: string; description: string }

/** Laboratory composition of saved scenes. Rigid placements only; sources remain immutable. */
export function assembleSavedParts(parts: SavedPart[], connections: PartConnection[]) {
  const ids = new Set(parts.map(part => part.id));
  if (!parts.length || ids.size !== parts.length || parts.some(part => !part.id || !part.scene.objects.length)) throw new Error('Invalid parts');
  if (connections.some(link => !ids.has(link.from) || !ids.has(link.to) || link.from === link.to)) throw new Error('Invalid connection');
  const objects: SceneV1['objects'] = [];
  const groups = parts.map(part => {
    const numbers = [...part.position, ...part.rotation, ...part.explodeOffset];
    if (numbers.length !== 9 || numbers.some(value => !Number.isFinite(value))) throw new Error('Invalid transform');
    const rotation = new Quaternion().setFromEuler(new Euler(...part.rotation));
    const names = new Set<string>();
    const objectIds = part.scene.objects.map(source => {
      if (names.has(source.id)) throw new Error('Duplicate source object');
      names.add(source.id);
      const object = structuredClone(source), id = `${part.id}:${source.id}`;
      object.id = id;
      object.position = new Vector3(...source.position).applyQuaternion(rotation).add(new Vector3(...part.position)).toArray();
      object.rotation = new Euler().setFromQuaternion(rotation.clone().multiply(new Quaternion().setFromEuler(new Euler(...source.rotation)))).toArray().slice(0, 3) as [number, number, number];
      objects.push(object);
      return id;
    });
    return { partId: part.id, objectIds, explodeOffset: [...part.explodeOffset] as [number, number, number] };
  });
  return { scene: { version: 1, label: 'Montagem de cenas salvas', objects } as SceneV1, groups,
    connections: structuredClone(connections), sources: parts.map(({id,name,source}) => ({id,name,source})) };
}
