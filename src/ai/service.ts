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
import { currentLocaleAIName } from '@/i18n';
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
// Public progress types — consumed by the UI to render streaming state
// ---------------------------------------------------------------------------

export type DeepPartial<T> = T extends object ? { [K in keyof T]?: DeepPartial<T[K]> } : T;

export type PlanProgressPhase =
  | 'connecting'
  | 'streaming'
  | 'finalizing'
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
// AI service — multi-provider via Vercel AI SDK.
// Public contract: generatePlans / decomposeNode / explainNode /
// critiqueNode / replanFromFailure.
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
  failureContext: string;
  siblings: { name: string; fx: string }[];
}

// ---------------------------------------------------------------------------
// Shared system prompt — parameterized by the user's locale so the model
// answers in the same language as the UI.
// ---------------------------------------------------------------------------

function baseSystem(): string {
  const lang = currentLocaleAIName();
  return `You are the brain of a visual planning assistant called Cellproject.
The user describes a concrete goal (build something, assemble something, learn something) and you break the problem into a tree of nodes that can be validated one by one.

STYLE
- Always respond in ${lang}.
- Direct, practical, doer's tone. Zero filler, no marketing speak.
- Prefer short sentences. Avoid emoji unless they are part of natural technical content.
- Be specific: "2 bamboo sticks of 40cm" beats "some materials".
- When the goal is ambiguous, assume the most common scenario and proceed — do not ask the user back.

NODE TAXONOMY
- categoria: grouping container (e.g. "Resources", "Execution", "Decisions").
- recurso: something that must be available before execution (material, tool, data, access).
- passo: concrete action in chronological order. Use the 'order' field with an integer.
- decisao: choice between mutually exclusive paths. Fill 'decisionOptions' with 2 or 3 options.
- concept: auxiliary conceptual node. Avoid unless necessary.`;
}

function criticSystem(): string {
  const lang = currentLocaleAIName();
  return `You are a skeptical reviewer hired to BREAK a Cellproject plan node.
Your job is to doubt. Assume the original planner was optimistic, shallow, or made unstated assumptions.

RULES
- Respond in ${lang}, dry tone, no performative empathy.
- No "great point, but". Go straight to what's fragile.
- DO NOT restate what the plan already says. Your value is finding what it does NOT say.
- 'criterioAlternativo' MUST be different in form from the original comoConfirmar. If the original asks "is it ready?", yours should measure something external — a number, a proof, a third-party observation.
- If a user-written criterion exists, treat it as MORE trustworthy than the AI's: your alternative should complement it, not duplicate it.
- Do not propose solutions. Your output is a diagnosis, not a prescription.`;
}

const TUTOR_GUIDANCE_TEMPLATE = `

YOU ARE IN TUTOR MODE
Your output is a MARKDOWN EXPLANATION, not JSON. Senior-engineer depth, explaining to someone who has never done this but is capable of learning.

STRUCTURE
- Section titles in **UPPERCASE BOLD** (e.g. **WHAT IT IS**, **WHY IT MATTERS**, **HOW TO DO IT**, **PITFALLS**, **HOW TO VERIFY**).
- Bullet lists with dashes. Short sentences.
- When there are variants or trade-offs, list each one with the name in **bold** followed by a description.
- Give real numbers (voltages, sizes, commands, known URLs). No "depends on the case".
- Call out common errors ("pitfalls") and how to diagnose.
- Finish with a concrete verification criterion.

DO NOT include introductory filler like "of course, I will explain" — go straight to the content.`;

// ---------------------------------------------------------------------------
// Helpers
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
  return crumbs.length > 0 ? crumbs.join(' › ') : '(root)';
}

function formatSiblings(siblings: { name: string; fx: string }[]) {
  if (siblings.length === 0) return '(no siblings)';
  return siblings.map((s) => `- ${s.name} — ${s.fx}`).join('\n');
}

// Builds the KNOWLEDGE BASE block injected at the start of user prompts.
// Compact on purpose: at most 2 docs, summary as short bullets + up to 5 facts.
// If kbContext is empty/missing this returns an empty string and the prompt
// is unchanged compared to the no-KB flow.
function formatKBContext(kbContext?: KBContextEntry[]): string {
  if (!kbContext || kbContext.length === 0) return '';
  const blocks = kbContext.map((entry) => {
    const fatos = entry.fatos
      .slice(0, 5)
      .map((f) => `  • ${f.claim}${f.valor ? ` (${f.valor})` : ''}`)
      .join('\n');
    const resumo = entry.resumo.slice(0, 4).map((r) => `  • ${r}`).join('\n');
    return `[${entry.docId}] "${entry.titulo}" (${entry.dominio})
Summary:
${resumo}${fatos ? `\nVerifiable facts:\n${fatos}` : ''}`;
  });
  return `\n\nKNOWLEDGE BASE (from the user's personal repository — use as a source, cite the docId in brackets when applicable)
${blocks.join('\n\n')}\n\n`;
}

