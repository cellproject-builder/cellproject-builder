import { nanoid } from 'nanoid';
import { generateObject, generateText, streamObject } from 'ai';
import type {
  AdversarialCritique,
  AIPlan,
  AIPlanCategory,
  AISuggestedNode,
  AISuggestedEdge,
  NodeKind,
} from '@/types';
import type { KBContextEntry } from '@/kb/types';
import { aiModel, assertAIReady, currentModelIds } from './client';
import {
  PlansResponseSchema,
  DecomposeResponseSchema,
  CritiqueResponseSchema,
  type PlansResponse,
  type RawPlan,
  type RawSuggestedNode,
  type RawSuggestedEdge,
} from './schemas';

// ---------------------------------------------------------------------------
// Tipos públicos de progresso — consumidos pela UI para mostrar streaming
// ---------------------------------------------------------------------------

export type DeepPartial<T> = T extends object ? { [K in keyof T]?: DeepPartial<T[K]> } : T;

export type PlanProgressPhase =
  | 'connecting' // antes do primeiro chunk
  | 'streaming' // chunks chegando
  | 'finalizing' // stream fechou, validando schema
  | 'done'
  | 'error';

export interface PlanProgressEvent {
  phase: PlanProgressPhase;
  partial?: DeepPartial<PlansResponse>;
  reasoning?: string;
  chunkCount: number;
  elapsedMs: number;
  error?: string;
}

export type PlanProgressCallback = (ev: PlanProgressEvent) => void;

// ---------------------------------------------------------------------------
// AI service — OpenRouter (GLM-5) via Vercel AI SDK
// Contrato idêntico ao antigo mock: generatePlans / decomposeNode / explainNode.
// Toda conversa com o modelo é em pt-BR, tom direto, orientada a ação.
// ---------------------------------------------------------------------------

interface DecomposeContext {
  projectName: string;
  projectObjective: string;
  breadcrumb: string[];
  nodeName: string;
  nodeKind: NodeKind;
  nodeFx: string;
  siblings: { name: string; fx: string }[];
}

interface ExplainContext {
  projectName: string;
  projectObjective: string;
  breadcrumb: string[];
  nodeName: string;
  nodeKind: NodeKind;
  oQue: string;
  porQue: string;
  comoConfirmar: string;
}

interface CritiqueContext {
  projectName: string;
  projectObjective: string;
  breadcrumb: string[];
  nodeName: string;
  nodeKind: NodeKind;
  nodeFx: string;
  oQue: string;
  porQue: string;
  comoConfirmar: string;
  // Critério escrito pelo próprio usuário (se houver). Passamos ao crítico
  // para que ele saiba o que NÃO duplicar.
  comoConfirmarUsuario?: string;
}

interface ReplanContext {
  projectName: string;
  projectObjective: string;
  breadcrumb: string[];
  nodeName: string;
  nodeKind: NodeKind;
  nodeFx: string;
  oQue: string;
  // Contexto de falha real contado pelo usuário.
  failureContext: string;
  siblings: { name: string; fx: string }[];
}

// ---------------------------------------------------------------------------
// System prompt compartilhado — define a persona do modelo
// ---------------------------------------------------------------------------

const BASE_SYSTEM = `Você é o cérebro de um assistente de planejamento visual em grafo chamado Cellproject.
O usuário descreve um objetivo concreto (construir algo, montar algo, aprender algo) e você quebra o problema em uma árvore de nós que podem ser validados um a um.

REGRAS DE ESTILO
- Responda SEMPRE em português do Brasil.
- Tom direto, prático, de quem faz. Zero rodeio, zero "vamos explorar".
- Prefira frases curtas. Evite marketing. Não use emoji salvo se fizer parte de conteúdo técnico natural.
- Seja específico: "2 varetas de bambu de 40cm" é melhor que "alguns materiais".
- Quando o objetivo for ambíguo, assuma o cenário mais comum e siga — sem perguntas de volta.

TAXONOMIA DE NÓS
- categoria: agrupador (ex: "Recursos", "Execução", "Decisões").
- recurso: coisa que precisa estar disponível antes da execução (material, ferramenta, dado, acesso).
- passo: ação concreta em ordem cronológica. Use 'order' numérico.
- decisao: escolha entre caminhos mutuamente exclusivos. Preencha 'decisionOptions' com 2 ou 3 opções.
- concept: nó conceitual auxiliar. Evite a menos que seja necessário.`;

