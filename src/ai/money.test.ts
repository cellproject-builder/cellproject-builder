import { describe, it, expect } from 'vitest';
import { normalizeMoney, isPriceEstimate } from './service';

describe('dinheiro no texto da IA', () => {
  it('normaliza "R$60" para "R$ 60" sem mexer no que já tem espaço', () => {
    expect(normalizeMoney('até R$60, total R$110–130')).toBe('até R$ 60, total R$ 110–130');
    expect(normalizeMoney('R$ 650–770')).toBe('R$ 650–770');
  });

  it('faixa de preço é estimativa, não prova; medida física passa', () => {
    expect(isPriceEstimate('R$110–130')).toBe(true);
    expect(isPriceEstimate('R$ 80 a 100')).toBe(true);
    expect(isPriceEstimate('$35-50')).toBe(true);
    expect(isPriceEstimate('40cm ± 2cm')).toBe(false);
    expect(isPriceEstimate('60 L ± 2 L')).toBe(false);
  });
});
