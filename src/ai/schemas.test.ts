import { describe, it, expect } from 'vitest';
import { zodSchema } from 'ai';
import { z } from 'zod';
import { RESPONSE_SCHEMAS } from './schemas';

// Os schemas de resposta vão como strict json_schema (OpenAI gpt-6.x-sol via
// OpenRouter). Strict exige: toda propriedade em `required` e
// additionalProperties=false. Gemini, por sua vez, rejeita bounds numéricos e
// limites de array. Convertemos com o MESMO conversor que o ai-sdk usa na
// request e varremos o JSON Schema inteiro.

type JSONNode = Record<string, unknown>;

const FORBIDDEN_KEYWORDS = ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'minItems', 'maxItems'];

async function toJSONSchema(schema: z.ZodType): Promise<JSONNode> {
  const converted = zodSchema(schema).jsonSchema as JSONNode | PromiseLike<JSONNode>;
  return await converted;
}

function strictViolations(node: unknown, path = '$'): string[] {
  if (!node || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap((n, i) => strictViolations(n, `${path}[${i}]`));
  const obj = node as JSONNode;
  const out: string[] = [];

  if (obj.properties && typeof obj.properties === 'object') {
    const keys = Object.keys(obj.properties as JSONNode);
    const required = new Set(Array.isArray(obj.required) ? (obj.required as string[]) : []);
    for (const k of keys) {
      if (!required.has(k)) out.push(`${path}.properties.${k} fora de required`);
    }
    if (obj.additionalProperties !== false) out.push(`${path} sem additionalProperties=false`);
  }
  for (const kw of FORBIDDEN_KEYWORDS) {
    if (kw in obj) out.push(`${path} usa "${kw}"`);
  }
  for (const [k, v] of Object.entries(obj)) {
    out.push(...strictViolations(v, `${path}.${k}`));
  }
  return out;
}

describe('schemas de resposta — compatíveis com strict json_schema', () => {
  for (const [name, schema] of Object.entries(RESPONSE_SCHEMAS)) {
    it(`${name}: toda propriedade em required, sem bounds`, async () => {
      const json = await toJSONSchema(schema);
      expect(strictViolations(json)).toEqual([]);
    });
  }

  it('o verificador pega .optional() e bounds (o teste falharia)', async () => {
    const bad = z.object({
      a: z.string(),
      b: z.string().optional(),
      c: z.array(z.object({ d: z.number().min(0).optional() })).min(1),
    });
    const violations = strictViolations(await toJSONSchema(bad));
    expect(violations.some((v) => v.includes('properties.b fora de required'))).toBe(true);
    expect(violations.some((v) => v.includes('properties.d fora de required'))).toBe(true);
    expect(violations.some((v) => v.includes('"minItems"'))).toBe(true);
    expect(violations.some((v) => v.includes('"minimum"'))).toBe(true);
  });

  it('.nullable() mantém a chave em required', async () => {
    const ok = z.object({ a: z.string().nullable() });
    expect(strictViolations(await toJSONSchema(ok))).toEqual([]);
  });
});
