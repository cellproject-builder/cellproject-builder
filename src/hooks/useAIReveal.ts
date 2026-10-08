import { useEffect, useState } from 'react';
import { aiRevealGraceEnd, canRevealAICriterion } from '@/store';
import type { ConceptNodeData } from '@/types';

// Critério da IA revelado só depois do lock E do fim da janela de desfazer.
// Mesma regra em todo lugar que mostra o critério (tutor, painel, grafo,
// modo leitura) — nenhuma tela fura o "critério do usuário antes".
export function useAIReveal(
  node: Pick<ConceptNodeData, 'comoConfirmarUsuarioAt' | 'confirmado' | 'takenAsKnown'>,
): { revealed: boolean; remainingMs: number } {
  const graceEnd = aiRevealGraceEnd(node);
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    if (graceEnd <= Date.now()) return;
    setClock(Date.now());
    const timer = setInterval(() => {
      const t = Date.now();
      setClock(t);
      if (t >= graceEnd) clearInterval(timer);
    }, 250);
    return () => clearInterval(timer);
  }, [graceEnd]);
  const remainingMs = Math.max(0, graceEnd - clock);
  return { revealed: canRevealAICriterion(node) && remainingMs === 0, remainingMs };
}