// ---------------------------------------------------------------------------
// Helpers de transformação
// ---------------------------------------------------------------------------

function materializeNode(raw: RawSuggestedNode, idMap: Map<string, string>): AISuggestedNode {
  const realTempId = idMap.get(raw.tempId) ?? nanoid(6);
  idMap.set(raw.tempId, realTempId);
  return {
    tempId: realTempId,
    kind: raw.kind,
    name: raw.name,
    fx: raw.fx,
    problem: raw.problem,
    confidence: clamp(Math.round(raw.confidence), 0, 100),
    confidenceReason: raw.confidenceReason,
    pros: raw.pros ?? [],
    cons: raw.cons ?? [],
    oQue: raw.oQue,
    porQue: raw.porQue,
    comoConfirmar: raw.comoConfirmar,
    order: raw.order,
    decisionOptions: raw.decisionOptions?.map((o) => ({
      id: nanoid(6),
      label: o.label,
      pitch: o.pitch,
      consequences: o.consequences,
    })),
    groundTruthHints: raw.groundTruthHints?.map((h) => ({
      kind: h.kind,
      label: h.label,
      value: h.value,
    })),
  };
}

function materializeEdge(raw: RawSuggestedEdge, idMap: Map<string, string>): AISuggestedEdge | null {
  const source = idMap.get(raw.sourceTempId);
  const target = idMap.get(raw.targetTempId);
  if (!source || !target) return null;
  return {
    sourceTempId: source,
    targetTempId: target,
    kind: raw.kind,
    note: raw.note,
  };
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function formatBreadcrumb(crumbs: string[]) {
  return crumbs.length > 0 ? crumbs.join(' › ') : '(raiz)';
}

function formatSiblings(siblings: { name: string; fx: string }[]) {
  if (siblings.length === 0) return '(nenhum irmão)';
  return siblings.map((s) => `- ${s.name} — ${s.fx}`).join('\n');
}

// Monta o bloco CONHECIMENTO DE BASE que vai no início do user prompt.
// Enxuto de propósito: 2 docs máximo, resumo em bullets curtos + até 5 fatos.
// Se kbContext estiver vazio ou ausente, retorna string vazia e o prompt
// segue idêntico ao fluxo original (zero regressão quando não há KB).
function formatKBContext(kbContext?: KBContextEntry[]): string {
  if (!kbContext || kbContext.length === 0) return '';
  const blocks = kbContext.map((entry) => {
    const fatos = entry.fatos
      .slice(0, 5)
      .map((f) => `  • ${f.claim}${f.valor ? ` (${f.valor})` : ''}`)
      .join('\n');
    const resumo = entry.resumo.slice(0, 4).map((r) => `  • ${r}`).join('\n');
    return `[${entry.docId}] "${entry.titulo}" (${entry.dominio})
Resumo:
${resumo}${fatos ? `\nFatos verificáveis:\n${fatos}` : ''}`;
  });
  return `\n\nCONHECIMENTO DE BASE (do repositório pessoal do usuário — use como fonte, cite o docId entre colchetes quando aplicável)
${blocks.join('\n\n')}\n\n`;
}

// ---------------------------------------------------------------------------
// generatePlans — gera 1 a 3 planos alternativos para o objetivo
// ---------------------------------------------------------------------------

export async function generatePlans(
  objective: string,
  onProgress?: PlanProgressCallback,
  kbContext?: KBContextEntry[],
): Promise<AIPlan[]> {
  assertAIReady();

  const userPrompt = `OBJETIVO DO USUÁRIO:
"""
${objective.trim()}
"""
${formatKBContext(kbContext)}

TAREFA
Gere de 1 a 3 planos alternativos para alcançar esse objetivo. Ordene do mais simples/rápido ao mais ambicioso/completo.

Cada plano deve ter uma árvore com 2 ou 3 categorias:
1. "Recursos" (kind: "recursos"): tudo que precisa ser reunido antes de começar.
2. "Execução" (kind: "execucao"): passos sequenciais, cada um com 'order' começando em 1.
3. "Decisões" (kind: "decisoes"): APENAS se existir tradeoff real — cada nó filho deve ter 'decisionOptions' (2 ou 3).

Para cada nó filho: preencha oQue/porQue/comoConfirmar com conteúdo didático concreto.

GROUND TRUTH: quando um nó tiver qualquer âncora verificável no mundo real, preencha 'groundTruthHints'. Prefira especificações concretas a descrições genéricas. Exemplos:
- recurso "bambu": hint com kind="spec" value="Phyllostachys aurea, 40cm ± 2cm, Ø 5-8mm"
- passo "amarrar nó de volta": hint com kind="link" value="URL de tutorial conhecido"
- medida qualquer: kind="medida" value="peso < 15g" (sempre com unidade e tolerância quando aplicável).
Se não existir âncora natural, omita o campo — NÃO invente links.

Use tempIds curtos e únicos dentro do plano (ex: "p1", "r1", "cat1"). Não gere arestas aqui.`;

  const startedAt = performance.now();
  const elapsed = () => Math.round(performance.now() - startedAt);

  onProgress?.({ phase: 'connecting', chunkCount: 0, elapsedMs: elapsed() });

  const result = streamObject({
    model: aiModel,
    schema: PlansResponseSchema,
    schemaName: 'PlansResponse',
    system: BASE_SYSTEM,
    prompt: userPrompt,
    temperature: 0.6,
  });

  let chunkCount = 0;
  let lastPartial: DeepPartial<PlansResponse> | undefined;

  try {
    for await (const partial of result.partialObjectStream) {
      chunkCount += 1;
      lastPartial = partial as DeepPartial<PlansResponse>;
      onProgress?.({
        phase: 'streaming',
        partial: lastPartial,
        chunkCount,
        elapsedMs: elapsed(),
      });
    }

    onProgress?.({
      phase: 'finalizing',
      partial: lastPartial,
      chunkCount,
      elapsedMs: elapsed(),
    });

    const finalObject = await result.object;
    const providerMetadata = await result.providerMetadata;
    const reasoning = extractReasoning(providerMetadata);

    const hydrated = finalObject.plans.map(hydratePlan);

    onProgress?.({
      phase: 'done',
      partial: lastPartial,
      reasoning,
      chunkCount,
      elapsedMs: elapsed(),
    });

    return hydrated;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    onProgress?.({
      phase: 'error',
      partial: lastPartial,
      chunkCount,
      elapsedMs: elapsed(),
      error: message,
    });
    throw err;
  }
}

// OpenRouter devolve reasoning em providerMetadata.openrouter.reasoning (ou similar
// dependendo da versão do provider). Tenta alguns caminhos conhecidos e devolve
// string única, ou undefined se o modelo/provider não emitiu reasoning.
function extractReasoning(meta: unknown): string | undefined {
  if (!meta || typeof meta !== 'object') return undefined;
  const root = meta as Record<string, unknown>;
  const candidates = [
    root.openrouter,
    root['openrouter-chat'],
    root.reasoning,
  ].filter(Boolean);

  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c;
    if (c && typeof c === 'object') {
      const obj = c as Record<string, unknown>;
      const r = obj.reasoning ?? obj.reasoningText ?? obj.reasoning_text;
      if (typeof r === 'string' && r.trim()) return r;
      if (Array.isArray(r)) {
        const joined = r
          .map((x) => (typeof x === 'string' ? x : typeof x === 'object' && x && 'text' in x ? (x as { text?: unknown }).text : ''))
          .filter((s): s is string => typeof s === 'string' && s.length > 0)
          .join('\n');
        if (joined) return joined;
      }
    }
  }
  return undefined;
}

