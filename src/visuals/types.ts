export interface MentionTarget { id: string; kind: 'note' | 'node' | 'image'; label: string; detail: string; fingerprint: string }
export interface VisualAttachment { id: string; name: string; mime: string; byteLength: number; mediaId: string | null; text: string | null }
export interface VisualPromptInput { text: string; mentions: MentionTarget[]; attachments: VisualAttachment[]; analyzeImages?: boolean; generationMode?: 'standard' | 'advanced'; artifactKind?: 'model' | 'diagram' }
export interface TextualVisualAssessment {
  kind: 'textual'; model: string; rubricVersion: string; score: number; confidence: number;
  probabilities: Record<'0' | '1' | '2' | '3', number>;
  legend: Record<'0' | '1' | '2' | '3', string>; assessedAt: number;
}
export type VisualAssessment = { score: number; confidence: number } | TextualVisualAssessment;
export type VisualSearchReview = { status: 'ranked' | 'unavailable' | 'not-configured'; assessed: number; removed: number };
export interface ImageReference {
  id: string; title: string; description: string; imageUrl: string; sourcePageUrl: string;
  credit: string | null; license: string | null; width: number | null; height: number | null;
  assessment?: VisualAssessment | null; sessionId?: string;
}
export type CustomVisualGeometry =
  | { kind: 'extrude'; points: [number, number][]; holes: [number, number][][]; depth: number; bevel: number }
  | { kind: 'lathe'; points: [number, number][]; segments: number }
  | { kind: 'tube'; points: [number, number, number][]; radius: number; segments: number; radialSegments: number; closed: boolean }
  | { kind: 'buffer'; vertices: [number, number, number][]; indices: number[] };
export interface SceneV1 {
  version: 1; label: string;
  objects: Array<{ id: string; type: 'box' | 'sphere' | 'cylinder' | 'cone' | 'torus' | 'custom'; position: [number, number, number]; rotation: [number, number, number]; scale: [number, number, number]; color: string; geometry?: CustomVisualGeometry | null }>;
}
export interface VisualArtifact {
  id: string; label: string; kind: 'image' | 'model' | 'diagram'; x: number; y: number; width: number; height: number;
  diagram?: import('./diagram/model').DiagramV1;
  diagramValues?: Record<string, number>;
  /** Optional semantic association; canvas coordinates are always independent. */
  linkedNodeId?: string | null;
  /** Derived view of another canvas artifact; never a physical/electrical connection. */
  sourceArtifactId?: string;
  mediaId: string | null; scene: SceneV1 | null; source: ImageReference | null;
  revisions: Array<{ scene: SceneV1 | null; mediaId: string | null; createdAt: number; label?: string; assembly?: VisualModelAssembly | null; decomposition?: ObjectDecomposition | null; input?: VisualPromptInput; contextFingerprint?: string; referencedMediaIds?: string[]; diagram?: import('./diagram/model').DiagramV1 | null; diagramValues?: Record<string, number> }>;
  revisionIndex: number;
  origin?: VisualModelOrigin;
  decomposition?: ObjectDecomposition;
  /** Modular construction contract, not a verified documentary decomposition. */
  assembly?: VisualModelAssembly;
}
interface VisualProposalBase {
  id: string; projectId: string; label: string; input: VisualPromptInput;
  contextFingerprint: string; createdAt: number; status: 'ready' | 'applied' | 'stale' | 'rejected';
  contextSnapshot?: string;
  referencedMediaIds?: string[];
  assembly?: VisualModelAssembly;
}
export interface VisualModelProposal extends VisualProposalBase { kind?: 'model'; scene: SceneV1; diagram?: never }
export interface VisualDiagramProposal extends VisualProposalBase { kind: 'diagram'; scene: null; diagram: import('./diagram/model').DiagramV1; assembly?: never }
export type VisualProposal = VisualModelProposal | VisualDiagramProposal;
export interface VisualAssemblyPlan {
  units: 'illustrative' | 'mm'; sharedConstraints: string[]; unknowns: string[];
  modules: Array<{ id: string; name: string; prompt: string; nodeIds: string[]; sourceIds: string[];
    center: [number, number, number]; size: [number, number, number]; primitiveBudget: number }>;
  interfaces: Array<{ id: string; moduleIds: [string, string]; anchor: [number, number, number]; description: string }>;
}
export interface VisualModelAssembly {
  version: 1; sceneFingerprint: string; summary: string; plan: VisualAssemblyPlan;
  groups: Array<{ partId: string; name: string; objectIds: string[] }>;
  selectedNodeIds: string[]; selectedImageIds: string[]; sources: DecompositionSource[]; unknowns: string[];
}
export interface VisualWorkspace {
  attachments?: import('@/attachments/canvasModel').CanvasAttachments;
  ink?: import('@/ink/canvasModel').CanvasInkDocument;
  version: 1; mode: 'approval' | 'automatic'; artifacts: VisualArtifact[]; proposals: VisualProposal[];
  drafts: { search: VisualPromptInput; model: VisualPromptInput };
}
import type { ObjectDecomposition, VisualModelOrigin, DecompositionSource } from './decompositionTypes';
export type { DecompositionSource, DecompositionPart, DecompositionAssembly, ObjectDecomposition, VisualModelOrigin } from './decompositionTypes';
