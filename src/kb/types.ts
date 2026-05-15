// ---------------------------------------------------------------------------
// Repositório de conhecimento — KB pessoal do usuário
// ---------------------------------------------------------------------------
// Cada PDF vira um KBDocument com:
//  - extractedText: texto integral extraído localmente via pdf.js
//  - summary: objeto estruturado gerado por IA, usado como contexto em
//    prompts sem precisar re-enviar o PDF inteiro a cada chamada.
//
// O PDF binário NÃO é armazenado. O usuário fica com o arquivo dele no disco
// e o Cellproject guarda apenas o texto + o resumo. Isso mantém o IndexedDB
// pequeno e o custo de API baixo: a injeção no prompt usa só o resumo.

export type KBNivel = 'iniciante' | 'intermediario' | 'avancado';

export interface KBSummary {
  titulo: string;
  autores?: string;
  dominio: string; // "marcenaria", "eletrônica analógica", "culinária vegetariana"...
  tags: string[]; // 5-15 conceitos-chave
  resumo: string[]; // 3-6 bullets cobrindo a tese/conteúdo principal
  fatos: KBFato[]; // afirmações concretas e verificáveis (unidades, limites)
  nivel: KBNivel;
}

// Fato verificável — vira candidato a groundTruthRef quando o doc é usado.
export interface KBFato {
  claim: string; // "vento mínimo pra pipa de papel: 10km/h"
  tipo: 'medida' | 'spec' | 'regra' | 'link'; // mapeia em groundTruthKind + 'regra'
  valor?: string; // "10km/h" se aplicável
}

export interface KBDocument {
  id: string;
  filename: string;
  sizeBytes: number;
  pageCount: number;
  extractedAt: number;
  extractedText: string; // texto integral — usado só em casos específicos, não na injeção padrão
  fingerprint: string; // hash do texto; evita duplicatas
  summary: KBSummary;
  // Últimos objetivos onde este doc foi julgado relevante. Pequeno cache
  // em memória; evita pagar AI-judge duas vezes pro mesmo objetivo.
  relevanceCache?: Record<string, boolean>;
}

// Registro mínimo exposto à UI pra listagem (sem carregar extractedText).
export interface KBDocSummaryView {
  id: string;
  filename: string;
  titulo: string;
  dominio: string;
  tags: string[];
  nivel: KBNivel;
  pageCount: number;
  extractedAt: number;
}

// Contexto que o graph store injeta nos prompts do AI service.
// Os campos são enxutos de propósito: cada doc passado tem ~400-800 tokens.
export interface KBContextEntry {
  docId: string;
  titulo: string;
  dominio: string;
  resumo: string[];
  fatos: KBFato[];
  tags: string[];
}