function hydratePlan(raw: RawPlan): AIPlan {
  const idMap = new Map<string, string>();
  const categorias: AIPlanCategory[] = raw.tree.categorias.map((cat) => ({
    tempId: nanoid(6),
    name: cat.name,
    kind: cat.kind,
    oQue: cat.oQue,
    porQue: cat.porQue,
    children: cat.children.map((c) => materializeNode(c, idMap)),
  }));

  return {
    id: nanoid(8),
    title: raw.title,
    pitch: raw.pitch,
    approach: raw.approach,
    tree: { categorias },
  };
}

// ---------------------------------------------------------------------------
// decomposeNode — quebra um nó existente em filhos + arestas entre eles
// ---------------------------------------------------------------------------

export async function decomposeNode(
  ctx: DecomposeContext,
  kbContext?: KBContextEntry[],
): Promise<{ nodes: AISuggestedNode[]; edges: AISuggestedEdge[] }> {
  assertAIReady();

  const guidance = decomposeGuidance(ctx.nodeKind, ctx.nodeName);

  const userPrompt = `CONTEXTO DO PROJETO
- Nome: ${ctx.projectName}
- Objetivo: ${ctx.projectObjective}
- Caminho até o nó: ${formatBreadcrumb(ctx.breadcrumb)}

NÓ A DECOMPOR
- Nome: ${ctx.nodeName}
- Tipo: ${ctx.nodeKind}
- Função (fx): ${ctx.nodeFx}

IRMÃOS JÁ EXISTENTES (não repita)
${formatSiblings(ctx.siblings)}
${formatKBContext(kbContext)}
TAREFA
${guidance}

Use tempIds curtos e únicos (ex: "a", "b", "c"). Se houver ordem ou dependência entre os novos nós, crie arestas 'direct' entre eles.`;

  const { object } = await generateObject({
    model: aiModel,
    schema: DecomposeResponseSchema,
    schemaName: 'DecomposeResponse',
    system: BASE_SYSTEM,
    prompt: userPrompt,
    temperature: 0.5,
  });

  const idMap = new Map<string, string>();
  const nodes = object.nodes.map((n) => materializeNode(n, idMap));
  const edges = object.edges
    .map((e) => materializeEdge(e, idMap))
    .filter((e): e is AISuggestedEdge => e !== null);

  return { nodes, edges };
}

