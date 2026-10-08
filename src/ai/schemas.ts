import { z } from 'zod';

// ATENÇÃO — regras para TODO schema enviado ao modelo (response_format):
// 1. Nada de z.number().int()/.min()/.max() nem .min()/.max() em arrays.
//    Gemini compila o JSON Schema num autômato de decodificação restrita e
//    rejeita bounds com 400 "constraint has too many states". Os limites são
//    garantidos no prompt + clamp no código (materializeNode / hydratePlan).
// 2. Nada de .optional(). OpenAI (gpt-6.x-sol) e o OpenRouter usam strict
//    json_schema: TODA propriedade precisa estar em `required`. Campo que pode
//    faltar vira .nullable() (chave sempre presente, valor null) e o service
//    normaliza null→undefined. O teste schemas.test.ts trava isso.

const NodeKindSchema = z.enum(['categoria', 'recurso', 'passo', 'decisao', 'concept']);
const EdgeKindSchema = z.enum(['direct', 'middleware', 'independent', 'optional']);
const CategoryKindSchema = z.enum(['recursos', 'execucao', 'decisoes']);
const GroundTruthKindSchema = z.enum(['link', 'spec', 'medida']);
const ConstructionStrategySchema = z.enum(['reaproveitar', 'hibrido', 'do_zero']);
const ProjectArchetypeSchema = z.enum(['construir', 'entender']);
const DifficultySchema = z.enum(['iniciante', 'intermediario', 'avancado']);
const RuleStatusSchema = z.enum(['cumpre', 'risco', 'viola']);

const DecisionOptionSchema = z.object({
  label: z.string().describe('Título curto da opção.'),
  pitch: z.string().describe('1–2 frases explicando essa opção.'),
  consequences: z
    .string()
    .nullable()
    .describe('O que muda se escolher esta opção. null se não houver nada a acrescentar.'),
});

const GroundTruthHintSchema = z.object({
  kind: GroundTruthKindSchema.describe(
    '"link" (URL real da lista SOURCES da pesquisa web — proibido sem pesquisa), "spec" (modelo/part number ou especificação com unidade, conferível num datasheet), "medida" (número + unidade + tolerância).',
  ),
  label: z.string().describe('Rótulo curto do que esta âncora representa.'),
  value: z
    .string()
    .describe(
      'Valor conferível no mundo real — NUNCA uma instrução. Bom: "40cm ± 2cm", "XT60", "ESP32-WROOM-32", "< 15g". Ruim: "Fazer o teste sem hélices".',
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
      'Função do nó como transformação "estado antes → estado depois" — ≤ 80 caracteres.',
    ),
  confidence: z
    .number()
    .describe(
      'Chance (0–100) de um usuário deste nível cumprir o nó de primeira. Use a escala inteira: 90+ = comprar/baixar algo padrão; 60–80 = exige cuidado ou uma habilidade nova; <50 = iniciante costuma errar aqui ou depende de premissa não verificada (compatibilidade, solda, legislação).',
    ),
  confidenceReason: z.string().describe('Motivo da confiança — máx. 80 caracteres.'),
  oQue: z
    .string()
    .describe(
      'O que é, em palavras simples — máx. 2 frases, ≤ 220 caracteres. A primeira frase diz O QUÊ sem jargão; termo técnico ganha uma glosa curta entre parênteses na primeira menção.',
    ),
  porQue: z.string().describe('Por que ele é necessário — 1 frase, ≤ 140 caracteres.'),
  comoConfirmar: z
    .string()
    .describe(
      'UMA checagem observável com limiar de aprovação — o que olhar/medir e qual valor passa. Máx. 140 caracteres, UMA única condição; se precisar de mais, o nó é grande demais. Bom: "Multímetro em continuidade entre BAT+ e BAT−: não apita." Ruim: "Está tudo correto, ligado e funcionando?"',
    ),
  ruleConflict: z
    .string()
    .nullable()
    .describe(
      'Só quando este nó estoura uma regra do usuário: o conflito concreto em 1 frase (ex.: "Viola orçamento: ~R$420 só neste item"). null quando cumpre todas.',
    ),
  order: z
    .number()
    .nullable()
    .describe('Ordem entre irmãos (inteiro a partir de 1) — obrigatório se kind="passo"; null nos demais.'),
  decisionOptions: z
    .array(DecisionOptionSchema)
    .nullable()
    .describe('2 ou 3 opções — obrigatório se kind="decisao"; null nos demais.'),
  groundTruthHints: z
    .array(GroundTruthHintSchema)
    .describe(
      '0 a 2 âncoras verificáveis no mundo real (a mais forte primeiro). Vazio quando não existe âncora natural — nunca invente.',
    ),
});

