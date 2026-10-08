import { describe, it, expect } from 'vitest';
import { scrubInternalNames } from './service';

// Rodada 2: nome de campo do schema não pode chegar ao texto que o usuário lê.
describe('scrubInternalNames', () => {
  it('troca groundTruthHint(s) por termo do usuário e remove kind="..."', () => {
    const out = scrubInternalNames('groundTruthHint (kind="medida"): 4 potes; faltam groundTruthHints de medida');
    expect(out).not.toMatch(/groundTruthHints?|kind=/);
    expect(out).toContain('4 potes');
  });

  it('não mexe em texto comum', () => {
    expect(scrubInternalNames('Meça 40cm ± 2cm com a trena.')).toBe('Meça 40cm ± 2cm com a trena.');
  });
});