// ---------------------------------------------------------------------------
// generatePlans — generates 1 to 3 alternative plans for the objective
// ---------------------------------------------------------------------------

export async function generatePlans(
  objective: string,
  onProgress?: PlanProgressCallback,
  kbContext?: KBContextEntry[],
): Promise<AIPlan[]> {
  assertAIReady();

  const userPrompt = `USER GOAL:
"""
${objective.trim()}
"""
${formatKBContext(kbContext)}

TASK
Generate 1 to 3 alternative plans to reach this goal. Order them from the simplest/fastest to the most ambitious/complete.

Each plan must have a tree with 2 or 3 categories:
1. "Resources" (kind: "recursos"): everything that must be gathered before starting.
2. "Execution" (kind: "execucao"): sequential steps, each with 'order' starting at 1.
3. "Decisions" (kind: "decisoes"): ONLY if there is a real trade-off — every child must include 'decisionOptions' (2 or 3).

For each child node: fill oQue / porQue / comoConfirmar with concrete didactic content.

GROUND TRUTH: when a node has any anchor verifiable in the real world, fill 'groundTruthHints'. Prefer concrete specifications over generic descriptions. Examples:
- resource "bamboo": hint with kind="spec" value="Phyllostachys aurea, 40cm ± 2cm, Ø 5-8mm"
- step "tie return knot": hint with kind="link" value="URL of a known tutorial"
- any measurement: kind="medida" value="weight < 15g" (always with unit and tolerance when applicable).
If no natural anchor exists, omit the field — DO NOT invent links.

Use short unique tempIds within the plan (e.g. "p1", "r1", "cat1"). Do not generate edges here.`;

  const startedAt = performance.now();
  const elapsed = () => Math.round(performance.now() - startedAt);

  onProgress?.({ phase: 'connecting', chunkCount: 0, elapsedMs: elapsed() });

  const result = streamObject({
    model: aiModel,
    schema: PlansResponseSchema,
    schemaName: 'PlansResponse',
    system: baseSystem(),
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

// OpenRouter exposes reasoning under providerMetadata.openrouter.reasoning
// (or similar keys depending on the provider version). Tries a few known
// paths and returns a single string, or undefined when the provider did not
// emit reasoning.
function extractReasoning(meta: unknown): string | undefined {
  if (!meta || typeof meta !== 'object') return undefined;
  const root = meta as Record<string, unknown>;
  const candidates = [
    root.openrouter,
    root['openrouter-chat'],
    root.anthropic,
    root.openai,
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
// decomposeNode — break an existing node into children + edges
// ---------------------------------------------------------------------------

export async function decomposeNode(
  ctx: DecomposeContext,
  kbContext?: KBContextEntry[],
): Promise<{ nodes: AISuggestedNode[]; edges: AISuggestedEdge[] }> {
  assertAIReady();

  const guidance = decomposeGuidance(ctx.nodeKind, ctx.nodeName);

  const userPrompt = `PROJECT CONTEXT
- Name: ${ctx.projectName}
- Goal: ${ctx.projectObjective}
- Path to the node: ${formatBreadcrumb(ctx.breadcrumb)}

NODE TO DECOMPOSE
- Name: ${ctx.nodeName}
- Kind: ${ctx.nodeKind}
- Function (fx): ${ctx.nodeFx}

EXISTING SIBLINGS (do not repeat)
${formatSiblings(ctx.siblings)}
${formatKBContext(kbContext)}
TASK
${guidance}

Use short unique tempIds (e.g. "a", "b", "c"). If there is order or dependency between the new nodes, create 'direct' edges between them.`;

  const { object } = await generateObject({
    model: aiModel,
    schema: DecomposeResponseSchema,
    schemaName: 'DecomposeResponse',
    system: baseSystem(),
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
    const isExec = /execu|fluxo|passo|step|flow/i.test(name);
    const isRec = /recurs|material|ferrament|tool|resource/i.test(name);
    if (isExec) {
      return `This is an Execution category. Generate 3 to 6 sequential steps (kind="passo") with increasing 'order'. Connect them with 'direct' edges from step N to step N+1.`;
    }
    if (isRec) {
      return `This is a Resources category. Generate 3 to 8 concrete, specific resources (kind="recurso"). Edges are not required.`;
    }
    return `Generate 3 to 6 children appropriate for this category. Do not repeat the siblings.`;
  }
  if (kind === 'passo') {
    return `Break this step into 2 to 5 smaller and more concrete sub-steps (kind="passo") with sequential 'order'. Each sub-step must be a single physical/logical action, easy to verify. Chain them with 'direct' edges.`;
  }
  if (kind === 'recurso') {
    return `Break this resource into 2 to 4 sub-resources or acquisition stages (kind="recurso"). E.g.: "where to buy", "minimum spec", "homemade alternative".`;
  }
  if (kind === 'decisao') {
    return `Generate 2 to 4 concept/step nodes that detail what happens AFTER the decision — considerations, trade-offs, or prerequisites of each path.`;
  }
  return `Generate 2 to 5 children that elaborate this node. Use the most adequate kind (passo, recurso, decisao).`;
}

// ---------------------------------------------------------------------------
// explainNode — generates a long markdown explanation for tutor mode
// ---------------------------------------------------------------------------

export async function explainNode(ctx: ExplainContext): Promise<string> {
  assertAIReady();

  const systemTutor = `${baseSystem()}${TUTOR_GUIDANCE_TEMPLATE}`;

  const userPrompt = `PROJECT
- Name: ${ctx.projectName}
- Goal: ${ctx.projectObjective}
- Path to the node: ${formatBreadcrumb(ctx.breadcrumb)}

NODE
- Name: ${ctx.nodeName}
- Kind: ${ctx.nodeKind}
- What it is (short summary): ${ctx.oQue}
- Why it matters: ${ctx.porQue}
- Confirmation criterion: ${ctx.comoConfirmar}

Generate the full markdown explanation following the structure above. Focus on letting the user execute this node alone.`;

  const { text } = await generateText({
    model: aiModel,
    system: systemTutor,
    prompt: userPrompt,
    temperature: 0.4,
  });

  return text.trim();
}

// ---------------------------------------------------------------------------
// critiqueNode — adversarial second pass (attack b).
// Uses a distinct persona from BASE_SYSTEM so the alternative criterion is
// truly independent — that's what actually breaks the closed AI→AI loop.
// ---------------------------------------------------------------------------

export async function critiqueNode(ctx: CritiqueContext): Promise<AdversarialCritique> {
  assertAIReady();

  const userPrompt = `PROJECT
- Name: ${ctx.projectName}
- Goal: ${ctx.projectObjective}
- Path: ${formatBreadcrumb(ctx.breadcrumb)}

NODE TO CRITIQUE
- Name: ${ctx.nodeName}
- Kind: ${ctx.nodeKind}
- Function: ${ctx.nodeFx}
- What it is: ${ctx.oQue}
- Why it matters: ${ctx.porQue}
- AI criterion (comoConfirmar): ${ctx.comoConfirmar}
${ctx.comoConfirmarUsuario ? `- User-written criterion: ${ctx.comoConfirmarUsuario}` : '- The user has not written a criterion yet.'}

TASK
Point out weaknesses, hidden assumptions, and propose an INDEPENDENT alternative criterion that a skeptic would use.`;

  const { object } = await generateObject({
    model: aiModel,
    schema: CritiqueResponseSchema,
    schemaName: 'CritiqueResponse',
    system: criticSystem(),
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
// replanFromFailure — replan using real failure context (attack c).
// Reuses DecomposeResponseSchema so the output flows through the same
// staging mechanism that decomposeNode uses.
// ---------------------------------------------------------------------------

export async function replanFromFailure(
  ctx: ReplanContext,
  kbContext?: KBContextEntry[],
): Promise<{ nodes: AISuggestedNode[]; edges: AISuggestedEdge[] }> {
  assertAIReady();

  const userPrompt = `PROJECT CONTEXT
- Name: ${ctx.projectName}
- Goal: ${ctx.projectObjective}
- Path to the node: ${formatBreadcrumb(ctx.breadcrumb)}

NODE THAT FAILED IN PRACTICE
- Name: ${ctx.nodeName}
- Kind: ${ctx.nodeKind}
- Original function: ${ctx.nodeFx}
- What it was: ${ctx.oQue}

WHAT WENT WRONG (reported by the user)
"""
${ctx.failureContext.trim()}
"""

SIBLINGS (context)
${formatSiblings(ctx.siblings)}
${formatKBContext(kbContext)}
TASK
Real execution showed that the original plan didn't work. Re-decompose this node KNOWING what failed. Rules:
1. DO NOT repeat the same decomposition. If the original path failed, assume part of the premise was wrong.
2. If the failure was a resource (broken, missing, out of spec), suggest concrete alternatives and/or a new mitigation step.
3. If the failure was a step, break it into smaller steps covering where it got stuck.
4. Prefer 2–4 new, highly specific nodes. 'direct' edges in a chain when there is order.
5. Every new node should bring verifiable groundTruthHints — the user just burned time on something the AI claimed without an anchor.

Use short unique tempIds (e.g. "a", "b", "c").`;

  const { object } = await generateObject({
    model: aiModel,
    schema: DecomposeResponseSchema,
    schemaName: 'ReplanResponse',
    system: baseSystem(),
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

// Exported for console debugging. Reads the active config at runtime.
export const __AI_META__ = {
  get model() {
    return currentModelIds()?.main ?? null;
  },
  get provider() {
    return currentModelIds()?.provider ?? null;
  },
};
