import { nanoid } from 'nanoid';
import {
  APICallError,
  JSONParseError,
  NoObjectGeneratedError,
  RetryError,
  TypeValidationError,
  generateObject,
  streamObject,
  streamText,
} from 'ai';
import type { z } from 'zod';
import type {
  AdversarialCritique,
  AIPlan,
  AIPlanCategory,
  AIPlanOutline,
  AISuggestedNode,
  AISuggestedEdge,
  AISuggestedGroundTruthHint,
  ConstructionStrategy,
  DecisionOption,
  ProjectArchetype,
  NodeKind,
  NodeState,
} from '@/types';
import type { KBContextEntry } from '@/kb/types';
import {
  aiModel,
  assertAIReady,
  callOpts,
  currentModelIds,
  effortProviderOptions,
  AIMissingKeyError,
  type AICallKind,
  type Effort,
} from './client';
import { currentLocale, currentLocaleAIName, t } from '@/i18n';
import {
  isWebResearchOn,
  runResearch,
  formatResearchBlock,
  type ResearchDigest,
  type ResearchSource,
} from './research';
import {
  PlanSchema,
  PlansResponseSchema,
  PlanOutlineSchema,
  OutlinesResponseSchema,
  ExpandResponseSchema,
  SuggestedNodeSchema,
  DecomposeResponseSchema,
  ReplanResponseSchema,
  CritiqueResponseSchema,
  type PlansResponse,
  type OutlinesResponse,
  type ExpandResponse,
  type RawPlan,
  type RawPlanOutline,
  type RawPlanCategory,
  type RawSuggestedNode,
  type RawSuggestedEdge,
} from './schemas';

// ---------------------------------------------------------------------------
// Public progress types — consumed by the UI to render streaming state
// ---------------------------------------------------------------------------

export type DeepPartial<T> = T extends object ? { [K in keyof T]?: DeepPartial<T[K]> } : T;

export type PlanProgressPhase =
  | 'researching'
  | 'connecting'
  // Request aceita mas nenhum pedaço do JSON chegou ainda — o modelo está
  // raciocinando (o raciocínio do gpt-6.x vem criptografado, invisível).
  | 'thinking'
  | 'streaming'
  | 'finalizing'
  | 'done'
  | 'error';

// Genérico no parcial: generatePlans (planos completos), outlinePlans
// (esboços) e expandPlan (árvore de um plano) usam o mesmo modelo de eventos.
export interface PlanProgressEvent<TPartial = DeepPartial<PlansResponse>> {
  phase: PlanProgressPhase;
  partial?: TPartial;
  /** @deprecated o raciocínio do gpt-6.x vem criptografado — nunca é preenchido. */
  reasoning?: string;
  chunkCount: number;
  elapsedMs: number;
  // Epoch (Date.now()) do início da geração — a UI roda o relógio local com
  // isto em vez de depender da chegada de eventos.
  startedAt?: number;
  error?: string;
  errorInfo?: AIErrorInfo;
  // Aviso não-fatal (ex.: planos incompletos descartados na recuperação).
  warning?: string;
  // Digest da pesquisa web (quando o modo pesquisa está ligado) — a UI mostra
  // as fontes reais consultadas junto dos planos.
  research?: ResearchDigest;
  // Só na expansão: nós completos já recebidos / total de nós do esboço.
  nodesReady?: number;
  nodesTotal?: number;
}

export type PlanProgressCallback = (ev: PlanProgressEvent) => void;

// Campos que o service entrega além do contrato de types.ts. Os tipos são
// superconjuntos: quem espera AIPlan/AISuggestedNode continua compilando.
export interface AIPlanEstimates {
  custo: string;
  tempo: string;
  dificuldade: 'iniciante' | 'intermediario' | 'avancado';
}

export interface AIPlanRuleCheck {
  rule: string;
  status: 'cumpre' | 'risco' | 'viola';
  nota: string;
}

export type AIPlanOut = AIPlan & { estimates?: AIPlanEstimates; rulesCheck?: AIPlanRuleCheck[] };

// ruleConflict também é espelhado em `cons` (persistido pelo store hoje).
export type AISuggestedNodeOut = AISuggestedNode & { ruleConflict?: string };

export interface AISuggestionsResult {
  nodes: AISuggestedNodeOut[];
  edges: AISuggestedEdge[];
}

export interface AICallOptions {
  signal?: AbortSignal;
}

// ---------------------------------------------------------------------------
// Erros — classificados e legíveis no idioma do usuário.
// ---------------------------------------------------------------------------

export type AIErrorKind =
  | 'auth'
  | 'credits'
  | 'model'
  | 'schema'
  | 'rate'
  | 'timeout'
  | 'network'
  | 'aborted'
  | 'unknown';

export interface AIErrorInfo {
  kind: AIErrorKind;
  title: string;
  hint: string;
  // Detalhe técnico (corpo do provider, mensagem crua) — pra "ver detalhes".
  detail?: string;
  status?: number;
}

// Erro que todos os fluxos de IA lançam. `message` = título + dica, então
// call sites que só mostram err.message já exibem algo legível.
export class AIError extends Error {
  readonly info: AIErrorInfo;
  constructor(info: AIErrorInfo, cause?: unknown) {
    super(`${info.title}. ${info.hint}`);
    this.name = 'AIError';
    this.info = info;
    if (cause !== undefined) (this as Error & { cause?: unknown }).cause = cause;
  }
}

function errorName(err: unknown): string {
  return typeof err === 'object' && err !== null && 'name' in err
    ? String((err as { name: unknown }).name)
    : '';
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

// APICallError costuma vir com message genérica ("Provider returned error") e
// o motivo real enterrado no responseBody.
function providerDetail(err: APICallError): string {
  const body = err.responseBody;
  if (typeof body !== 'string' || body.length === 0) return err.message;
  try {
    const parsed = JSON.parse(body) as {
      error?: { message?: string; code?: string | number; metadata?: { raw?: string } };
    };
    const raw = parsed.error?.metadata?.raw;
    const msg = parsed.error?.message;
    return [msg, raw].filter(Boolean).join(' — ') || body;
  } catch {
    return body;
  }
}

const FORMAT_RE = /json_schema|response_format|invalid schema|structured output/i;
const MODEL_RE = /not a valid model|model.*(not found|does not exist)|no endpoints found/i;
const CREDITS_RE = /insufficient (credits|funds|balance)|requires more credits|payment required/i;
const NETWORK_RE = /failed to fetch|fetch failed|networkerror|network error|load failed|ECONNRESET|ENOTFOUND/i;

export function classifyAIError(err: unknown): AIErrorInfo {
  const e = t().ai.errors;
  if (err instanceof AIError) return err.info;
  const model = currentModelIds()?.main ?? '?';

  // 429/5xx são retentados pelo SDK e chegam embrulhados num RetryError.
  if (RetryError.isInstance(err) && err.lastError !== undefined) err = err.lastError;

  const name = errorName(err);
  if (name === 'TimeoutError') return { kind: 'timeout', title: e.timeoutTitle, hint: e.timeoutHint };
  if (name === 'AbortError' || name === 'ResponseAborted') {
    return { kind: 'aborted', title: e.abortedTitle, hint: e.abortedHint };
  }
  if (err instanceof AIMissingKeyError) {
    return { kind: 'auth', title: e.missingKeyTitle, hint: e.missingKeyHint };
  }
  if (name === 'AIUnavailableError') {
    return { kind: 'auth', title: errorMessage(err), hint: e.missingKeyHint };
  }

  if (APICallError.isInstance(err)) {
    const status = err.statusCode;
    const detail = providerDetail(err).slice(0, 600);
    const base = { status, detail };
    if (status === 401 || status === 403) return { ...base, kind: 'auth', title: e.authTitle, hint: e.authHint };
    if (status === 402 || CREDITS_RE.test(detail)) {
      return { ...base, kind: 'credits', title: e.creditsTitle, hint: e.creditsHint };
    }
    if (status === 404 || MODEL_RE.test(detail)) {
      return { ...base, kind: 'model', title: e.modelTitle(model), hint: e.modelHint };
    }
    if (status === 429) return { ...base, kind: 'rate', title: e.rateTitle, hint: e.rateHint };
    if (status === 408 || status === 504) {
      return { ...base, kind: 'timeout', title: e.timeoutTitle, hint: e.timeoutHint };
    }
    if (FORMAT_RE.test(detail)) {
      return { ...base, kind: 'schema', title: e.formatTitle(model), hint: e.formatHint };
    }
    if (status === undefined && NETWORK_RE.test(`${err.message} ${errorMessage(err.cause)}`)) {
      return { ...base, kind: 'network', title: e.networkTitle, hint: e.networkHint };
    }
    if (status !== undefined) {
      return { ...base, kind: 'unknown', title: e.providerTitle(status), hint: e.providerHint };
    }
    return { ...base, kind: 'unknown', title: e.unknownTitle, hint: e.unknownHint };
  }

  if (
    NoObjectGeneratedError.isInstance(err) ||
    TypeValidationError.isInstance(err) ||
    JSONParseError.isInstance(err)
  ) {
    return {
      kind: 'schema',
      title: e.outputTitle,
      hint: e.outputHint,
      detail: errorMessage(err).slice(0, 600),
    };
  }

  // Erros que chegam como texto (ex.: erro dentro do stream do OpenRouter).
  const msg = errorMessage(err);
  const detail = msg.slice(0, 600);
  if (NETWORK_RE.test(msg)) return { kind: 'network', title: e.networkTitle, hint: e.networkHint, detail };
  if (FORMAT_RE.test(msg)) return { kind: 'schema', title: e.formatTitle(model), hint: e.formatHint, detail };
  if (CREDITS_RE.test(msg)) return { kind: 'credits', title: e.creditsTitle, hint: e.creditsHint, detail };
  if (MODEL_RE.test(msg)) return { kind: 'model', title: e.modelTitle(model), hint: e.modelHint, detail };
  if (/rate.?limit|too many requests/i.test(msg)) {
    return { kind: 'rate', title: e.rateTitle, hint: e.rateHint, detail };
  }
  return { kind: 'unknown', title: e.unknownTitle, hint: e.unknownHint, detail };
}

// Wrapper legado: Error com título + dica. Preferir classifyAIError na UI.
export function readableAIError(err: unknown): Error {
  return err instanceof AIError ? err : new AIError(classifyAIError(err), err);
}

// Converte qualquer falha num AIError. Se o signal abortou, o motivo dele
// manda (o SDK às vezes embrulha o abort num erro genérico).
function toAIError(err: unknown, signal?: AbortSignal): AIError {
  if (err instanceof AIError) return err;
  const source = signal?.aborted ? (signal.reason ?? err) : err;
  return new AIError(classifyAIError(source), err);
}

// ---------------------------------------------------------------------------
// Cancelamento
// ---------------------------------------------------------------------------

const PLANS_TIMEOUT_MS = 240_000;

function timeoutSignal(ms: number): AbortSignal {
  if (typeof AbortSignal.timeout === 'function') return AbortSignal.timeout(ms);
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(new DOMException('timeout', 'TimeoutError')), ms);
  return ctrl.signal;
}

