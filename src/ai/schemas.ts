import { z } from 'zod';

// ATENÇÃO: nada de z.number().int()/.min()/.max() nem .min()/.max() em arrays
// nestes schemas. Gemini (default no OpenRouter) compila o JSON Schema num
// autômato de decodificação restrita e rejeita bounds numéricos / limites de
// array com 400 "constraint has too many states". Os limites são garantidos
// no prompt + clamp no código (materializeNode / hydratePlan).

const NodeKindSchema = z.enum(['categoria', 'recurso', 'passo', 'decisao', 'concept']);
const EdgeKindSchema = z.enum(['direct', 'middleware', 'independent', 'optional']);
const CategoryKindSchema = z.enum(['recursos', 'execucao', 'decisoes']);
const GroundTruthKindSchema = z.enum(['link', 'spec', 'medida']);
const ConstructionStrategySchema = z.enum(['reaproveitar', 'hibrido', 'do_zero']);
const ProjectArchetypeSchema = z.enum(['construir', 'entender']);

const DecisionOptionSchema = z.object({
  label: z.string().describe('Título curto da opção.'),
  pitch: z.string().describe('1–2 frases explicando essa opção.'),
  consequences: z.string().optional().describe('O que muda se escolher esta opção.'),
});

const GroundTruthHintSchema = z.object({
  kind: GroundTruthKindSchema.describe(
    '"link" (URL verificável), "spec" (especificação textual com unidade/modelo), "medida" (número com unidade e tolerância).',
  ),
  label: z.string().describe('Rótulo curto do que esta âncora representa.'),
  value: z
    .string()
    .describe(
      'URL, especificação ou medida concreta — algo que o usuário pode conferir no mundo real. Ex: "40cm ± 2cm", "bambu Phyllostachys aurea", "https://pt.wikipedia.org/wiki/Pipa".',
    ),
});

export const SuggestedNodeSchema = z.object({
  tempId: z
    .string()
    .describe('Identificador curto e único dentro deste plano. Ex: "n1", "r2", "p3".'),
  kind: NodeKindSchema,
  name: z.string().describe('Nome curto e específico do nó (2–6 palavras).'),
  fx: z
    .string()
    .describe(
      'Função do nó descrita como transformação "estado antes → estado depois". Frase curta.',
    ),
  problem: z.string().describe('Problema que este nó resolve. 1 frase.'),
  confidence: z.number().describe('Confiança de 0 a 100.'),
  confidenceReason: z.string().describe('Motivo curto da confiança.'),
  pros: z.array(z.string()).describe('Prós curtos. Pode ser vazio.'),
  cons: z.array(z.string()).describe('Contras curtos. Pode ser vazio.'),
  oQue: z.string().describe('Explicação didática do que é este nó (2–4 frases).'),
  porQue: z.string().describe('Por que ele é necessário (1–3 frases).'),
  comoConfirmar: z
    .string()
    .describe('Pergunta concreta que o usuário possa responder sim/não para confirmar.'),
  order: z
    .number()
    .optional()
    .describe('Ordem entre irmãos (inteiro) — obrigatório se kind="passo".'),
  decisionOptions: z
    .array(DecisionOptionSchema)
    .optional()
    .describe('Opções — obrigatório se kind="decisao".'),
  groundTruthHints: z
    .array(GroundTruthHintSchema)
    .optional()
    .describe(
      'Âncoras verificáveis no mundo real: links, specs, medidas com unidade. Prefira concreto sobre genérico. Vazio é aceitável quando não existe âncora natural.',
    ),
});

export const SuggestedEdgeSchema = z.object({
  sourceTempId: z.string(),
  targetTempId: z.string(),
  kind: EdgeKindSchema,
  note: z.string().optional(),
});

