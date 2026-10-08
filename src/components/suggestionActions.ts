import { useGraphStore } from '@/store';
import type { Messages } from '@/i18n';
import { toast } from './ui/Toast';

// "Descartar todas" com desfazer: as sugestões custaram uma chamada de IA,
// então o descarte em lote ganha o mesmo toast com Desfazer que aceitar e
// confirmar já têm.
export function discardSuggestionsWithUndo(tr: Messages) {
  const st = useGraphStore.getState();
  const batch = st.pendingSuggestions;
  if (!batch) return;
  st.rejectAllSuggestions();
  toast.show({
    message: tr.tutor.suggestionsDiscarded(batch.nodes.length),
    tone: 'info',
    action: {
      label: tr.common.undo,
      onClick: () => {
        const g = useGraphStore.getState();
        const ok = g.restoreSuggestions(batch);
        if (ok) g.selectNode(batch.parentId);
        toast.show(
          ok ? { message: tr.toast.undone, tone: 'info' } : { message: tr.toast.nothingToUndo, tone: 'warn' },
        );
      },
    },
  });
}

// Quantas sugestões do lote ativo já foram aceitas uma a uma.
export const acceptedCount = (batch: { acceptedMap?: Record<string, string> } | null): number =>
  batch?.acceptedMap ? Object.keys(batch.acceptedMap).length : 0;