function anySignal(signals: (AbortSignal | undefined)[]): AbortSignal | undefined {
  const list = signals.filter((s): s is AbortSignal => !!s);
  if (list.length <= 1) return list[0];
  if (typeof AbortSignal.any === 'function') return AbortSignal.any(list);
  const ctrl = new AbortController();
  for (const s of list) {
    if (s.aborted) {
      ctrl.abort(s.reason);
      break;
    }
    s.addEventListener('abort', () => ctrl.abort(s.reason), { once: true });
  }
  return ctrl.signal;
}

// Rejeita assim que o signal abortar, sem esperar o provider fechar o stream.
function raceAbort<T>(p: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return p;
  if (signal.aborted) {
    p.catch(() => {});
    return Promise.reject(signal.reason);
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      p.catch(() => {});
      reject(signal.reason);
    };
    signal.addEventListener('abort', onAbort, { once: true });
    p.then(
      (v) => {
        signal.removeEventListener('abort', onAbort);
        resolve(v);
      },
      (err) => {
        signal.removeEventListener('abort', onAbort);
        reject(err);
      },
    );
  });
}

// ---------------------------------------------------------------------------
// AI service — multi-provider via Vercel AI SDK.
// Public contract: generatePlans / decomposeNode / explainNode /
// critiqueNode / replanFromFailure.
// ---------------------------------------------------------------------------

// `research` em todos os contextos de nó = digest salvo pela pesquisa POR
// CÉLULA (node.webResearch). Quem busca é o usuário, explicitamente, uma vez;
// estes fluxos só reaproveitam o resultado como contexto — custo zero extra.
export interface DecomposeContext {
  projectName: string;
  projectObjective: string;
  breadcrumb: string[];
  nodeName: string;
  nodeKind: NodeKind;
  nodeFx: string;
  siblings: { name: string; fx: string }[];
  strategy?: ConstructionStrategy;
  archetype?: ProjectArchetype;
  rules?: string[];
  research?: ResearchDigest | null;
  // Conteúdo do próprio nó — os filhos cobrem exatamente isto.
  oQue?: string;
  porQue?: string;
  comoConfirmar?: string;
  comoConfirmarUsuario?: string;
  // Nomes de nós que o usuário já sabe/fez (takenAsKnown/done), até 15.
  knownElsewhere?: string[];
  // Kind da categoria persistido (quando nodeKind = 'categoria').
  categoryKind?: AIPlanCategory['kind'];
}

export interface ExplainContext {
  projectName: string;
  projectObjective: string;
  breadcrumb: string[];
  nodeName: string;
  nodeKind: NodeKind;
  oQue: string;
  porQue: string;
  comoConfirmar: string;
  // Critério do usuário antes do da IA: sem lock, o critério da IA NÃO vai
  // pro prompt e a explicação não traz seção de verificação.
  criterionLocked?: boolean;
  comoConfirmarUsuario?: string;
  rules?: string[];
  research?: ResearchDigest | null;
  // Pai, filhos e irmãos já no plano (nome + oQue): a explicação reusa os
  // preços/números deles em vez de inventar outros.
  relatedParts?: { relation: 'parent' | 'child' | 'sibling'; name: string; oQue: string }[];
}

export interface CritiqueContext {
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
  rules?: string[];
  research?: ResearchDigest | null;
}

export interface ReplanContext {
  projectName: string;
  projectObjective: string;
  breadcrumb: string[];
  nodeName: string;
  nodeKind: NodeKind;
  nodeFx: string;
  oQue: string;
  failureContext: string;
  siblings: { name: string; fx: string }[];
  strategy?: ConstructionStrategy;
  archetype?: ProjectArchetype;
  rules?: string[];
  research?: ResearchDigest | null;
  // A decomposição que falhou — o modelo precisa vê-la pra não repeti-la.
  currentChildren?: { name: string; oQue: string; state: NodeState }[];
  comoConfirmar?: string;
  // Âncoras que se provaram falsas ou não foram verificadas.
  failedAnchors?: string[];
}

// ---------------------------------------------------------------------------
// Shared system prompt — parameterized by the user's locale so the model
// answers in the same language as the UI.
// ---------------------------------------------------------------------------

function baseSystem(): string {
  const lang = currentLocaleAIName();
  return `You are the brain of a visual planning assistant called Cellproject.
The user describes a concrete goal (build something, assemble something, learn something) and you break the problem into a tree of nodes that can be validated one by one.

STANCE — REUSE FIRST
- Think like a resourceful, creative maker, not a textbook engineer building from zero.
- Default to reaching the goal by ADAPTING, repurposing, cannibalizing, and RECOMBINING things that already exist: off-the-shelf parts, second-hand/salvaged components, donor systems, existing tools, services, standards, kits, and templates.
- For every resource or step, ask FIRST "does this already exist somewhere I can reuse or adapt?" before "how do I build this?". Prefer "find/adapt an existing X" over "manufacture X from scratch".
- Building from scratch ("forging the steel yourself") is the expensive last resort — propose it only when reuse genuinely cannot deliver the result, or when the user EXPLICITLY asks to build it from zero. When you do fall back to from-scratch, briefly say why reuse was ruled out.
- Concrete reuse beats generic advice: "a used 50cc scooter engine from a scrapyard" beats "an engine".

COMPLETENESS — THE TREE MUST CLOSE
- Before answering, mentally simulate the finished result WORKING end to end (power it on, fly it, run it, use it, explain it). EVERY component and EVERY action that simulation touches must exist as a node — the ones people forget are exactly the ones that block the user later.
- For physical/electronic builds the usual blind spots are: the control electronics (flight controller / driver board / microcontroller), power source + charger, command path (transmitter + receiver or app), the CONNECTIONS (which wire is soldered/plugged where), firmware/software/configuration, calibration, and a final functional test. A "drone" plan with only frame + motors is NOT a drone plan — without board, battery, receiver and soldering it never leaves the bench.
- Vague steps hide work: "assemble and wire everything" is not a step. Say HOW — solder vs plug, which wire to which pad/port, which setting to which value.
- A plan whose resources could not physically produce a working result, or whose steps stop before a working tested result, is an INVALID answer.

STYLE
- Always respond in ${lang}.
- Direct, practical, doer's tone. Zero filler, no marketing speak.
- Prefer short, simple sentences. The first time a technical term appears, add a 3–6 word plain-language gloss in parentheses — e.g. "UART (serial port of the board)".
- Avoid emoji unless they are part of natural technical content.
- Be specific: "2 bamboo sticks of 40cm" beats "some materials".
- When the goal is ambiguous, assume the most common scenario and proceed — do not ask the user back.

NODE TAXONOMY
- categoria: grouping container (e.g. "${t().ai.categories.recursos}", "${t().ai.categories.execucao}", "${t().ai.categories.decisoes}").
- recurso: something that must be available before execution (material, tool, data, access).
- passo: concrete action in chronological order. Use the 'order' field with an integer.
- decisao: choice between mutually exclusive paths. Fill 'decisionOptions' with 2 or 3 options.
- concept: auxiliary conceptual node. Avoid unless necessary.
Fields that do not apply are null: 'order' outside passo, 'decisionOptions' outside decisao, 'ruleConflict' when the node respects every user rule.

CONFIDENCE — use the whole 0-100 scale; it is the chance a user at this level gets the node right on the first try. 90+ only for buying/downloading something standard; 60-80 when it needs care or a new skill; below 50 when beginners usually fail here or it rests on an unverified premise (compatibility, soldering, regulations). Never default every node to 85-95.`;
}

// Critério de confirmação: UMA checagem observável com limiar.
const CRITERION_RULES = `
CONFIRMATION CRITERION (comoConfirmar) — ONE observable check with a pass threshold: what to look at or measure, and which value passes. Max 140 characters, a single condition. If you need two conditions, the node is too big — split it.
- Good: "Multimeter in continuity mode between BAT+ and BAT−: no beep."
- Good (understanding): "Re-derive the formula on paper without notes and get the same result."
- Bad: "Is everything wired correctly, powered and working?" (several conditions, no threshold)
- It tests THIS node's own item (what its oQue describes) — never a property of the parent, a sibling or the site.
- The user writes their OWN criterion before seeing yours: never restate the pass threshold (the value that passes) in oQue, porQue or groundTruthHints. Hints identify WHAT the item is; the pass bar lives only in comoConfirmar.`;

