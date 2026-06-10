import { z } from 'zod';

const NivelSchema = z.enum(['iniciante', 'intermediario', 'avancado']);
const FatoTipoSchema = z.enum(['medida', 'spec', 'regra', 'link']);

export const KBFatoSchema = z.object({
  claim: z
    .string()
    .describe('Afirmação concreta do texto. Prefira frases com números, unidades, limites.'),
  tipo: FatoTipoSchema,
  valor: z
    .string()
    .optional()
    .describe('Valor isolado quando aplicável. Ex: "10km/h", "40cm ± 2cm".'),
});

export const KBSummarySchema = z.object({
  titulo: z.string().describe('Título legível do documento (não o filename).'),
  autores: z.string().optional().describe('Autores se detectáveis no texto.'),
  dominio: z
    .string()
    .describe(
      'Domínio curto e específico do conteúdo. Ex: "marcenaria", "eletrônica analógica", "culinária vegetariana".',
    ),
  // Sem .min()/.max() nos arrays: Gemini rejeita limites de cardinalidade no
  // JSON Schema (400 "too many states"). Os limites vivem nos describes.
  tags: z
    .array(z.string())
    .describe('3 a 15 conceitos-chave, nomes próprios, técnicas. Uma palavra ou frase curta.'),
  resumo: z
    .array(z.string())
    .describe('Resumo em 3-6 bullets cobrindo a tese/conteúdo principal. Frases curtas.'),
  fatos: z
    .array(KBFatoSchema)
    .describe(
      'Até 10 afirmações concretas e verificáveis extraídas do texto. Foque em números, medidas, limites, regras. Vazio se o documento for puramente conceitual.',
    ),
  nivel: NivelSchema.describe(
    'Nível presumido do leitor pelo texto: iniciante, intermediario, avancado.',
  ),
});

// Resposta do AI-judge de relevância.
export const RelevancePickSchema = z.object({
  picks: z
    .array(
      z.object({
        docId: z.string(),
        reason: z.string().describe('1 frase explicando por que este doc é relevante.'),
      }),
    )
    .describe('Documentos relevantes, ordenados do mais ao menos útil. Vazio se nada servir.'),
});

export type RawKBSummary = z.infer<typeof KBSummarySchema>;
export type RelevancePickResponse = z.infer<typeof RelevancePickSchema>;
