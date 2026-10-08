import { useMemo } from 'react';
import { useGraphStore, reviewingParentIds } from '@/store';

// Pais com sugestões da IA em revisão (lote ativo + estacionados). Os
// contadores de progresso usam o mesmo conjunto que o tutor usa para escolher
// o "próximo pendente" — um pai com sugestões pendentes nunca conta resolvido.
export function useReviewingParents(): ReadonlySet<string> {
  const pending = useGraphStore((s) => s.pendingSuggestions);
  const parked = useGraphStore((s) => s.parkedSuggestions);
  return useMemo(() => reviewingParentIds(pending, parked), [pending, parked]);
}