// Âncoras: sem pesquisa web, link é proibido (URL de memória não é verificável).
function groundTruthRules(research: ResearchDigest | null, scope: 'plan' | 'response'): string {
  const hasSources = !!research && research.sources.length > 0;
  const linkLine = hasSources
    ? `- kind="link": ONLY an exact URL from the WEB RESEARCH SOURCES list below — never the same URL twice in one ${scope}.`
    : `- kind="link": FORBIDDEN — no web search was run, and URLs from memory cannot be verified.`;
  return `
GROUND TRUTH (groundTruthHints) — 0 to 2 per node, strongest first, each checkable in the real world:
- kind="spec": a model / part number, or a specification with unit checkable on a datasheet — e.g. "XT60", "ESP32-WROOM-32", "Phyllostachys aurea, Ø 5-8mm".
- kind="medida": number + unit + tolerance — e.g. "40cm ± 2cm", "< 15g".
${linkLine}
- NEVER an instruction ("test without propellers" is not an anchor). If no natural anchor exists, return an empty array.`;
}

function criticSystem(): string {
  const lang = currentLocaleAIName();
  return `You are a skeptical reviewer hired to BREAK a Cellproject plan node.
Your job is to doubt. Assume the original planner was optimistic, shallow, or made unstated assumptions.

RULES
- Respond in ${lang}, dry tone, no performative empathy.
- No "great point, but". Go straight to what's fragile.
- DO NOT restate what the plan already says. Your value is finding what it does NOT say.
- 1 to 3 weaknesses, the most severe first, each under 160 characters.
- The alternative criterion MUST be different in form from the original AI criterion. If the original asks "is it ready?", yours should measure something external — a number, a proof, a third-party observation.
- If a user-written criterion exists, treat it as MORE trustworthy than the AI's: your alternative should complement it, not duplicate it.
- Do not propose solutions. Your output is a diagnosis, not a prescription.${NO_INTERNAL_NAMES}`;
}

// Texto lido pelo usuário: o modelo tende a repetir nomes de campo do prompt.
const NO_INTERNAL_NAMES = `
- NEVER mention internal field, schema or key names (oQue, porQue, comoConfirmar, groundTruthHints, kind="...", ruleConflict, etc.) in the text the user reads. Say it in plain words: "verifiable anchor", "proof of measurement", "confirmation criterion".`;

// Template do tutor com cabeçalhos no idioma do usuário. Sem critério travado,
// a explicação NÃO sugere como verificar — o usuário escreve o dele primeiro.
function tutorGuidance(criterionLocked: boolean): string {
  const h = t().ai.tutorHeaders;
  const headers = [h.what, h.why, h.how, h.pitfalls, ...(criterionLocked ? [h.verify] : [])]
    .map((x) => `**${x}**`)
    .join(', ');
  const closing = criterionLocked
    ? `- Finish with **${h.verify}**: how to check the user's criterion in practice (what to measure, which value passes).`
    : `- Do NOT write a verification/confirmation section or propose how to confirm this node — the user writes their own criterion first.`;
  return `

YOU ARE IN TUTOR MODE
Your output is a MARKDOWN EXPLANATION, not JSON. Senior-engineer depth, explaining to someone who has never done this but is capable of learning.

STRUCTURE
- Section titles in **UPPERCASE BOLD**, exactly these, in this order: ${headers}.
- Bullet lists with dashes. Short sentences.
- When there are variants or trade-offs, list each one with the name in **bold** followed by a description.
- Give real numbers (voltages, sizes, commands). No "depends on the case".
- Call out common errors ("pitfalls") and how to diagnose.
${closing}${NO_INTERNAL_NAMES}

DO NOT include introductory filler like "of course, I will explain" — go straight to the content.`;
}

// Adendo quando a célula tem pesquisa web salva: o tutor recebe o bloco WEB
// RESEARCH no prompt e deve fundamentar números/comandos/URLs nele.
const TUTOR_RESEARCH_ADDON = `

A WEB RESEARCH block with REAL, current facts and sources is included in the user prompt — it came from an actual web search about this node. Ground your numbers, versions, prices and commands in it. When you use a fact from it, cite the source inline as a markdown link [site](url). Never cite a URL outside that block's SOURCES list.`;

const TUTOR_NO_LINKS_ADDON = `

There is no web research for this node: do not cite URLs from memory.`;

// ---------------------------------------------------------------------------
// Helpers — normalização da saída do modelo
// ---------------------------------------------------------------------------

const MAX_HINTS_PER_NODE = 2;

// Política de âncoras de UM plano/resposta: links só da pesquisa e sem
// repetir URL.
interface AnchorPolicy {
  allowedUrls: Set<string> | null; // null = sem pesquisa → link proibido
  seenUrls: Set<string>;
}