function decomposeGuidance(kind: NodeKind, name: string): string {
  if (kind === 'categoria') {
    const isExec = /execu|fluxo|passo/i.test(name);
    const isRec = /recurs|material|ferrament/i.test(name);
    if (isExec) {
      return `Esta é uma categoria de Execução. Gere 3 a 6 passos sequenciais (kind="passo") com 'order' crescente. Conecte-os com arestas 'direct' do passo N ao N+1.`;
    }
    if (isRec) {
      return `Esta é uma categoria de Recursos. Gere 3 a 8 recursos específicos e concretos (kind="recurso"). Não precisa de arestas.`;
    }
    return `Gere 3 a 6 filhos apropriados para esta categoria. Não repita os irmãos.`;
  }
  if (kind === 'passo') {
    return `Quebre este passo em 2 a 5 sub-passos menores e mais concretos (kind="passo") com 'order' sequencial. Cada sub-passo deve ser uma ação física/lógica única, fácil de verificar. Conecte em cadeia com arestas 'direct'.`;
  }
  if (kind === 'recurso') {
    return `Quebre este recurso em 2 a 4 sub-recursos ou etapas de aquisição (kind="recurso"). Ex: "onde comprar", "especificação mínima", "alternativa caseira".`;
  }
  if (kind === 'decisao') {
    return `Gere 2 a 4 nós concept/passo que detalhem o que acontece DEPOIS da decisão — considerações, trade-offs, ou pré-requisitos de cada caminho.`;
  }
  return `Gere 2 a 5 filhos que aprofundem este nó. Use o tipo mais adequado (passo, recurso, decisão).`;
}

