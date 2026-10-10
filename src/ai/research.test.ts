import { describe, expect, it } from 'vitest';
import { formatResearchBlock } from './research';

describe('research context evidence boundary', () => {
  it('presents a saved digest as documentary claims rather than verified facts or a search performed now', () => {
    const block = formatResearchBlock({
      query: 'servo family', searchedAt: 1, findings: 'A digest claim whose applicability is still unknown.',
      sources: [{ url: 'https://maker.example/servo', title: 'Servo family' }],
    });
    expect(block).toContain('documentary claims, not physical observations');
    expect(block).toContain('not independently verified');
    expect(block).toContain('Check source applicability and variant');
    expect(block).toContain('A digest claim whose applicability is still unknown.');
    expect(block).toContain('[W1] Servo family — https://maker.example/servo');
    expect(block).toContain('never cite or invent URLs outside this list');
    expect(block).not.toContain('performed NOW');
    expect(block).not.toContain('ONLY real links');
    expect(block).not.toContain('facts and URLs are REAL, verified sources');
  });

  it('does not manufacture research context when there is no digest', () => {
    expect(formatResearchBlock()).toBe('');
    expect(formatResearchBlock(null)).toBe('');
    expect(formatResearchBlock({ query: '', searchedAt: 0, findings: '', sources: [] })).toBe('');
  });
});
