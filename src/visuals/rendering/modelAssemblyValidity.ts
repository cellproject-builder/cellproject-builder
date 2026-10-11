import { modelAssemblyCurrent } from '../modelAssembly';
import type { SceneV1, VisualArtifact, VisualModelAssembly } from '../types';

const validity = new WeakMap<SceneV1, WeakMap<VisualModelAssembly, boolean>>();

/** Rendering uses immutable scenes/contracts; actions keep the uncached domain validation. */
export function modelAssemblyCurrentForRender(artifact: Pick<VisualArtifact, 'kind' | 'scene' | 'assembly'>): boolean {
  if (artifact.kind !== 'model' || !artifact.scene || !artifact.assembly) return false;
  let contracts = validity.get(artifact.scene);
  if (!contracts) { contracts = new WeakMap(); validity.set(artifact.scene, contracts); }
  const cached = contracts.get(artifact.assembly);
  if (cached !== undefined) return cached;
  const current = modelAssemblyCurrent(artifact);
  contracts.set(artifact.assembly, current);
  return current;
}