export const PlanCategorySchema = z.object({
  tempId: z.string().describe('Id único da categoria, ex: "cat1".'),
  name: z.string().describe('Nome legível: "Recursos", "Execução" ou "Decisões".'),
  kind: CategoryKindSchema,
  oQue: z.string(),
  porQue: z.string(),
  children: z
    .array(SuggestedNodeSchema)
    .describe(
      'Nós filhos diretos desta categoria. COMPLETO: em "recursos", um nó por subsistema/pré-requisito de que o resultado depende pra FUNCIONAR (ex., num build eletrônico: estrutura, atuação, placa de controle, energia, comando, fiação/solda, software; num objetivo de entender: um conceito por premissa de que a conclusão depende) — tipicamente 5–8; em "execucao", passos até um resultado funcionando e testado — incluindo, quando há montagem, conexão, configuração/calibração e teste final (tipicamente 5–8).',
    ),
});

export const PlanSchema = z.object({
  title: z.string().describe('Título curto e memorável do plano (2–6 palavras).'),
  pitch: z.string().describe('1–2 frases resumindo a abordagem.'),
  approach: z.string().describe('Parágrafo descrevendo a abordagem geral, deixando claro COMO se constrói (reaproveitar vs do zero).'),
  strategy: ConstructionStrategySchema.describe(
    'Estratégia de confecção deste plano: "reaproveitar" (reusar/adaptar o que já existe), "hibrido" (reusar o caro/complexo, fazer o simples), "do_zero" (forjar/construir cada peça).',
  ),
  archetype: ProjectArchetypeSchema.describe(
    'Tipo do objetivo: "construir" (fazer/alcançar algo concreto) ou "entender" (compreender por quê/como, decompondo até os primeiros princípios). Todos os planos do mesmo objetivo têm o mesmo archetype.',
  ),
  rank: z
    .number()
    .describe(
      'Posição no ranking para ESTE objetivo (e regras, se houver), inteiro a partir de 1: 1 = sua melhor recomendação, 2 = segunda, 3 = terceira.',
    ),
  rankReason: z
    .string()
    .describe(
      'UMA frase concreta com o tradeoff que justifica a posição (custo, tempo, risco, robustez, aprendizado). Sem marketing.',
    ),
  tree: z.object({
    categorias: z
      .array(PlanCategorySchema)
      .describe('1 a 3 categorias. Sempre inclua "recursos" e "execucao". "decisoes" só se houver tradeoff real.'),
  }),
});

export const PlansResponseSchema = z.object({
  plans: z
    .array(PlanSchema)
    .describe('EXATAMENTE 3 planos alternativos, com estilos claramente diferentes e ranqueados.'),
});

export const DecomposeResponseSchema = z.object({
  nodes: z.array(SuggestedNodeSchema).describe('Pelo menos 1 nó novo.'),
  edges: z.array(SuggestedEdgeSchema).describe('Arestas entre os novos nós. Pode ser vazio.'),
});

// Revisor adversarial — prompt distinto do planejador.
// Objetivo: fornecer um critério de verificação INDEPENDENTE do que a IA
// originalmente gerou, quebrando o loop IA→IA.
export const CritiqueResponseSchema = z.object({
  fraquezas: z
    .array(z.string())
    .describe('Pelo menos 1 ponto onde este nó pode estar errado, incompleto, ou depender de premissa frágil.'),
  premissasOcultas: z
    .array(z.string())
    .describe('Coisas que o plano assume em silêncio e que o usuário pode não perceber.'),
  criterioAlternativo: z
    .string()
    .describe(
      'Critério INDEPENDENTE de confirmação, escrito como cético. Deve ser diferente em forma e foco do comoConfirmar original. Concreto e verificável no mundo real.',
    ),
});

export type PlansResponse = z.infer<typeof PlansResponseSchema>;
export type DecomposeResponse = z.infer<typeof DecomposeResponseSchema>;
export type CritiqueResponse = z.infer<typeof CritiqueResponseSchema>;
export type RawPlan = z.infer<typeof PlanSchema>;
export type RawSuggestedNode = z.infer<typeof SuggestedNodeSchema>;
export type RawSuggestedEdge = z.infer<typeof SuggestedEdgeSchema>;
