import { generateText, type LanguageModel, type ToolSet } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { getActiveConfig, useConfigStore } from '@/config/store';
import { currentLocaleAIName } from '@/i18n';
import type { WebResearchDigest, WebSourceRef } from '@/types';

// ---------------------------------------------------------------------------
// Pesquisa real na web — a IA busca fontes de verdade (documentação, preços,
// specs, tutoriais) antes de planejar/explicar/criticar, em vez de responder
// só de memória. Cada provider tem seu mecanismo nativo:
//   - OpenRouter: plugin `web` (engine Exa) — funciona com qualquer modelo e
//     devolve URLs diretas; o provider mapeia url_citation → sources.
//   - Anthropic: server tool web_search (executa do lado da Anthropic).
//   - OpenAI: tool web_search da Responses API.
// O resultado é um ResearchDigest: texto fundamentado + lista de fontes REAIS,
// que vira bloco de contexto nos prompts estruturados e âncoras kind="link".
// ---------------------------------------------------------------------------

// Formas canônicas vivem em types.ts (o digest é persistido no nó).
export type ResearchSource = WebSourceRef;
export type ResearchDigest = WebResearchDigest;

// Toggle usado SÓ pela geração de planos (tela de objetivo, onde ainda não
// existe célula). No resto do app a pesquisa é ação explícita por célula.
export function isWebResearchOn(): boolean {
  return useConfigStore.getState().webResearchEnabled && !!getActiveConfig();
}

const MAX_SOURCES = 6;

interface ResearchCall {
  model: LanguageModel;
  tools?: ToolSet;
}

// Monta modelo+tools com web search para o provider ativo. Lança se não há
// config — os call sites já passaram por assertAIReady/requireAI.
function buildResearchCall(): ResearchCall {
  const active = getActiveConfig();
  if (!active) throw new Error('No AI provider configured for web research.');
  const { provider, config } = active;

  if (provider === 'openai') {
    const client = createOpenAI({ apiKey: config.apiKey });
    return {
      // Web search só existe na Responses API — o chat() usado no resto do app
      // não suporta a tool.
      model: client.responses(config.mainModel),
      // Cast: @ai-sdk/openai v2 exporta Tool da spec v2 e o pacote `ai` v6 tipa
      // ToolSet contra a v3. Em runtime a tool é provider-executed (só vai
      // serializada na request) — o conflito é puramente de tipos.
      tools: {
        web_search: client.tools.webSearch({ searchContextSize: 'medium' }),
      } as unknown as ToolSet,
    };
  }
  if (provider === 'anthropic') {
    const client = createAnthropic({
      apiKey: config.apiKey,
      headers: { 'anthropic-dangerous-direct-browser-access': 'true' },
    });
    return {
      model: client(config.mainModel),
      // Mesmo cast da OpenAI acima — skew de spec v2/v3, runtime ok.
      tools: {
        web_search: client.tools.webSearch_20250305({ maxUses: 4 }),
      } as unknown as ToolSet,
    };
  }
  // openrouter — engine 'exa' de propósito: o grounding nativo (Gemini) devolve
  // URLs de redirect inúteis como âncora; a Exa devolve URL direta + título.
  const client = createOpenRouter({
    apiKey: config.apiKey,
    appName: 'cellproject',
    appUrl: typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5173',
  });
  return {
    model: client.chat(config.mainModel, {
      plugins: [{ id: 'web', max_results: 5, engine: 'exa' }],
    }),
  };
}

function researchSystem(): string {
  const lang = currentLocaleAIName();
  return `You are the research arm of Cellproject, a planning assistant grounded in reality.
Use web search to gather CONCRETE, CURRENT facts about the topic: official documentation, real prices, real part/model numbers, specs with units, known tutorials, version numbers.

RULES
- Respond in ${lang}.
- Output a SHORT research digest: 4-10 bullet points, each one a verifiable fact.
- Every fact that came from a source must cite it inline as a markdown link [site](url).
- Prefer official documentation and primary sources over blogspam.
- Real numbers beat adjectives: "R$ 180-250 on Mercado Livre (06/2026)" beats "affordable".
- If the search returns nothing useful for some aspect, say so in one line — do not fill gaps with memory.
- No introduction, no conclusion — bullets only.`;
}

// Dedupe por URL, mantém a ordem de chegada, corta em MAX_SOURCES.
function normalizeSources(
  raw: Array<{ sourceType: string; url?: string; title?: string }> | undefined,
): ResearchSource[] {
  if (!raw) return [];
  const seen = new Set<string>();
  const out: ResearchSource[] = [];
  for (const s of raw) {
    if (s.sourceType !== 'url' || !s.url || seen.has(s.url)) continue;
    seen.add(s.url);
    out.push({ url: s.url, title: s.title?.trim() || hostnameOf(s.url) });
    if (out.length >= MAX_SOURCES) break;
  }
  return out;
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export interface GroundedTextResult {
  text: string;
  sources: ResearchSource[];
}

// generateText com web search ligado — para fluxos cujo output já é texto
// (tutor). Uma chamada só: o modelo pesquisa e escreve fundamentado.
export async function groundedText(opts: {
  system: string;
  prompt: string;
  temperature?: number;
}): Promise<GroundedTextResult> {
  const { model, tools } = buildResearchCall();
  const result = await generateText({
    model,
    ...(tools ? { tools } : {}),
    system: opts.system,
    prompt: opts.prompt,
    temperature: opts.temperature ?? 0.4,
  });
  return { text: result.text.trim(), sources: normalizeSources(result.sources) };
}

// Roda UMA pesquisa sobre o tópico. `focus` afina o ângulo (ex.: "verificar
// preços e disponibilidade", "documentação oficial e versões atuais").
export async function runResearch(topic: string, focus?: string): Promise<ResearchDigest> {
  const prompt = `RESEARCH TOPIC:
"""
${topic.trim()}
"""
${focus ? `\nFOCUS: ${focus.trim()}\n` : ''}
Search the web and produce the digest now.`;

  const result = await groundedText({ system: researchSystem(), prompt, temperature: 0.3 });

  return {
    query: topic.trim(),
    findings: result.text,
    sources: result.sources,
    searchedAt: Date.now(),
  };
}

// Bloco injetado nos prompts estruturados (planos, crítica, replan). Mesmo
// espírito do formatKBContext: vazio quando não há digest.
export function formatResearchBlock(digest?: ResearchDigest | null): string {
  if (!digest || !digest.findings) return '';
  const sourceList = digest.sources
    .map((s, i) => `  [W${i + 1}] ${s.title} — ${s.url}`)
    .join('\n');
  return `

WEB RESEARCH (real web search performed NOW — these facts and URLs are REAL, verified sources)
${digest.findings}
${sourceList ? `\nSOURCES:\n${sourceList}` : ''}

Ground your output in this research: prefer its concrete facts (prices, specs, versions) over your memory. The SOURCE URLs above are the ONLY real links available — never cite or invent URLs outside this list.`;
}