function normalizeUrl(raw: string): string | null {
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    u.hash = '';
    return u.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

function anchorPolicy(research: ResearchDigest | null | undefined): AnchorPolicy {
  const sources = research?.sources ?? [];
  const allowed = sources.map((s) => normalizeUrl(s.url)).filter((u): u is string => !!u);
  return { allowedUrls: allowed.length > 0 ? new Set(allowed) : null, seenUrls: new Set() };
}

function sanitizeHints(
  raw: RawSuggestedNode['groundTruthHints'] | null | undefined,
  policy: AnchorPolicy,
): AISuggestedGroundTruthHint[] | undefined {
  if (!raw) return undefined;
  const out: AISuggestedGroundTruthHint[] = [];
  const seenValues = new Set<string>();
  for (const h of raw) {
    if (out.length >= MAX_HINTS_PER_NODE) break;
    const label = h.label?.trim() ?? '';
    let value = h.value?.trim() ?? '';
    if (!value) continue;
    if (h.kind === 'link') {
      const url = normalizeUrl(value);
      if (!url || !policy.allowedUrls || !policy.allowedUrls.has(url) || policy.seenUrls.has(url)) continue;
      policy.seenUrls.add(url);
      value = url;
    }
    const key = `${h.kind}:${value.toLowerCase()}`;
    if (seenValues.has(key)) continue;
    seenValues.add(key);
    out.push({ kind: h.kind, label: label || value, value });
  }
  return out.length > 0 ? out : undefined;
}

function materializeNode(
  raw: RawSuggestedNode,
  idMap: Map<string, string>,
  policy: AnchorPolicy,
): AISuggestedNodeOut {
  const realTempId = idMap.get(raw.tempId) ?? nanoid(6);
  idMap.set(raw.tempId, realTempId);
  const ruleConflict = raw.ruleConflict?.trim() || undefined;
  const options = raw.decisionOptions ?? null;
  const decisionOptions: DecisionOption[] | undefined =
    options && options.length > 0
      ? options.map((o) => ({
          id: nanoid(6),
          label: o.label,
          pitch: o.pitch,
          consequences: o.consequences ?? undefined,
        }))
      : undefined;
  return {
    tempId: realTempId,
    kind: raw.kind,
    name: raw.name,
    fx: raw.fx,
    // problem/pros/cons saíram do schema (nunca renderizados); o conflito
    // com regra é espelhado em cons para continuar persistido pelo store.
    problem: '',
    confidence: clamp(Math.round(Number.isFinite(raw.confidence) ? raw.confidence : 50), 0, 100),
    confidenceReason: raw.confidenceReason,
    pros: [],
    cons: ruleConflict ? [ruleConflict] : [],
    ruleConflict,
    oQue: raw.oQue,
    porQue: raw.porQue,
    comoConfirmar: raw.comoConfirmar,
    order: raw.order == null ? undefined : Math.round(raw.order),
    decisionOptions,
    groundTruthHints: sanitizeHints(raw.groundTruthHints, policy),
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
    note: raw.note ?? undefined,
  };
}

function materializeSuggestions(
  object: { nodes: RawSuggestedNode[]; edges: RawSuggestedEdge[] },
  research: ResearchDigest | null,
): AISuggestionsResult {
  const idMap = new Map<string, string>();
  const policy = anchorPolicy(research);
  const nodes = object.nodes.map((n) => materializeNode(n, idMap, policy));
  const edges = object.edges
    .map((e) => materializeEdge(e, idMap))
    .filter((e): e is AISuggestedEdge => e !== null);
  return { nodes, edges };
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

// Pesquisa web opcional antes de um fluxo estruturado. Falha de pesquisa nunca
// derruba a geração — degrada para o fluxo sem pesquisa. Abort propaga.
async function maybeResearch(
  topic: string,
  focus: string | undefined,
  signal?: AbortSignal,
): Promise<ResearchDigest | null> {
  if (!isWebResearchOn()) return null;
  try {
    return await raceAbort(runResearch(topic, focus, { signal }), signal);
  } catch (err) {
    if (signal?.aborted) throw err;
    console.warn('[cellproject] web research failed — continuing without it', err);
    return null;
  }
}

function formatBreadcrumb(crumbs: string[]) {
  return crumbs.length > 0 ? crumbs.join(' › ') : '(root)';
}

function formatSiblings(siblings: { name: string; fx: string }[]) {
  if (siblings.length === 0) return '(no siblings)';
  return siblings.map((s) => `- ${s.name} — ${s.fx}`).join('\n');
}

// User rules are the project's CHALLENGE: hard boundaries every output must
// win inside. Injected into every planning/critique/explain prompt so no part
// of the scope can quietly drift outside them.
// `prose`: prompts cuja saída é texto lido pelo usuário (explicar, cético) —
// nada de nomes de campo, senão o modelo os repete na resposta.
function formatRules(rules?: string[], mode: 'structured' | 'prose' = 'structured'): string {
  if (!rules || rules.length === 0) return '';
  const list = rules.map((r) => `- ${r}`).join('\n');
  return `

USER RULES — HARD CONSTRAINTS (the user set these as the challenge)
${list}
These are non-negotiable boundaries, not preferences. Treat them as a design challenge: the best solution is the one that WINS INSIDE them.
- EVERY node you propose must comply with EVERY rule. Make compliance concrete and verifiable (real numbers, prices, sources, dates) — never optimistic hand-waving.
- Quantitative rules (budget, weight, deadline, size): allocate explicitly across resources/steps — ${
    mode === 'prose'
      ? 'state the estimated cost/measure with its unit, as a measurement the user can check in the real world,'
      : `state the estimated cost/measure in each node's oQue and add a groundTruthHint (kind="medida") so the user can check it in the real world`
  } — and keep the running TOTAL inside the rule with safety margin.
- If part of the goal cannot fit a rule, do NOT silently violate it: put the conflict in that node's 'ruleConflict' (one concrete sentence with the number) and propose the closest compliant alternative.`;
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
// Planejamento — infraestrutura comum a generatePlans / outlinePlans /
// expandPlan: pesquisa + KB, eventos de progresso, "pensando", cancelamento,
// timeout e erros do stream.
// ---------------------------------------------------------------------------

// Compact summary of plans already shown — sent back to the model when the
// user asks for MORE plans, so new ones explore genuinely different angles.
export interface ExistingPlanSummary {
  title: string;
  strategy: ConstructionStrategy;
  approach: string;
  rank: number;
}

export interface GeneratePlansOptions extends AICallOptions {
  // Teto da geração inteira (pesquisa + planos). Padrão: 240s.
  timeoutMs?: number;
}

// Sem nenhum pedaço do JSON após este tempo, a UI passa a mostrar "pensando".
const THINKING_AFTER_MS = 1_200;

interface PlanningRun<TPartial> {
  startedAt: number;
  signal?: AbortSignal;
  research: ResearchDigest | null;
  chunkCount: number;
  lastPartial?: TPartial;
  emit: (phase: PlanProgressPhase, extra?: Partial<PlanProgressEvent<TPartial>>) => void;
}

function createRun<TPartial>(
  onProgress: ((ev: PlanProgressEvent<TPartial>) => void) | undefined,
  opts: GeneratePlansOptions | undefined,
  defaultTimeoutMs: number,
  // Campos derivados do parcial (ex.: nós prontos na expansão).
  decorate?: (partial: TPartial | undefined) => Partial<PlanProgressEvent<TPartial>>,
): PlanningRun<TPartial> {
  const startedAt = Date.now();
  const run: PlanningRun<TPartial> = {
    startedAt,
    signal: anySignal([opts?.signal, timeoutSignal(opts?.timeoutMs ?? defaultTimeoutMs)]),
    research: null,
    chunkCount: 0,
    lastPartial: undefined,
    emit: (phase, extra) =>
      onProgress?.({
        phase,
        partial: run.lastPartial,
        chunkCount: run.chunkCount,
        elapsedMs: Date.now() - startedAt,
        startedAt,
        research: run.research ?? undefined,
        ...decorate?.(run.lastPartial),
        ...extra,
      }),
  };
  return run;
}

// Pesquisa real ANTES de planejar (em paralelo com a seleção da base): fatos
// atuais (preços, specs, docs) entram no prompt e as URLs reais viram as
// únicas âncoras kind="link" permitidas. `preset` = digest já obtido numa fase
// anterior (esboços → expansão): reaproveita sem nova busca.
async function resolvePlanningContext<T>(
  run: PlanningRun<T>,
  objective: string,
  rules: string[] | undefined,
  kbContext: KBContextEntry[] | Promise<KBContextEntry[] | undefined> | undefined,
  preset?: ResearchDigest | null,
): Promise<KBContextEntry[] | undefined> {
  if (preset !== undefined || !isWebResearchOn()) {
    run.research = preset ?? null;
    return raceAbort(Promise.resolve(kbContext), run.signal);
  }
  run.emit('researching');
  const [kb, digest] = await Promise.all([
    raceAbort(Promise.resolve(kbContext), run.signal),
    maybeResearch(
      objective,
      rules && rules.length > 0
        ? `Verify feasibility against these hard constraints: ${rules.join(' · ')}`
        : undefined,
      run.signal,
    ),
  ]);
  run.research = digest;
  return kb;
}

// Stream estruturado com eventos de progresso. Erros do stream NÃO aparecem
// no partialObjectStream (ele só termina) e `result.object` PENDURA para
// sempre em cima de erro de API — sem o onError a UI congelava em
// "validando". Capturamos e lançamos nós mesmos.
async function streamPlanning<T, TPartial>(
  run: PlanningRun<TPartial>,
  args: {
    schema: z.ZodType<T>;
    schemaName: string;
    prompt: string;
    kind: AICallKind;
    temperature: number;
    effort?: Effort;
  },
): Promise<T> {
  run.emit('connecting');
  const thinkingTimer = setTimeout(() => {
    if (run.chunkCount === 0 && !run.signal?.aborted) run.emit('thinking');
  }, THINKING_AFTER_MS);
  try {
    let streamError: unknown = null;
    const providerOptions = args.effort ? effortProviderOptions(args.effort) : undefined;
    const result = streamObject({
      model: aiModel,
      schema: args.schema,
      schemaName: args.schemaName,
      system: baseSystem(),
      prompt: args.prompt,
      ...callOpts(args.kind, args.temperature),
      ...(providerOptions ? { providerOptions } : {}),
      abortSignal: run.signal,
      onError: (ev) => {
        streamError = ev.error;
      },
    });

    const it = result.partialObjectStream[Symbol.asyncIterator]();
    for (;;) {
      const next = await raceAbort(it.next(), run.signal);
      if (next.done) break;
      if (run.chunkCount === 0) clearTimeout(thinkingTimer);
      run.chunkCount += 1;
      run.lastPartial = next.value as TPartial;
      run.emit('streaming');
    }

    if (run.signal?.aborted) throw run.signal.reason;
    if (streamError) throw streamError;

    run.emit('finalizing');
    return (await raceAbort(result.object, run.signal)) as T;
  } finally {
    clearTimeout(thinkingTimer);
  }
}

// Falha final de um fluxo de planejamento: classifica, emite e devolve o erro.
function failRun<T>(run: PlanningRun<T>, err: unknown): AIError {
  const friendly = toAIError(err, run.signal);
  run.emit('error', { error: friendly.message, errorInfo: friendly.info });
  return friendly;
}

function isOutputError(err: unknown): boolean {
  return (
    NoObjectGeneratedError.isInstance(err) ||
    TypeValidationError.isInstance(err) ||
    JSONParseError.isInstance(err)
  );
}

function noPlansError(): AIError {
  return new AIError({ kind: 'schema', title: t().notify.noPlansReturned, hint: t().ai.errors.outputHint });
}

// ---------------------------------------------------------------------------
// generatePlans — 3 planos COMPLETOS numa chamada só (legado/compatibilidade).
// O caminho principal é outlinePlans (esboços) + expandPlan (um plano).
// ---------------------------------------------------------------------------

// `kbContext` pode chegar como Promise: a seleção de docs da base (outra
// chamada de IA) roda em paralelo com a pesquisa web.
export async function generatePlans(
  objective: string,
  onProgress?: PlanProgressCallback,
  kbContext?: KBContextEntry[] | Promise<KBContextEntry[] | undefined>,
  rules?: string[],
  existingPlans?: ExistingPlanSummary[],
  opts?: GeneratePlansOptions,
): Promise<AIPlanOut[]> {
  const run = createRun<DeepPartial<PlansResponse>>(onProgress, opts, PLANS_TIMEOUT_MS);
  try {
    assertAIReady();
    const kb = await resolvePlanningContext(run, objective, rules, kbContext);
    const finalObject = await streamPlanning(run, {
      schema: PlansResponseSchema,
      schemaName: 'PlansResponse',
      prompt: buildPlansPrompt(objective, rules, kb, existingPlans, run.research),
      kind: 'plans',
      temperature: 0.6,
    });
    const hydrated = finalObject.plans.map((p) => hydratePlan(p, run.research));
    // O schema não impõe min(3) (Gemini rejeita) — defende aqui.
    if (hydrated.length === 0) throw noPlansError();
    run.emit('done');
    return hydrated;
  } catch (err) {
    // Recuperação parcial: o JSON final não fechou (truncado, campo faltando),
    // mas os planos que chegaram completos no stream valem o que custaram.
    if (!run.signal?.aborted && isOutputError(err)) {
      const recovered = recoverItems(run.lastPartial?.plans, PlanSchema, (p) => hydratePlan(p, run.research));
      if (recovered.items.length > 0) {
        const warning = recovered.dropped > 0 ? t().ai.errors.partialPlans(recovered.dropped) : undefined;
        run.emit('done', { warning });
        return recovered.items;
      }
    }
    throw failRun(run, err);
  }
}

// Valida cada item parcial isoladamente e hidrata os que passam no schema.
// Conta como descartado só o que começou a chegar (tem título).
function recoverItems<Raw, Out>(
  items: (DeepPartial<Raw> | undefined)[] | undefined,
  schema: z.ZodType<Raw>,
  hydrate: (raw: Raw) => Out,
): { items: Out[]; dropped: number } {
  const list = items ?? [];
  const out: Out[] = [];
  for (const item of list) {
    const parsed = schema.safeParse(item);
    if (parsed.success) out.push(hydrate(parsed.data));
  }
  const started = list.filter((p) => !!(p as { title?: unknown } | undefined)?.title).length;
  return { items: out, dropped: Math.max(0, started - out.length) };
}

// --- Blocos de prompt compartilhados entre planos completos e esboços ------

function existingPlansBlock(existingPlans: ExistingPlanSummary[] | undefined): string {
  if (!existingPlans || existingPlans.length === 0) return '';
  return `

PLANS ALREADY SHOWN TO THE USER (do NOT repeat these approaches):
${existingPlans.map((p) => `- [rank ${p.rank}] "${p.title}" (${p.strategy}) — ${p.approach}`).join('\n')}

The user asked for MORE alternatives. Generate EXACTLY 3 NEW plans with angles clearly different from the above — e.g. cheapest possible, fastest to finish, most robust/professional, most unconventional/creative, most educational. Repeating a 'strategy' enum is fine when the ANGLE is new; never repeat an approach. Keep the SAME archetype as the plans above. Rank each new plan relative to ALL plans including the ones above (rank 1 = better than the current #1; otherwise continue the scale).`;
}

// Arquétipo, estratégias, ranking e campos de comparação (o cabeçalho).
function planHeaderBlock(rules: string[] | undefined, existingPlans: ExistingPlanSummary[] | undefined): string {
  const hasRules = !!rules && rules.length > 0;
  const currency = currentLocale() === 'pt-BR' ? 'BRL (R$)' : 'USD ($)';
  return `TASK
First, classify the goal's ARCHETYPE and tag EVERY plan with it (all plans share the same archetype):
- "construir" — the goal is to MAKE / BUILD / achieve something concrete.
- "entender" — the goal is to UNDERSTAND why something is true or how it works, decomposing toward first principles.

Then generate EXACTLY 3 plans with clearly DIFFERENT styles, each tagged with a 'strategy':
- For "construir": one plan per strategy — "reaproveitar" (reuse/adapt what already exists — the recommended default) · "hibrido" · "do_zero" (build from scratch). If a user rule genuinely forbids one strategy, still deliver 3 plans by varying the angle inside the allowed strategies (cheapest / fastest / most robust) and say so in the approach.
- For "entender": "reaproveitar" (lean on existing explanations — books, courses, worked derivations) · "do_zero" (derive it yourself from first principles) · "hibrido" (mix). Use the SAME enum values.
The user picks the style by choosing a plan, so each 'approach' must state clearly HOW (reuse-vs-build, or read-vs-derive).${hasRules ? `\nWhen USER RULES exist, every plan's 'approach' must state explicitly HOW it satisfies each rule (e.g. a budget rule → a rough cost breakdown that closes under the cap).` : ''}

RANKING — rank the plans for THIS goal${hasRules ? ' AND its rules' : ''}:
- 'rank': 1 = your single best recommendation, 2 = runner-up, 3 = third. No ties.
- 'rankReason': ONE concrete sentence naming the tradeoff that earned the position (cost, time, risk, robustness, learning value). No marketing speak.${existingPlansBlock(existingPlans)}

COMPARISON FIELDS — so the user can compare plans side by side:
- 'estimates.custo': realistic total cost range in ${currency} (e.g. "R$ 900–1.300"); for "entender", the cost of books/courses or "R$ 0".
- 'estimates.tempo': realistic total time to the tested result (e.g. "2 weekends", "~10 h").
- 'estimates.dificuldade': "iniciante" | "intermediario" | "avancado".
- 'rulesCheck': ${hasRules ? 'ONE entry per USER RULE, in the same order, copying the rule text. Be honest: "viola" when the plan does not fit, "risco" when it fits only at the limit or on an unverified premise.' : 'empty array (the user set no rules).'}`;
}

// Forma da árvore por arquétipo (categorias e kinds dos nós).
function treeShapeBlock(): string {
  const cat = t().ai.categories;
  return `Shape the tree by archetype (2 or 3 categories, names in the response language):
- "construir": "${cat.recursos}" (kind "recursos") · "${cat.execucao}" (kind "execucao", sequential passos with 'order' from 1) · "${cat.decisoes}" (kind "decisoes") ONLY on a real trade-off — its children include 'decisionOptions' (2 or 3).
- "entender": "${cat.fundamentos}" (kind "recursos" — concepts/prerequisites to grasp first; children kind="concept") · "${cat.derivacao}" (kind "execucao" — the ordered chain of reasoning; use kind="concept" for ideas/definitions/premises and kind="passo" with 'order' only for genuinely sequential derivation steps) · optional "${cat.abordagens}" (kind "decisoes") only on a real choice of approach.`;
}

function completenessBlock(scope: 'EVERY plan' | 'the WHOLE tree'): string {
  return `COMPLETENESS CHECK — run this on ${scope} before returning:
1. Walk the finished thing working end to end and list every subsystem it needs to FUNCTION. For "construir" with electronics that includes: structure, motors/actuators, control board, power (battery + charger), command path (transmitter/receiver or app), wiring/soldering supplies, software/firmware. For "entender": every load-bearing concept the conclusion rests on.
2. The resources category must contain ONE node per subsystem — typically 4 to 6 nodes; group small related items (screws, zip ties, heat-shrink) into one node instead of dropping them. Missing the control board, the battery or the receiver invalidates the plan.
3. The execution category must go from loose parts to a WORKING TESTED result (typically 4 to 6 passos), explicitly including the connection step (what gets soldered/plugged where), the configuration/calibration step (what gets flashed/set), and a final functional test. Never compress these into "assemble everything".`;
}

// Campos didáticos de cada nó + limites de tamanho (planos completos e expansão).
function nodeFieldsBlock(research: ResearchDigest | null, intro: string): string {
  return `For each child node fill oQue / porQue / comoConfirmar with concrete didactic content in plain words.

BREVITY — ${intro} Detail comes later, on demand (tutor mode). Hard limits:
- 4 to 6 nodes per category, never more than 6 — group related items instead of listing them one by one.
- oQue ≤ 220 characters, porQue ≤ 140, confidenceReason ≤ 80, fx ≤ 80, approach ≤ 400.
- Category oQue / porQue: one short sentence each.
- groundTruthHints only when a natural anchor exists — most nodes need 0 or 1.
${CRITERION_RULES}
${groundTruthRules(research, 'plan')}`;
}

function buildPlansPrompt(
  objective: string,
  rules: string[] | undefined,
  kb: KBContextEntry[] | undefined,
  existingPlans: ExistingPlanSummary[] | undefined,
  research: ResearchDigest | null,
): string {
  return `USER GOAL:
"""
${objective.trim()}
"""
${formatRules(rules)}
${formatKBContext(kb)}

${planHeaderBlock(rules, existingPlans)}

${treeShapeBlock()}

${completenessBlock('EVERY plan')}

${nodeFieldsBlock(research, 'the user compares 3 plans side by side and every node is a small card, not an essay.')}

Use short unique tempIds within the plan (e.g. "p1", "r1", "cat1"). Do not generate edges here.${formatResearchBlock(research)}`;
}

// Árvore de um plano: tempIds do modelo → ids locais, âncoras sob a política.
function hydrateTree(categorias: RawPlanCategory[], research: ResearchDigest | null): AIPlanCategory[] {
  const idMap = new Map<string, string>();
  // Uma política por plano: a mesma URL não se repete dentro do plano.
  const policy = anchorPolicy(research);
  return categorias.map((cat) => ({
    tempId: nanoid(6),
    name: cat.name,
    kind: cat.kind,
    oQue: cat.oQue,
    porQue: cat.porQue,
    children: cat.children.map((c) => materializeNode(c, idMap, policy)),
  }));
}

// Cabeçalho comum (plano completo e esboço) — normaliza rank e opcionais.
function hydrateHeader(raw: Omit<RawPlan, 'tree'>): Omit<AIPlanOut, 'tree' | 'id'> {
  return {
    title: raw.title,
    pitch: raw.pitch,
    approach: raw.approach,
    strategy: raw.strategy,
    archetype: raw.archetype,
    rank: clamp(Math.round(raw.rank), 1, 99),
    rankReason: raw.rankReason,
    estimates: raw.estimates
      ? {
          custo: raw.estimates.custo,
          tempo: raw.estimates.tempo,
          dificuldade: raw.estimates.dificuldade,
        }
      : undefined,
    rulesCheck: raw.rulesCheck?.map((r) => ({ rule: r.rule, status: r.status, nota: r.nota })),
  };
}

function hydratePlan(raw: RawPlan, research: ResearchDigest | null): AIPlanOut {
  return {
    id: nanoid(8),
    ...hydrateHeader(raw),
    tree: { categorias: hydrateTree(raw.tree.categorias, research) },
  };
}

// ---------------------------------------------------------------------------
// Planejamento em duas fases.
// 1. outlinePlans — os 3 planos alternativos LEVES (cabeçalho + nomes dos
//    nós). Rápido: é o que a tela de objetivo mostra nos cards.
// 2. expandPlan — a árvore completa de UM esboço (o escolhido), no mesmo
//    formato que createProjectFromPlan hidrata hoje.
// ---------------------------------------------------------------------------

export type PlanOutline = AIPlanOutline;

const OUTLINE_TIMEOUT_MS = 120_000;
const EXPAND_TIMEOUT_MS = 180_000;

export interface OutlinePlansOptions extends GeneratePlansOptions {
  // Reasoning effort só desta chamada (modelos que aceitam). Padrão: 'low' —
  // o esboço é curto e o primeiro card precisa aparecer em segundos.
  effort?: Effort | null;
}

export interface ExpandPlanOptions extends GeneratePlansOptions {
  // Digest da pesquisa já feita na fase de esboços: reaproveita sem nova
  // busca. undefined = pesquisa de novo (se o modo estiver ligado); null = sem.
  research?: ResearchDigest | null;
  // Padrão: 'low' — o esboço já fixou a estratégia e os nós; medido ao vivo,
  // 'medium' só acrescenta ~20s de raciocínio antes do primeiro nó.
  // null = effort padrão do modelo.
  effort?: Effort | null;
}

export type OutlineProgressEvent = PlanProgressEvent<DeepPartial<OutlinesResponse>>;
export type OutlineProgressCallback = (ev: OutlineProgressEvent) => void;
export type ExpandProgressEvent = PlanProgressEvent<DeepPartial<ExpandResponse>>;
export type ExpandProgressCallback = (ev: ExpandProgressEvent) => void;

const DEFAULT_OUTLINE_EFFORT: Effort = 'low';
const DEFAULT_EXPAND_EFFORT: Effort = 'low';

// undefined → padrão do fluxo; null → effort padrão do modelo.
function pickEffort(value: Effort | null | undefined, fallback: Effort): Effort | undefined {
  return value === undefined ? fallback : (value ?? undefined);
}

export async function outlinePlans(
  objective: string,
  onProgress?: OutlineProgressCallback,
  kbContext?: KBContextEntry[] | Promise<KBContextEntry[] | undefined>,
  rules?: string[],
  existingOutlines?: ExistingPlanSummary[],
  opts?: OutlinePlansOptions,
): Promise<PlanOutline[]> {
  const run = createRun<DeepPartial<OutlinesResponse>>(onProgress, opts, OUTLINE_TIMEOUT_MS);
  try {
    assertAIReady();
    const kb = await resolvePlanningContext(run, objective, rules, kbContext);
    const finalObject = await streamPlanning(run, {
      schema: OutlinesResponseSchema,
      schemaName: 'OutlinesResponse',
      prompt: buildOutlinePrompt(objective, rules, kb, existingOutlines, run.research),
      kind: 'outline',
      temperature: 0.6,
      effort: pickEffort(opts?.effort, DEFAULT_OUTLINE_EFFORT),
    });
    const outlines = finalObject.plans.map(hydrateOutline).filter(hasOutlineNodes);
    if (outlines.length === 0) throw noPlansError();
    run.emit('done');
    return outlines;
  } catch (err) {
    if (!run.signal?.aborted && isOutputError(err)) {
      const recovered = recoverItems(run.lastPartial?.plans, PlanOutlineSchema, hydrateOutline);
      const items = recovered.items.filter(hasOutlineNodes);
      if (items.length > 0) {
        const dropped = recovered.dropped + (recovered.items.length - items.length);
        const warning = dropped > 0 ? t().ai.errors.partialPlans(dropped) : undefined;
        run.emit('done', { warning });
        return items;
      }
    }
    throw failRun(run, err);
  }
}

function hydrateOutline(raw: RawPlanOutline): PlanOutline {
  return {
    id: nanoid(8),
    ...hydrateHeader(raw),
    outline: {
      categorias: raw.outline.categorias
        .map((c) => ({
          name: c.name.trim(),
          kind: c.kind,
          nodes: c.nodes
            .map((n) => ({ name: n.name.trim(), kind: n.kind }))
            .filter((n) => n.name.length > 0),
        }))
        .filter((c) => c.nodes.length > 0),
    },
  };
}

function hasOutlineNodes(o: PlanOutline): boolean {
  return o.outline.categorias.length > 0;
}

export function countOutlineNodes(o: PlanOutline): number {
  return o.outline.categorias.reduce((n, c) => n + c.nodes.length, 0);
}

function buildOutlinePrompt(
  objective: string,
  rules: string[] | undefined,
  kb: KBContextEntry[] | undefined,
  existingOutlines: ExistingPlanSummary[] | undefined,
  research: ResearchDigest | null,
): string {
  return `USER GOAL:
"""
${objective.trim()}
"""
${formatRules(rules)}
${formatKBContext(kb)}

OUTLINE MODE — the user first compares 3 plan OUTLINES side by side and picks one; only the chosen plan is expanded into full detail afterwards. So each plan here is LIGHT: the header fields plus the tree skeleton (categories → node NAMES and kinds). No node details at all. Keep it short and decide fast — but the skeleton must already be COMPLETE and correct, because the full plan will follow it.

${planHeaderBlock(rules, existingOutlines)}

${treeShapeBlock()}

${completenessBlock('EVERY plan')}

SKELETON RULES
- 4 to 6 nodes per category, never more than 6 — group related items instead of listing them one by one.
- Node names are short and specific (2–6 words): "Used 2207 motors (4x)" beats "Motors". In the execution category, list the passos in chronological order.
- Use the node kinds of the taxonomy (recurso, passo, decisao, concept). A "decisoes" category holds only decisao nodes.
- approach ≤ 400 characters; pitch and rankReason one sentence each.${formatResearchBlock(research)}`;
}

// --- expandPlan -------------------------------------------------------------

export async function expandPlan(
  objective: string,
  outline: PlanOutline,
  onProgress?: ExpandProgressCallback,
  kbContext?: KBContextEntry[] | Promise<KBContextEntry[] | undefined>,
  rules?: string[],
  opts?: ExpandPlanOptions,
): Promise<AIPlanOut> {
  const total = countOutlineNodes(outline);
  const run = createRun<DeepPartial<ExpandResponse>>(onProgress, opts, EXPAND_TIMEOUT_MS, (partial) => ({
    nodesReady: countReadyNodes(partial),
    nodesTotal: total,
  }));
  try {
    assertAIReady();
    const kb = await resolvePlanningContext(run, objective, rules, kbContext, opts?.research);
    const finalObject = await streamPlanning(run, {
      schema: ExpandResponseSchema,
      schemaName: 'ExpandResponse',
      prompt: buildExpandPrompt(objective, outline, rules, kb, run.research),
      kind: 'expand',
      temperature: 0.5,
      effort: pickEffort(opts?.effort, DEFAULT_EXPAND_EFFORT),
    });
    const categorias = hydrateTree(finalObject.categorias, run.research).filter((c) => c.children.length > 0);
    if (categorias.length === 0) throw noPlansError();
    run.emit('done');
    return expandedPlan(outline, categorias);
  } catch (err) {
    // Recuperação parcial: com pelo menos metade dos nós do esboço completos,
    // a árvore ainda serve — o resto o usuário decompõe depois.
    if (!run.signal?.aborted && isOutputError(err)) {
      const recovered = recoverTree(run.lastPartial, run.research);
      if (recovered && recovered.ready * 2 >= Math.max(1, total)) {
        // Faltantes contra o esboço: o nó cortado pode nem ter começado.
        const dropped = Math.max(recovered.dropped, total - recovered.ready);
        const warning = dropped > 0 ? t().ai.twoPhase.partialExpand(dropped) : undefined;
        run.emit('done', { warning });
        return expandedPlan(outline, recovered.categorias);
      }
    }
    throw failRun(run, err);
  }
}

// O plano expandido mantém o id do esboço — é a chave do cache na UI/store.
function expandedPlan(outline: PlanOutline, categorias: AIPlanCategory[]): AIPlanOut {
  const { outline: _skeleton, ...header } = outline;
  return { ...header, tree: { categorias } };
}

// Nós completos (passam no schema) no parcial — progresso da árvore montando.
function countReadyNodes(partial: DeepPartial<ExpandResponse> | undefined): number {
  let n = 0;
  for (const cat of partial?.categorias ?? []) {
    for (const child of cat?.children ?? []) {
      if (SuggestedNodeSchema.safeParse(child).success) n += 1;
    }
  }
  return n;
}

function recoverTree(
  partial: DeepPartial<ExpandResponse> | undefined,
  research: ResearchDigest | null,
): { categorias: AIPlanCategory[]; ready: number; dropped: number } | null {
  let ready = 0;
  let started = 0;
  const raw: RawPlanCategory[] = [];
  for (const cat of partial?.categorias ?? []) {
    if (!cat?.name || !cat.kind) continue;
    const children: RawSuggestedNode[] = [];
    for (const child of cat.children ?? []) {
      if (!child?.name) continue;
      started += 1;
      const parsed = SuggestedNodeSchema.safeParse(child);
      if (parsed.success) children.push(parsed.data);
    }
    if (children.length === 0) continue;
    ready += children.length;
    raw.push({
      tempId: cat.tempId ?? nanoid(4),
      name: cat.name,
      kind: cat.kind,
      oQue: cat.oQue ?? '',
      porQue: cat.porQue ?? '',
      children,
    });
  }
  if (raw.length === 0) return null;
  return { categorias: hydrateTree(raw, research), ready, dropped: Math.max(0, started - ready) };
}

function formatOutlineForPrompt(outline: PlanOutline): string {
  const lines: string[] = [];
  outline.outline.categorias.forEach((c) => {
    lines.push(`- [${c.kind}] ${c.name}`);
    c.nodes.forEach((n, i) => lines.push(`  ${i + 1}. (${n.kind}) ${n.name}`));
  });
  return lines.join('\n');
}

function buildExpandPrompt(
  objective: string,
  outline: PlanOutline,
  rules: string[] | undefined,
  kb: KBContextEntry[] | undefined,
  research: ResearchDigest | null,
): string {
  const est = outline.estimates;
  const estimates = est ? `\n- Estimates: cost ${est.custo} · time ${est.tempo} · difficulty ${est.dificuldade}` : '';
  const checks = (outline.rulesCheck ?? []).length
    ? `\n- Rules check: ${outline.rulesCheck!.map((r) => `"${r.rule}" → ${r.status} (${r.nota})`).join(' · ')}`
    : '';
  return `USER GOAL:
"""
${objective.trim()}
"""
${formatRules(rules)}
${formatKBContext(kb)}${archetypeDirective(outline.archetype)}${strategyDirective(outline.strategy)}

THE PLAN THE USER CHOSE
- Title: ${outline.title}
- Strategy: ${outline.strategy} · Archetype: ${outline.archetype}
- Pitch: ${outline.pitch}
- Approach: ${outline.approach}${estimates}${checks}

ITS SKELETON (categories → nodes, in order)
${formatOutlineForPrompt(outline)}

TASK
Expand THIS plan into its full tree. Follow the skeleton:
- Same categories (same kind, same order, same names) and the same nodes in the same order — one node per skeleton line, same kind.
- You may sharpen a node name to make it more specific; never change what it is.
- Add a node only if the completeness check below finds a missing subsystem or step; drop or merge one only if it is a duplicate. Stay within 6 nodes per category.
- Prices, quantities and specs must stay consistent with the approach and estimates above. State each part's own price plainly inside its oQue (e.g. "~R$ 350"); never accounting talk ("allocate R$ X of the R$ Y", "budget split").

${treeShapeBlock()}

${completenessBlock('the WHOLE tree')}

${nodeFieldsBlock(research, 'every node is a small card, not an essay.')}

Use short unique tempIds within the plan (e.g. "p1", "r1", "cat1"). Do not generate edges here.${formatResearchBlock(research)}`;
}

// ---------------------------------------------------------------------------
// decomposeNode — break an existing node into children + edges
// ---------------------------------------------------------------------------

const MAX_KNOWN_ELSEWHERE = 15;

// Bloco com o conteúdo do nó + o que o usuário já domina. O critério do
// usuário (quando travado) manda sobre o da IA.
function nodeContentBlock(ctx: DecomposeContext): string {
  const criterion = ctx.comoConfirmarUsuario?.trim() || ctx.comoConfirmar?.trim();
  const lines = [
    ctx.oQue?.trim() ? `- What it is: ${ctx.oQue.trim()}` : '',
    ctx.porQue?.trim() ? `- Why it matters: ${ctx.porQue.trim()}` : '',
    criterion
      ? `- Done when${ctx.comoConfirmarUsuario?.trim() ? " (the user's own criterion)" : ''}: ${criterion} — together, the children's checks must imply this.`
      : '',
  ].filter(Boolean);
  const content = lines.length
    ? `\n\nNODE CONTENT (children cover exactly this — no more, no less)\n${lines.join('\n')}`
    : '';
  const known = (ctx.knownElsewhere ?? [])
    .map((k) => k.trim())
    .filter(Boolean)
    .slice(0, MAX_KNOWN_ELSEWHERE);
  const knownBlock = known.length
    ? `\n\nUSER ALREADY KNOWS / HAS DONE (never re-teach these; reference them as given)\n${known.map((k) => `- ${k}`).join('\n')}`
    : '';
  return content + knownBlock;
}

// Decompose não dispara busca própria (é o caminho quente do fluxo), mas se a
// célula já tem pesquisa salva o digest entra como contexto — de graça.
export async function decomposeNode(
  ctx: DecomposeContext,
  kbContext?: KBContextEntry[],
  opts?: AICallOptions,
): Promise<AISuggestionsResult> {
  const signal = opts?.signal;
  try {
    assertAIReady();
    const research = ctx.research ?? null;
    const guidance = decomposeGuidance(ctx.nodeKind, ctx.nodeName, ctx.strategy, ctx.archetype, ctx.categoryKind);

    const userPrompt = `PROJECT CONTEXT
- Name: ${ctx.projectName}
- Goal: ${ctx.projectObjective}
- Path to the node: ${formatBreadcrumb(ctx.breadcrumb)}${archetypeDirective(ctx.archetype)}${strategyDirective(ctx.strategy)}${formatRules(ctx.rules)}

NODE TO DECOMPOSE
- Name: ${ctx.nodeName}
- Kind: ${ctx.nodeKind}
- Function (fx): ${ctx.nodeFx}${nodeContentBlock(ctx)}

EXISTING SIBLINGS (do not repeat)
${formatSiblings(ctx.siblings)}
${formatKBContext(kbContext)}
TASK
${guidance}
- Every child is a real part to obtain or a real action to do. Never a bookkeeping child (budget split, cost allocation, "N slots/positions", cost summary) — put each price inside the oQue of the real part it belongs to, and keep prices consistent with the node content above.
${CRITERION_RULES}
${groundTruthRules(research, 'response')}

Use short unique tempIds (e.g. "a", "b", "c"). If there is order or dependency between the new nodes, create 'direct' edges between them.${formatResearchBlock(research)}`;

    const { object } = await raceAbort(
      generateObject({
        model: aiModel,
        schema: DecomposeResponseSchema,
        schemaName: 'DecomposeResponse',
        system: baseSystem(),
        prompt: userPrompt,
        ...callOpts('decompose', 0.5),
        abortSignal: signal,
      }),
      signal,
    );

    return materializeSuggestions(object, research);
  } catch (err) {
    throw toAIError(err, signal);
  }
}

// Per-project construction strategy chosen by the user at plan selection.
// It conditions how every later decomposition / replan is framed.
function strategyDirective(strategy?: ConstructionStrategy): string {
  switch (strategy) {
    case 'reaproveitar':
      return `\nCONSTRUCTION STRATEGY (chosen by the user): REUSE / ADAPT. Reach this by reusing, repurposing and recombining what already exists — off-the-shelf parts, second-hand/salvaged components, donor systems, existing tools, services, templates, channels. Name the concrete existing thing to adapt before any from-scratch work.`;
    case 'hibrido':
      return `\nCONSTRUCTION STRATEGY (chosen by the user): HYBRID. Reuse/adapt the expensive or complex parts; build by hand only the simple or cheap ones. For each child, make the reuse-vs-build choice explicit.`;
    case 'do_zero':
      return `\nCONSTRUCTION STRATEGY (chosen by the user): FROM SCRATCH. The user EXPLICITLY chose to build/forge each part themselves — do NOT push reuse. Focus on fabrication/build steps, the skills, tools and quality checks involved, and learning.`;
    default:
      return '';
  }
}

// Whether this project is a build ('construir') or an understanding ('entender')
// project — conditions decomposition vocabulary.
function archetypeDirective(archetype?: ProjectArchetype): string {
  if (archetype === 'entender') {
    return `\nARCHETYPE: UNDERSTAND. The goal is to understand WHY/HOW by decomposing toward first principles. Break this node into the sub-CONCEPTS, definitions, premises and (only when truly sequential) derivation steps one must grasp to understand it — ask "what must one understand BEFORE this?". Prefer kind="concept" for ideas/definitions/premises; use kind="passo" only for ordered derivation steps. If a child is a foundational primitive/axiom (taken as given, not derived), make that explicit in its name so the user can mark it as a floor. comoConfirmar = a self-test with a pass bar ("re-derive it on paper without notes"), never "did you build it".`;
  }
  return '';
}

// Kind da categoria: o persistido manda; regex no nome é só fallback pra
// projetos antigos que não guardam o kind.
function inferCategoryKind(name: string): AIPlanCategory['kind'] | undefined {
  if (/execu|fluxo|passo|step|flow|deriva/i.test(name)) return 'execucao';
  if (/recurs|material|ferrament|tool|resource|fundament|foundation/i.test(name)) return 'recursos';
  if (/decis|decision|abordag|approach/i.test(name)) return 'decisoes';
  return undefined;
}

function decomposeGuidance(
  kind: NodeKind,
  name: string,
  strategy?: ConstructionStrategy,
  archetype?: ProjectArchetype,
  categoryKind?: AIPlanCategory['kind'],
): string {
  if (archetype === 'entender') {
    if (kind === 'categoria') {
      return `Generate 3 to 6 children that build understanding of this area: sub-concepts, definitions or premises (kind="concept"), and ordered derivation steps (kind="passo") only when the reasoning is genuinely sequential. Do not repeat the siblings.`;
    }
    return `Break "${name}" down toward first principles: 2 to 5 sub-concepts, definitions or premises (kind="concept") — and ordered derivation steps (kind="passo") only when sequential — that one must understand to understand it. Ask "what comes BEFORE this?". If a child is a foundational primitive/axiom taken as given, name it as such. Chain derivation steps with 'direct' edges.`;
  }
  const fromScratch = strategy === 'do_zero';
  if (kind === 'categoria') {
    const catKind = categoryKind ?? inferCategoryKind(name);
    if (catKind === 'execucao') {
      return `This is an Execution category. Generate 3 to 6 sequential steps (kind="passo") with increasing 'order'. Connect them with 'direct' edges from step N to step N+1.`;
    }
    if (catKind === 'recursos') {
      return `This is a Resources category. Generate 3 to 6 concrete, specific resources (kind="recurso"). Edges are not required.`;
    }
    if (catKind === 'decisoes') {
      return `This is a Decisions category. Generate 1 to 3 real trade-offs (kind="decisao"), each with 2 or 3 'decisionOptions'.`;
    }
    return `Generate 3 to 6 children appropriate for this category. Do not repeat the siblings.`;
  }
  if (kind === 'passo') {
    const reuseLine = fromScratch
      ? ''
      : ` When a sub-step could be handled by an existing tool, service, kit, or template instead of done by hand from scratch, prefer that.`;
    return `Break this step into 2 to 5 smaller and more concrete sub-steps (kind="passo") with sequential 'order'. Each sub-step must be a single physical/logical action, easy to verify.${reuseLine} Chain them with 'direct' edges.`;
  }
  if (kind === 'recurso') {
    return fromScratch
      ? `Break this resource into 2 to 4 sub-resources or build stages (kind="recurso") for MAKING it yourself: raw materials, the spec/dimensions to hit, the fabrication/build step, and how to check quality. The user chose to build from scratch — don't suggest reusing a ready-made one.`
      : `Break this resource into 2 to 4 sub-resources or acquisition stages (kind="recurso"), REUSE-FIRST: prefer reusing/adapting something that already exists before building it. Good sub-resources: "existing item to repurpose or adapt", "donor system to cannibalize for the part", "off-the-shelf / second-hand source", "minimum spec to match", and only as a last resort "build from scratch".`;
  }
  if (kind === 'decisao') {
    return `Generate 2 to 4 concept/step nodes that detail what happens AFTER the decision — considerations, trade-offs, or prerequisites of each path.`;
  }
  return `Generate 2 to 5 children that elaborate this node. Use the most adequate kind (passo, recurso, decisao).`;
}

// ---------------------------------------------------------------------------
// explainNode — generates a long markdown explanation for tutor mode
// ---------------------------------------------------------------------------

export interface ExplainOptions extends AICallOptions {
  // Texto acumulado até agora — pra UI renderizar o markdown progressivamente.
  onDelta?: (textSoFar: string) => void;
}

export async function explainNode(ctx: ExplainContext, opts?: ExplainOptions): Promise<string> {
  const signal = opts?.signal;
  try {
    assertAIReady();

    const research = ctx.research ?? null;
    const locked = ctx.criterionLocked ?? false;
    const systemTutor = `${baseSystem()}${tutorGuidance(locked)}${research ? TUTOR_RESEARCH_ADDON : TUTOR_NO_LINKS_ADDON}`;

    // Sem lock, o critério da IA fica FORA do prompt — senão ele vaza na
    // explicação antes de o usuário escrever o dele.
    const criterion = locked
      ? ctx.comoConfirmarUsuario?.trim() || ctx.comoConfirmar
      : '';
    const criterionLine = criterion ? `\n- The user's confirmation criterion: ${criterion}` : '';

    const userPrompt = `PROJECT
- Name: ${ctx.projectName}
- Goal: ${ctx.projectObjective}
- Path to the node: ${formatBreadcrumb(ctx.breadcrumb)}${formatRules(ctx.rules, 'prose')}

NODE
- Name: ${ctx.nodeName}
- Kind: ${ctx.nodeKind}
- What it is (short summary): ${ctx.oQue}
- Why it matters: ${ctx.porQue}${criterionLine}${formatRelatedParts(ctx.relatedParts)}

Generate the full markdown explanation following the structure above. Focus on letting the user execute this node alone.${ctx.rules && ctx.rules.length > 0 ? ' Every instruction, material and number you give must stay inside the USER RULES above — call out explicitly when a rule shapes a choice.' : ''}${formatResearchBlock(research)}`;

    let streamError: unknown = null;
    const result = streamText({
      model: aiModel,
      system: systemTutor,
      prompt: userPrompt,
      ...callOpts('explain', 0.4),
      abortSignal: signal,
      onError: (ev) => {
        streamError = ev.error;
      },
    });

    let text = '';
    const it = result.textStream[Symbol.asyncIterator]();
    for (;;) {
      const next = await raceAbort(it.next(), signal);
      if (next.done) break;
      text += next.value;
      opts?.onDelta?.(scrubInternalNames(text));
    }
    if (signal?.aborted) throw signal.reason;
    if (streamError) throw streamError;

    const final = scrubInternalNames(text).trim();
    if (!final) {
      const e = t().ai.errors;
      throw new AIError({ kind: 'schema', title: e.outputTitle, hint: e.outputHint });
    }
    // Quando a célula tem pesquisa, fecha com a seção de referências reais.
    return research ? appendReferences(final, research.sources) : final;
  } catch (err) {
    throw toAIError(err, signal);
  }
}

// Rede de segurança: nome de campo que ainda vaze vira termo do usuário.
export function scrubInternalNames(text: string): string {
  return text
    .replace(/\s*\(?\bkind\s*=\s*"[\w-]+"\)?/g, '')
    .replace(/\bgroundTruthHints?\b/g, t().ai.anchorWord);
}

// Partes vizinhas no plano: os números delas são a fonte da verdade.
function formatRelatedParts(parts: ExplainContext['relatedParts']): string {
  const list = (parts ?? []).filter((p) => p.oQue.trim()).slice(0, 10);
  if (list.length === 0) return '';
  return `

RELATED PARTS ALREADY IN THE PLAN (reuse their prices, quantities and specs EXACTLY — never contradict them, and never state a "remaining budget" unless you sum every part of the project)
${list.map((p) => `- [${p.relation}] ${p.name}: ${p.oQue.trim()}`).join('\n')}`;
}

// Seção de referências montada por código a partir de result.sources — URLs
// garantidamente reais (vieram da busca), não da memória do modelo.
function appendReferences(text: string, sources: ResearchSource[]): string {
  if (sources.length === 0) return text;
  const header = t().tutor.referencesHeader;
  const lines = sources.map((s) => `- [${s.title}](${s.url})`).join('\n');
  return `${text}\n\n**${header}**\n${lines}`;
}

// ---------------------------------------------------------------------------
// critiqueNode — adversarial second pass (attack b).
// Uses a distinct persona from BASE_SYSTEM so the alternative criterion is
// truly independent — that's what actually breaks the closed AI→AI loop.
// ---------------------------------------------------------------------------

export async function critiqueNode(
  ctx: CritiqueContext,
  opts?: AICallOptions,
): Promise<AdversarialCritique> {
  const signal = opts?.signal;
  try {
    assertAIReady();

    // Cético com evidência real: se o usuário pesquisou esta célula, o digest
    // entra como evidência — o ataque deixa de ser "IA desconfia da IA" e
    // passa a citar o mundo.
    const research = ctx.research ?? null;

    const userPrompt = `PROJECT
- Name: ${ctx.projectName}
- Goal: ${ctx.projectObjective}
- Path: ${formatBreadcrumb(ctx.breadcrumb)}${formatRules(ctx.rules, 'prose')}

NODE TO CRITIQUE
- Name: ${ctx.nodeName}
- Kind: ${ctx.nodeKind}
- Function: ${ctx.nodeFx}
- What it is: ${ctx.oQue}
- Why it matters: ${ctx.porQue}
- AI criterion: ${ctx.comoConfirmar.trim() || '(hidden — the user has not locked theirs yet)'}
${ctx.comoConfirmarUsuario ? `- User-written criterion: ${ctx.comoConfirmarUsuario}` : '- The user has not written a criterion yet.'}

TASK
Point out weaknesses, hidden assumptions, and propose an INDEPENDENT alternative criterion that a skeptic would use.${ctx.rules && ctx.rules.length > 0 ? ' Attack RULE COMPLIANCE first: where would this node blow the user rules in practice (real prices, real weights, real deadlines)? An optimistic estimate that busts a rule is a weakness.' : ''}${research ? " Weigh the WEB RESEARCH facts above the planner's optimism — when reality contradicts the node, that contradiction IS the weakness." : ''}${formatResearchBlock(research)}`;

    const { object } = await raceAbort(
      generateObject({
        model: aiModel,
        schema: CritiqueResponseSchema,
        schemaName: 'CritiqueResponse',
        system: criticSystem(),
        prompt: userPrompt,
        ...callOpts('critique', 0.7),
        abortSignal: signal,
      }),
      signal,
    );

    return {
      fraquezas: object.fraquezas.map(scrubInternalNames),
      premissasOcultas: object.premissasOcultas.map(scrubInternalNames),
      criterioAlternativo: scrubInternalNames(object.criterioAlternativo),
      fontes: research && research.sources.length > 0 ? research.sources : undefined,
      generatedAt: Date.now(),
    };
  } catch (err) {
    throw toAIError(err, signal);
  }
}

// ---------------------------------------------------------------------------
// replanFromFailure — replan using real failure context (attack c).
// Same node shape as decomposeNode so the output flows through the same
// staging mechanism, plus a one-sentence diagnosis.
// ---------------------------------------------------------------------------

function previousDecompositionBlock(ctx: ReplanContext): string {
  const children = ctx.currentChildren ?? [];
  const anchors = (ctx.failedAnchors ?? []).filter((a) => a.trim());
  const parts: string[] = [];
  if (children.length > 0) {
    parts.push(
      `PREVIOUS DECOMPOSITION (failed — do not reuse these)\n${children
        .map((c) => `- ${c.name} [${c.state}] — ${c.oQue}`)
        .join('\n')}`,
    );
  }
  if (ctx.comoConfirmar?.trim()) {
    parts.push(`ORIGINAL CONFIRMATION CRITERION (was not met)\n- ${ctx.comoConfirmar.trim()}`);
  }
  if (anchors.length > 0) {
    parts.push(
      `ANCHORS THAT PROVED FALSE OR UNVERIFIED (do not cite again)\n${anchors.map((a) => `- ${a}`).join('\n')}`,
    );
  }
  return parts.length ? `\n\n${parts.join('\n\n')}` : '';
}

export async function replanFromFailure(
  ctx: ReplanContext,
  kbContext?: KBContextEntry[],
  opts?: AICallOptions,
): Promise<AISuggestionsResult & { diagnosis?: string }> {
  const signal = opts?.signal;
  try {
    assertAIReady();

    // O usuário acabou de queimar tempo numa premissa furada — se a célula
    // tem pesquisa salva, o replan parte de alternativas que EXISTEM.
    const research = ctx.research ?? null;

    const userPrompt = `PROJECT CONTEXT
- Name: ${ctx.projectName}
- Goal: ${ctx.projectObjective}
- Path to the node: ${formatBreadcrumb(ctx.breadcrumb)}${archetypeDirective(ctx.archetype)}${strategyDirective(ctx.strategy)}${formatRules(ctx.rules)}

NODE THAT FAILED IN PRACTICE
- Name: ${ctx.nodeName}
- Kind: ${ctx.nodeKind}
- Original function: ${ctx.nodeFx}
- What it was: ${ctx.oQue}

WHAT WENT WRONG (reported by the user)
"""
${ctx.failureContext.trim()}
"""${previousDecompositionBlock(ctx)}

SIBLINGS (context)
${formatSiblings(ctx.siblings)}
${formatKBContext(kbContext)}
TASK
Real execution showed that the original plan didn't work. Re-decompose this node KNOWING what failed. Rules:
1. 'diagnosis': ONE sentence naming which premise of the previous path was wrong, given the failure.
2. DO NOT repeat the previous decomposition. If the original path failed, assume part of the premise was wrong.
3. If the failure was a resource (broken, missing, out of spec), suggest concrete alternatives and/or a new mitigation step.
4. If the failure was a step, break it into smaller steps covering where it got stuck.
5. Prefer 2–4 new, highly specific nodes. 'direct' edges in a chain when there is order.
6. Give each new node a verifiable anchor when one exists — the user just burned time on something the AI claimed without an anchor.
${CRITERION_RULES}
${groundTruthRules(research, 'response')}

Use short unique tempIds (e.g. "a", "b", "c").${formatResearchBlock(research)}`;

    const { object } = await raceAbort(
      generateObject({
        model: aiModel,
        schema: ReplanResponseSchema,
        schemaName: 'ReplanResponse',
        system: baseSystem(),
        prompt: userPrompt,
        ...callOpts('replan', 0.4),
        abortSignal: signal,
      }),
      signal,
    );

    return {
      ...materializeSuggestions(object, research),
      diagnosis: object.diagnosis?.trim() || undefined,
    };
  } catch (err) {
    throw toAIError(err, signal);
  }
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
