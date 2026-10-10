import type { SceneV1 } from './types';

/** Retrieved document text, not a model's recollection or a search result snippet. */
export interface DecompositionSource {
  id: string; url: string; title: string; text: string; retrievedAt: number;
}
export interface DecompositionPart {
  id: string; name: string; partNumber: string | null; quantity: number | null;
  role: string; specifications: string[];
  evidence: Array<{ sourceId: string; quote: string }>;
  unknowns: string[];
}
export interface DecompositionAssembly {
  scene: SceneV1;
  groups: Array<{ partId: string; objectIds: string[]; explodeOffset: [number, number, number] }>;
  createdAt: number; dossierId: string; dossierFingerprint?: string; selectedPartIds: string[];
  /** Geometry reuse provenance, independent of documentary evidence about real parts. */
  geometryBasis?: 'source' | 'generated' | 'mixed';
  reusedObjectIds?: string[];
}
export interface ObjectDecomposition {
  version: 1; id: string; artifactFingerprint: string; identity: string;
  sourceImageIds: string[]; sources: DecompositionSource[]; parts: DecompositionPart[];
  unknowns: string[]; researchedAt: number; assembly?: DecompositionAssembly;
  /** Durable companion id; a removed companion must not be recreated on recovery. */
  assemblyArtifactId?: string;
}
export interface VisualModelOrigin {
  proposalId: string; imageIds: string[]; imageMediaIds: string[]; instruction: string;
}
