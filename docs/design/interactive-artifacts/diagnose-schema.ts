import { z } from 'zod';
import { zodSchema } from '@ai-sdk/provider-utils';
import { diagramSchema } from './model';
for (const [name, convert] of [
  ['zod-native', () => z.toJSONSchema(diagramSchema)],
  ['sdk-conversion', () => zodSchema(diagramSchema).jsonSchema],
] as const) {
  try { const schema = convert(); console.log(name, JSON.stringify(schema).slice(0, 300)); }
  catch (error) { console.log(name, error instanceof Error ? error.message : 'conversion-failed'); }
}
