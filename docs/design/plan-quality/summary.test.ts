import { expect, it } from 'vitest';
import { assistantText } from '../../../scripts/planning-quality-summary';
it('extracts model JSON without mixing reasoning or processing comments into the answer', () => {
  const first = JSON.stringify({ choices: [{ delta: { reasoning: 'hidden', content: '{"nodes":' } }] });
  const last = JSON.stringify({ choices: [{ delta: { content: '[]}' } }] });
  expect(assistantText(`: processing\n\ndata: ${first}\n\ndata: ${last}\n\ndata: [DONE]\n\n`)).toBe('{"nodes":[]}');
  expect(assistantText(JSON.stringify({ choices: [{ message: { content: '{"nodes":[]}' } }] }))).toBe('{"nodes":[]}');
  expect(assistantText('garbled')).toBe('');
});