// ---------------------------------------------------------------------------
// explainNode — gera explicação longa em markdown para o modo tutor
// ---------------------------------------------------------------------------

export async function explainNode(ctx: ExplainContext): Promise<string> {
  assertAIReady();

  const systemTutor = `${BASE_SYSTEM}

VOCÊ ESTÁ NO MODO TUTOR
Sua saída é uma EXPLICAÇÃO EM MARKDOWN, não um JSON. Profundidade de engenheiro sênior explicando para alguém que nunca fez isso mas é capaz de aprender.

ESTRUTURA
- Títulos em **NEGRITO MAIÚSCULO** curtos (ex: **O QUE É**, **POR QUE IMPORTA**, **COMO FAZER**, **ARMADILHAS**, **COMO VERIFICAR**).
- Listas com travessão. Frases curtas.
- Quando houver variantes ou trade-offs, liste cada uma com nome em **negrito** seguido de descrição.
- Dê números reais (tensões, tamanhos, comandos, URLs conhecidos). Nada de "varia conforme o caso".
- Aponte erros comuns ("armadilhas") e como diagnosticar.
- Finalize com um critério concreto de verificação.

NÃO inclua frases introdutórias tipo "claro, vou explicar" — vá direto ao conteúdo.`;

  const userPrompt = `PROJETO
- Nome: ${ctx.projectName}
- Objetivo: ${ctx.projectObjective}
- Caminho até o nó: ${formatBreadcrumb(ctx.breadcrumb)}

NÓ
- Nome: ${ctx.nodeName}
- Tipo: ${ctx.nodeKind}
- O que é (resumo curto): ${ctx.oQue}
- Por que importa: ${ctx.porQue}
- Critério de confirmação: ${ctx.comoConfirmar}

Gere a explicação completa em markdown seguindo a estrutura definida. Foque em deixar o usuário capaz de executar este nó sozinho.`;

  const { text } = await generateText({
    model: aiModel,
    system: systemTutor,
    prompt: userPrompt,
    temperature: 0.4,
  });

  return text.trim();
}

// ---------------------------------------------------------------------------
// critiqueNode — segunda passada adversarial (attack b)
// Persona distinta do BASE_SYSTEM: cético contratado para quebrar o nó.
// Retorna um criterioAlternativo independente do comoConfirmar original —
// é a saída que realmente rompe o loop fechado IA→IA.
// ---------------------------------------------------------------------------

const CRITIC_SYSTEM = `Você é um revisor cético contratado para QUEBRAR um nó de plano do Cellproject.
Seu trabalho é desconfiar. Parta do princípio de que o planejador original foi otimista, superficial, ou assumiu coisas que não deveria.

REGRAS
- Responda em português do Brasil, tom seco, sem simpatia performática.
- Nada de "é um ótimo ponto, mas". Vá direto ao que está frágil.
- NÃO reafirme o que o plano já diz. Seu valor é achar o que ele NÃO diz.
- 'criterioAlternativo' DEVE ser diferente em forma do comoConfirmar original. Se o original pergunta "está pronto?", o seu deve medir algo externo — um número, uma prova, uma observação de terceiro.
- Se existir um critério escrito pelo usuário, considere-o MAIS confiável que o da IA: seu alternativo deve complementá-lo, não duplicá-lo.
- Não sugira soluções. Sua saída é diagnóstico, não prescrição.`;

