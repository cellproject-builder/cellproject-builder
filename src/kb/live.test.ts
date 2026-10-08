// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { describe, it, expect, beforeAll } from 'vitest';
import { useConfigStore, PROVIDER_DEFAULTS } from '@/config/store';
import { useLocaleStore } from '@/i18n';
import { summarizeDocument, pickRelevantDocs } from './service';
import type { KBDocument } from './types';

// Validação AO VIVO das chamadas da base contra o OpenRouter — pulada por
// padrão. Mesmo esquema de src/ai/live.test.ts:
//   LIVE_ENV_FILE=caminho/.env npx vitest run src/kb/live.test.ts
// Opcional: LIVE_KB_MODEL=openai/gpt-6.1-sol (padrão = kbModel do OpenRouter)
function readKey(): string | undefined {
  if (process.env.LIVE_OPENROUTER_KEY) return process.env.LIVE_OPENROUTER_KEY;
  const file = process.env.LIVE_ENV_FILE;
  if (!file || !existsSync(file)) return undefined;
  const line = readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .find((l) => l.startsWith('OPENROUTER='));
  return line?.slice('OPENROUTER='.length).trim().replace(/^["']|["']$/g, '') || undefined;
}
const key = readKey();
const kbModel = process.env.LIVE_KB_MODEL ?? PROVIDER_DEFAULTS.openrouter.kbModel;

const TEXT = `Guia rápido de pipas de papel. Para voar, uma pipa de papel de seda precisa de vento
entre 10 km/h e 25 km/h. A vareta central deve ter 60 cm e a transversal 50 cm, de bambu.
Use linha 10 (algodão); nunca use cerol ou linha chilena, proibidos por lei. Voe longe da
rede elétrica, a pelo menos 50 metros de fios.`;

describe.skipIf(!key)(`KB ao vivo (${kbModel})`, () => {
  beforeAll(() => {
    useLocaleStore.getState().setLocale('pt-BR');
    useConfigStore.getState().saveProviderConfig('openrouter', {
      apiKey: key!,
      ...PROVIDER_DEFAULTS.openrouter,
      kbModel,
    });
    useConfigStore.getState().setActiveProvider('openrouter');
  });

  it('summarizeDocument devolve resumo válido (strict schema)', async () => {
    const s = await summarizeDocument(TEXT);
    expect(s.titulo.length).toBeGreaterThan(0);
    expect(s.resumo.length).toBeGreaterThan(0);
    expect(['iniciante', 'intermediario', 'avancado']).toContain(s.nivel);
    // null do schema vira ausente, nunca string "null".
    expect(s.autores).not.toBe('null');
    for (const f of s.fatos) expect(f.valor === undefined || f.valor.length > 0).toBe(true);
  }, 120_000);

  it('pickRelevantDocs escolhe o doc certo', async () => {
    const mk = (id: string, titulo: string, dominio: string, tags: string[]): KBDocument => ({
      id,
      filename: `${id}.pdf`,
      sizeBytes: 1,
      pageCount: 1,
      extractedAt: 1,
      extractedText: '',
      fingerprint: id,
      summary: { titulo, dominio, tags, resumo: [titulo], fatos: [], nivel: 'iniciante' },
    });
    const picks = await pickRelevantDocs({ label: 'Objetivo: construir e empinar uma pipa' }, [
      mk('pipa', 'Guia de pipas de papel', 'pipas', ['vareta', 'vento', 'linha']),
      mk('bolo', 'Receitas de bolo de cenoura', 'culinária', ['forno', 'cenoura']),
      mk('imposto', 'Declaração de IR', 'finanças', ['receita federal']),
    ]);
    expect(picks.map((p) => p.docId)).toContain('pipa');
    expect(picks.map((p) => p.docId)).not.toContain('bolo');
  }, 120_000);
});
