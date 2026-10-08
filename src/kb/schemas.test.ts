import { describe, it, expect } from 'vitest';
import { zodSchema } from 'ai';
import type { z } from 'zod';
import { KB_RESPONSE_SCHEMAS } from './schemas';

// Os schemas da base também vão como strict json_schema: toda propriedade em
// `required` e additionalProperties=false (mesma regra de ai/schemas.test.ts).

type JSONNode = Record<string, unknown>;

function violations(node: unknown, path = '$'): string[] {
  if (!node || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap((n, i) => violations(n, `${path}[${i}]`));
  const obj = node as JSONNode;
  const out: string[] = [];
  if (obj.properties && typeof obj.properties === 'object') {
    const required = new Set(Array.isArray(obj.required) ? (obj.required as string[]) : []);
    for (const k of Object.keys(obj.properties as JSONNode)) {
      if (!required.has(k)) out.push(`${path}.properties.${k} fora de required`);
    }
    if (obj.additionalProperties !== false) out.push(`${path} sem additionalProperties=false`);
  }
  for (const kw of ['minimum', 'maximum', 'minItems', 'maxItems']) {
    if (kw in obj) out.push(`${path} usa "${kw}"`);
  }
  for (const [k, v] of Object.entries(obj)) out.push(...violations(v, `${path}.${k}`));
  return out;
}

describe('schemas da base — compatíveis com strict json_schema', () => {
  for (const [name, schema] of Object.entries(KB_RESPONSE_SCHEMAS)) {
    it(name, async () => {
      const json = await (zodSchema(schema as z.ZodType).jsonSchema as JSONNode | PromiseLike<JSONNode>);
      expect(violations(json)).toEqual([]);
    });
  }
});
