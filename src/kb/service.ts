import { generateObject } from 'ai';
import { kbModel, assertAIReady } from '@/ai/client';
import { KBSummarySchema, RelevancePickSchema } from './schemas';
import type { KBContextEntry, KBDocument, KBSummary } from './types';

// ---------------------------------------------------------------------------
// summarizeDocument — 1 chamada ao kbModel por upload
// ---------------------------------------------------------------------------
// Cortamos o texto antes de enviar: a maioria dos PDFs úteis cabe em ~40k
// caracteres da primeira fatia, e modelos baratos tem contexto limitado.
// Se o doc for muito grande, pegamos início + trecho do meio + fim —
// boa cobertura sem estourar o prompt.

const MAX_CHARS = 40_000;

function clipText(text: string): string {
  if (text.length <= MAX_CHARS) return text;
  const chunk = Math.floor(MAX_CHARS / 3);
  const start = text.slice(0, chunk);
  const midStart = Math.floor(text.length / 2) - Math.floor(chunk / 2);
  const mid = text.slice(midStart, midStart + chunk);
  const end = text.slice(-chunk);
  return `${start}\n\n[...corte...]\n\n${mid}\n\n[...corte...]\n\n${end}`;
}

const SUMMARY_SYSTEM = `Você é um indexador de conhecimento. Dado o texto de um documento, extrai um resumo estruturado que será usado depois como contexto de base por outra IA planejadora.

REGRAS
- Responda em português do Brasil, mesmo quando o documento estiver em outro idioma (traduza os conceitos, não o vocabulário técnico estabelecido).
- Seja fiel ao texto. NÃO invente fatos que não aparecem lá.
- 'dominio' deve ser curto e específico — "eletrônica analógica" é útil, "ciência" é inútil.
- 'fatos' deve conter afirmações VERIFICÁVEIS: medidas com unidade, limites, regras explícitas do autor. Se o texto é puramente conceitual, retorne array vazio.
- Se autores não aparecerem no texto, omita o campo. Não inventar.`;

export async function summarizeDocument(extractedText: string): Promise<KBSummary> {
  assertAIReady();
  const clipped = clipText(extractedText);
  const { object } = await generateObject({
    model: kbModel,
    schema: KBSummarySchema,
    schemaName: 'KBSummary',
    system: SUMMARY_SYSTEM,
    prompt: `DOCUMENTO (texto extraído, pode estar cortado):
"""
${clipped}
"""

TAREFA
Gere o resumo estruturado deste documento.`,
    temperature: 0.3,
  });
  return {
    titulo: object.titulo,
    autores: object.autores,
    dominio: object.dominio,
    tags: object.tags,
    resumo: object.resumo,
    fatos: object.fatos,
    nivel: object.nivel,
  };
}

// ---------------------------------------------------------------------------
// pickRelevantDocs — AI-judge de relevância
// ---------------------------------------------------------------------------
// Recebe o pool de docs conhecidos (só título+domínio+tags+1º bullet pra
// manter o prompt barato) e o contexto do que está sendo planejado. Retorna
// até N ids considerados relevantes, com motivo.

export interface PickContext {
  // O contexto de uso: objetivo do projeto + breadcrumb + opcional nome do nó.
  label: string;
  extra?: string;
}

const JUDGE_SYSTEM = `Você escolhe quais documentos de um repositório pessoal são relevantes para um objetivo de planejamento específico.

REGRAS
- Rigoroso. Prefira vazio a incluir docs tangenciais. "Um pouco relacionado" = não inclua.
- Justifique em 1 frase direta. Se nenhum doc se aplica, devolva array vazio.
- Máximo 2 docs. Se mais de 2 parecerem relevantes, escolha os 2 melhores.`;

export async function pickRelevantDocs(
  ctx: PickContext,
  docs: KBDocument[],
  max = 2,
): Promise<{ docId: string; reason: string }[]> {
  if (docs.length === 0) return [];
  assertAIReady();

  const catalog = docs
    .map(
      (d) =>
        `- docId: ${d.id}
  título: ${d.summary.titulo}
  domínio: ${d.summary.dominio}
  tags: ${d.summary.tags.slice(0, 8).join(', ')}
  resumo: ${d.summary.resumo[0] ?? ''}`,
    )
    .join('\n');

  const { object } = await generateObject({
    model: kbModel,
    schema: RelevancePickSchema,
    schemaName: 'RelevancePick',
    system: JUDGE_SYSTEM,
    prompt: `CONTEXTO DE USO
${ctx.label}
${ctx.extra ? `\nDetalhe: ${ctx.extra}` : ''}

REPOSITÓRIO DISPONÍVEL
${catalog}

TAREFA
Escolha até ${max} docs cujo conteúdo se aplique diretamente ao contexto. Vazio se nenhum se aplicar.`,
    temperature: 0.2,
  });

  // Filtra ids inválidos defensivamente (o modelo pode inventar).
  const validIds = new Set(docs.map((d) => d.id));
  return object.picks.filter((p) => validIds.has(p.docId)).slice(0, max);
}

// ---------------------------------------------------------------------------
// Helper: monta KBContextEntry[] pra injetar em prompts do ai/service.ts
// ---------------------------------------------------------------------------

export function toContextEntries(docs: KBDocument[]): KBContextEntry[] {
  return docs.map((d) => ({
    docId: d.id,
    titulo: d.summary.titulo,
    dominio: d.summary.dominio,
    resumo: d.summary.resumo,
    fatos: d.summary.fatos,
    tags: d.summary.tags,
  }));
}
