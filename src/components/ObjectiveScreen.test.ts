import { describe, expect, it } from 'vitest';
import {
  MAX_PLANS,
  formatClock,
  groupByStrategy,
  mergePlanBatches,
  mergeRules,
  normalizeRanks,
  parseRules,
  sameRules,
} from './ObjectiveScreen';
import { en, ptBR } from '@/i18n/messages';

type P = { id: string; rank: number; strategy: 'reaproveitar' | 'hibrido' | 'do_zero' };
const plan = (id: string, rank: number, strategy: P['strategy'] = 'reaproveitar'): P => ({
  id,
  rank,
  strategy,
});

describe('regras', () => {
  it('separa por ";" e quebra de linha, ignorando vazios', () => {
    expect(parseRules('orçamento R$300; sem solda\n\n  2 fins de semana  ;')).toEqual([
      'orçamento R$300',
      'sem solda',
      '2 fins de semana',
    ]);
    expect(parseRules('   ')).toEqual([]);
  });

  it('junta sem duplicar (caixa e espaços não contam)', () => {
    expect(mergeRules(['Sem solda'], ['sem solda ', 'até R$ 300'])).toEqual(['Sem solda', 'até R$ 300']);
  });

  it('compara conjuntos de regras independente da ordem', () => {
    expect(sameRules(['a', 'B'], ['b', 'a'])).toBe(true);
    expect(sameRules(['a'], ['a', 'b'])).toBe(false);
  });
});

describe('ranking dos planos', () => {
  it('normaliza para 1..N com um único #1', () => {
    const out = normalizeRanks([plan('a', 2), plan('b', 2), plan('c', 7)]);
    expect(out.map((p) => [p.id, p.rank])).toEqual([
      ['a', 1],
      ['b', 2],
      ['c', 3],
    ]);
  });

  it('após "gerar mais": um só ★, empate favorece o lote antigo, novos marcados', () => {
    const prev = [plan('a', 1), plan('b', 2), plan('c', 3)];
    const incoming = [plan('x', 1), plan('y', 4), plan('z', 2)];
    const { plans, newIds } = mergePlanBatches(prev, incoming);
    expect(plans.filter((p) => p.rank === 1)).toHaveLength(1);
    expect(plans[0].id).toBe('a');
    expect(plans.map((p) => p.id)).toEqual(['a', 'x', 'b', 'z', 'c', 'y']);
    expect(plans.map((p) => p.rank)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(newIds.sort()).toEqual(['x', 'y', 'z']);
  });

  it('corta no teto de planos', () => {
    const prev = Array.from({ length: 8 }, (_, i) => plan(`p${i}`, i + 1));
    const { plans, newIds } = mergePlanBatches(prev, [plan('n1', 20), plan('n2', 21), plan('n3', 1)]);
    expect(plans).toHaveLength(MAX_PLANS);
    expect(newIds).toEqual(['n3']);
  });

  it('agrupa por estratégia, grupos na ordem do melhor rank', () => {
    const groups = groupByStrategy([
      plan('a', 3, 'do_zero'),
      plan('b', 1, 'hibrido'),
      plan('c', 2, 'do_zero'),
    ]);
    expect(groups.map((g) => g.strategy)).toEqual(['hibrido', 'do_zero']);
    expect(groups[1].plans.map((p) => p.id)).toEqual(['c', 'a']);
  });
});

describe('relógio', () => {
  it('formata m:ss', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(65_400)).toBe('1:05');
  });
});

describe('copy da tela de objetivo', () => {
  it('pt-BR sem jargão técnico ("chunks", "token", "f(X)", "AI")', () => {
    const strings: string[] = [];
    const walk = (v: unknown) => {
      if (typeof v === 'string') strings.push(v);
      else if (typeof v === 'function') {
        const out = (v as (...a: unknown[]) => unknown)('x', 'y', 'z');
        if (typeof out === 'string') strings.push(out);
      } else if (v && typeof v === 'object') Object.values(v).forEach(walk);
    };
    walk(ptBR.objective);
    walk(ptBR.apiKey);
    const text = strings.join('\n');
    expect(text).not.toMatch(/chunk|token|f\(X\)/i);
    expect(text).not.toMatch(/\bAI\b/);
  });

  it('en e pt-BR têm os mesmos exemplos', () => {
    expect(ptBR.objective.examples).toHaveLength(en.objective.examples.length);
  });
});