export async function critiqueNode(ctx: CritiqueContext): Promise<AdversarialCritique> {
  assertAIReady();

  const userPrompt = `PROJETO
- Nome: ${ctx.projectName}
- Objetivo: ${ctx.projectObjective}
- Caminho: ${formatBreadcrumb(ctx.breadcrumb)}

NÓ A CRITICAR
- Nome: ${ctx.nodeName}
- Tipo: ${ctx.nodeKind}
- Função: ${ctx.nodeFx}
- O que é: ${ctx.oQue}
- Por que importa: ${ctx.porQue}
- Critério da IA (comoConfirmar): ${ctx.comoConfirmar}
${ctx.comoConfirmarUsuario ? `- Critério escrito pelo usuário: ${ctx.comoConfirmarUsuario}` : '- Usuário ainda não escreveu critério próprio.'}

TAREFA
Aponte fraquezas, premissas ocultas, e proponha um critério alternativo INDEPENDENTE que um cético usaria.`;

  const { object } = await generateObject({
    model: aiModel,
    schema: CritiqueResponseSchema,
    schemaName: 'CritiqueResponse',
    system: CRITIC_SYSTEM,
    prompt: userPrompt,
    temperature: 0.7,
  });

  return {
    fraquezas: object.fraquezas,
    premissasOcultas: object.premissasOcultas,
    criterioAlternativo: object.criterioAlternativo,
    generatedAt: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// replanFromFailure — replan com contexto de falha real (attack c)
// Reutiliza DecomposeResponseSchema: a saída entra no mesmo mecanismo de
// staging que decomposeNode, pra o usuário aceitar/rejeitar.
// ---------------------------------------------------------------------------

export async function replanFromFailure(
  ctx: ReplanContext,
  kbContext?: KBContextEntry[],
): Promise<{ nodes: AISuggestedNode[]; edges: AISuggestedEdge[] }> {
  assertAIReady();

  const userPrompt = `CONTEXTO DO PROJETO
- Nome: ${ctx.projectName}
- Objetivo: ${ctx.projectObjective}
- Caminho até o nó: ${formatBreadcrumb(ctx.breadcrumb)}

NÓ QUE FALHOU NA PRÁTICA
- Nome: ${ctx.nodeName}
- Tipo: ${ctx.nodeKind}
- Função original: ${ctx.nodeFx}
- O que era: ${ctx.oQue}

O QUE DEU ERRADO (relatado pelo usuário)
"""
${ctx.failureContext.trim()}
"""

IRMÃOS (contexto)
${formatSiblings(ctx.siblings)}
${formatKBContext(kbContext)}
TAREFA
A execução real mostrou que o plano original não funcionou. Re-decomponha este nó SABENDO do que falhou. Regras:
1. NÃO repita a mesma decomposição. Se o caminho original falhou, assuma que parte da premissa era errada.
2. Se a falha foi um recurso (quebrou, não existe, está fora de spec), sugira alternativas concretas e/ou uma etapa nova de mitigação.
3. Se a falha foi um passo, quebre em passos menores cobrindo o ponto onde travou.
4. Prefira 2–4 nós novos, bem específicos. Arestas 'direct' em cadeia quando houver ordem.
5. Cada novo nó deve trazer groundTruthHints verificáveis — o usuário acabou de queimar tempo com algo que a IA afirmou sem âncora.

Use tempIds curtos e únicos (ex: "a", "b", "c").`;

  const { object } = await generateObject({
    model: aiModel,
    schema: DecomposeResponseSchema,
    schemaName: 'ReplanResponse',
    system: BASE_SYSTEM,
    prompt: userPrompt,
    temperature: 0.4,
  });

  const idMap = new Map<string, string>();
  const nodes = object.nodes.map((n) => materializeNode(n, idMap));
  const edges = object.edges
    .map((e) => materializeEdge(e, idMap))
    .filter((e): e is AISuggestedEdge => e !== null);

  return { nodes, edges };
}

// Exportado para debug no console se necessário. Lê a config ativa em runtime.
export const __AI_META__ = {
  get model() {
    return currentModelIds()?.main ?? null;
  },
  get provider() {
    return currentModelIds()?.provider ?? null;
  },
};
