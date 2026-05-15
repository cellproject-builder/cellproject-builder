export type NodeState =
  | 'concept'
  | 'validated'
  | 'executing'
  | 'done'
  | 'problem'
  | 'discarded';

export type NodeKind =
  | 'root'
  | 'categoria'
  | 'recurso'
  | 'passo'
  | 'decisao'
  | 'concept';

export type EdgeKind = 'direct' | 'middleware' | 'independent' | 'optional';

export type ConfidenceSource = 'data' | 'experience' | 'intuition' | 'ai';

export interface HistoryEntry {
  id: string;
  timestamp: number;
  kind:
    | 'created'
    | 'confidence'
    | 'state'
    | 'rename'
    | 'note'
    | 'child_added'
    | 'manual'
    | 'confirmed'
    | 'unconfirmed'
    | 'decision'
    | 'criterio_usuario'
    | 'critica'
    | 'ground_truth'
    | 'failure'
    | 'replan';
  message: string;
}

export interface DecisionOption {
  id: string;
  label: string;
  pitch: string;
  consequences?: string;
}

// ---------------------------------------------------------------------------
// Ground truth — mecanismos para romper o loop fechado IA→IA.
// ---------------------------------------------------------------------------

export type GroundTruthKind = 'link' | 'spec' | 'medida';

export interface GroundTruthRef {
  id: string;
  kind: GroundTruthKind;
  label: string;
  value: string; // URL, especificação textual, ou medida com unidade
  verificado: boolean;
  addedAt: number;
  verifiedAt?: number;
  addedByAI: boolean; // true quando veio como hint da IA, false quando usuário cadastrou
}

// Crítica adversarial — segunda passada cética, prompt distinto do planejador.
export interface AdversarialCritique {
  fraquezas: string[];
  premissasOcultas: string[];
  criterioAlternativo: string; // critério independente, escrito por cético
  generatedAt: number;
}

export interface ConceptNodeData {
  id: string;
  parentId: string | null;
  kind: NodeKind;
  name: string;

  // Conceitual (herdado — ainda útil pra contexto)
  fx: string;
  problem: string;
  confidence: number;
  confidenceSource?: ConfidenceSource;
  confidenceReason?: string;
  pros: string[];
  cons: string[];

  // Educacional (tutor)
  oQue: string; // o que é
  porQue: string; // por que precisa
  comoConfirmar: string; // instrução / critério (gerado pela IA)
  explicacao?: string; // explicação longa detalhada (gerada sob demanda)

  // Ground truth (attack a): critério escrito pelo usuário ANTES de ver o da IA.
  // Só é gravado uma vez; o timestamp trava a escrita para impedir que o usuário
  // copie o comoConfirmar da IA retroativamente.
  comoConfirmarUsuario?: string;
  comoConfirmarUsuarioAt?: number;

  // Ground truth (attack b): crítica adversarial — segunda passada cética.
  critica?: AdversarialCritique;

  // Ground truth (attack d): âncoras verificáveis no mundo real.
  groundTruthRefs?: GroundTruthRef[];

  // Ground truth (attack c): contexto de falha real. Preenchido quando o
  // usuário reporta que o nó quebrou na execução; dispara replan contextual.
  failureContext?: string;
  failureReportedAt?: number;

  // Execução
  confirmado: boolean;
  order: number; // ordem entre irmãos (importante para passos)

  // Decisão
  decisionOptions?: DecisionOption[];
  decisionPickedId?: string;

  // Estado
  state: NodeState;
  notes: string;
  history: HistoryEntry[];
  aiSuggested: boolean;
  position: { x: number; y: number };
}

export interface ConceptEdgeData {
  id: string;
  source: string;
  target: string;
  kind: EdgeKind;
  middlewareNodeId?: string;
  note?: string;
}

export interface Project {
  id: string;
  name: string;
  objective: string;
  createdAt: number;
  updatedAt: number;
  nodes: Record<string, ConceptNodeData>;
  edges: Record<string, ConceptEdgeData>;
  rootId: string;
}

// ---- AI contract ----------------------------------------------------------

export interface AISuggestedGroundTruthHint {
  kind: GroundTruthKind;
  label: string;
  value: string;
}

export interface AISuggestedNode {
  tempId: string;
  kind: NodeKind;
  name: string;
  fx: string;
  problem: string;
  confidence: number;
  confidenceReason: string;
  pros: string[];
  cons: string[];
  oQue: string;
  porQue: string;
  comoConfirmar: string;
  order?: number;
  decisionOptions?: DecisionOption[];
  // Âncoras propostas pela IA — ainda não verificadas.
  groundTruthHints?: AISuggestedGroundTruthHint[];
}

export interface AISuggestedEdge {
  sourceTempId: string;
  targetTempId: string;
  kind: EdgeKind;
  note?: string;
}

export interface AIPlan {
  id: string;
  title: string;
  pitch: string;
  approach: string;
  tree: AIPlanTree;
}

export interface AIPlanTree {
  categorias: AIPlanCategory[];
}

export interface AIPlanCategory {
  tempId: string;
  name: string; // "Recursos", "Execução", "Decisões"
  kind: 'recursos' | 'execucao' | 'decisoes';
  oQue: string;
  porQue: string;
  children: AISuggestedNode[];
}