export const SuggestedEdgeSchema = z.object({
  sourceTempId: z.string(),
  targetTempId: z.string(),
  kind: EdgeKindSchema,
  note: z.string().nullable().describe('Nota curta sobre a relação, ou null.'),
});

export const PlanCategorySchema = z.object({
  tempId: z.string().describe('Id único da categoria, ex: "cat1".'),
  name: z.string().describe('Nome legível da categoria, no idioma da resposta.'),
  kind: CategoryKindSchema,
  oQue: z.string(),
  porQue: z.string(),
  children: z
    .array(SuggestedNodeSchema)
    .describe(
      'Nós filhos diretos desta categoria — tipicamente 4 a 6. COMPLETO: em "recursos", um nó por subsistema/pré-requisito de que o resultado depende pra FUNCIONAR (agrupe miudezas afins num nó só); em "execucao", passos até um resultado funcionando e testado — incluindo, quando há montagem, conexão, configuração/calibração e teste final.',
    ),
});

const PlanEstimatesSchema = z.object({
  custo: z
    .string()
    .describe('Faixa de custo total realista, com moeda (ex.: "R$ 900–1.300"). "R$ 0" se não houver gasto.'),
  tempo: z.string().describe('Tempo total realista até o resultado testado (ex.: "2 fins de semana").'),
  dificuldade: DifficultySchema,
});

const RuleCheckSchema = z.object({
  rule: z.string().describe('A regra do usuário, copiada como foi escrita.'),
  status: RuleStatusSchema.describe(
    '"cumpre" (cabe com margem), "risco" (cabe no limite ou depende de premissa), "viola" (não cabe).',
  ),
  nota: z.string().describe('1 frase com o número/fato que sustenta o status.'),
});

export const PlanSchema = z.object({
  title: z.string().describe('Título curto e memorável do plano (2–6 palavras).'),
  pitch: z.string().describe('1–2 frases resumindo a abordagem.'),
  approach: z.string().describe('2–3 frases (≤ 400 caracteres) deixando claro COMO se constrói (reaproveitar vs do zero).'),
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
  estimates: PlanEstimatesSchema.describe('Estimativas para comparar planos lado a lado.'),
  rulesCheck: z
    .array(RuleCheckSchema)
    .describe('Uma entrada por regra do usuário, na mesma ordem. Vazio se não há regras.'),
  tree: z.object({
    categorias: z
      .array(PlanCategorySchema)
      .describe('2 ou 3 categorias. Sempre inclua "recursos" e "execucao". "decisoes" só se houver tradeoff real.'),
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

// Replan = decompose + diagnóstico de qual premissa estava errada.
export const ReplanResponseSchema = z.object({
  diagnosis: z
    .string()
    .describe('UMA frase: qual premissa do caminho anterior estava errada, à luz da falha relatada.'),
  nodes: z.array(SuggestedNodeSchema).describe('2 a 4 nós novos, diferentes da decomposição anterior.'),
  edges: z.array(SuggestedEdgeSchema).describe('Arestas entre os novos nós. Pode ser vazio.'),
});

// Revisor adversarial — prompt distinto do planejador.
// Objetivo: fornecer um critério de verificação INDEPENDENTE do que a IA
// originalmente gerou, quebrando o loop IA→IA.
export const CritiqueResponseSchema = z.object({
  fraquezas: z
    .array(z.string())
    .describe('1 a 3 pontos (o mais grave primeiro, ≤160 caracteres cada) onde este nó pode estar errado, incompleto, ou depender de premissa frágil.'),
  premissasOcultas: z
    .array(z.string())
    .describe('Até 3 coisas que o plano assume em silêncio e que o usuário pode não perceber.'),
  criterioAlternativo: z
    .string()
    .describe(
      'Critério INDEPENDENTE de confirmação, escrito como cético. Deve ser diferente em forma e foco do comoConfirmar original. Concreto e verificável no mundo real.',
    ),
});

// Todos os schemas de resposta — percorridos pelo schemas.test.ts.
export const RESPONSE_SCHEMAS = {
  PlansResponse: PlansResponseSchema,
  DecomposeResponse: DecomposeResponseSchema,
  ReplanResponse: ReplanResponseSchema,
  CritiqueResponse: CritiqueResponseSchema,
} as const;

export type PlansResponse = z.infer<typeof PlansResponseSchema>;
export type DecomposeResponse = z.infer<typeof DecomposeResponseSchema>;
export type ReplanResponse = z.infer<typeof ReplanResponseSchema>;
export type CritiqueResponse = z.infer<typeof CritiqueResponseSchema>;
export type RawPlan = z.infer<typeof PlanSchema>;
export type RawSuggestedNode = z.infer<typeof SuggestedNodeSchema>;
export type RawSuggestedEdge = z.infer<typeof SuggestedEdgeSchema>;
