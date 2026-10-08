import { useGraphStore } from '@/store';
import type { Messages } from '@/i18n';
import { toast } from './ui/Toast';

// Toda decisão sobre sugestões (aceitar uma, aceitar todas, descartar uma,
// descartar todas) ganha toast com Desfazer — as sugestões custaram uma
// chamada de IA, e o confirmar/já sei já se desfazem do mesmo jeito.

function undoneToast(ok: boolean, tr: Messages) {
  toast.show(ok ? { message: tr.toast.undone, tone: 'info' } : { message: tr.toast.nothingToUndo, tone: 'warn' });
}

// Aceita (uma, ou todas com tempId null) e oferece desfazer: os nós criados
// saem e as sugestões voltam ao lote.
export function acceptSuggestionsWithUndo(tr: Messages, tempId: string | null = null) {
  const st = useGraphStore.getState();
  const before = st.pendingSuggestions;
  const project = st.project;
  if (!before || !project) return;
  const parentBefore = project.nodes[before.parentId];
  if (!parentBefore) return;
  const tempIds = tempId ? [tempId] : before.nodes.map((n) => n.tempId);
  const prevIds = new Set(Object.keys(project.nodes));
  if (tempId) st.acceptSuggestion(tempId);
  else st.acceptAllSuggestions();
  const after = useGraphStore.getState();
  const created = Object.keys(after.project?.nodes ?? {}).filter((id) => !prevIds.has(id));
  if (created.length === 0) return;
  // tempId → id real, casando pelo nome (os nós aceitos não guardam o tempId).
  const added: Record<string, string> = {};
  const free = new Set(created);
  for (const tid of tempIds) {
    const nm = before.nodes.find((n) => n.tempId === tid)?.data.name;
    const hit = [...free].find((id) => after.project?.nodes[id]?.name === nm) ?? [...free][0];
    if (!hit) break;
    added[tid] = hit;
    free.delete(hit);
  }
  const name = tempId ? before.nodes.find((n) => n.tempId === tempId)?.data.name ?? '' : '';
  toast.show({
    message: tempId ? tr.tutor.suggestionAccepted(name) : tr.tutor.suggestionsAccepted(tempIds.length),
    tone: 'ok',
    action: {
      label: tr.common.undo,
      onClick: () => undoneToast(useGraphStore.getState().undoAcceptSuggestions(before, added, parentBefore), tr),
    },
  });
}

// ✕ numa sugestão, com desfazer.
export function rejectSuggestionWithUndo(tr: Messages, tempId: string) {
  const st = useGraphStore.getState();
  const before = st.pendingSuggestions;
  if (!before) return;
  const name = before.nodes.find((n) => n.tempId === tempId)?.data.name ?? '';
  st.rejectSuggestion(tempId);
  toast.show({
    message: tr.tutor.suggestionDiscarded(name),
    tone: 'info',
    action: {
      label: tr.common.undo,
      onClick: () => {
        const g = useGraphStore.getState();
        const ok = g.reinstateSuggestions(before, [tempId]);
        if (ok) g.selectNode(before.parentId);
        undoneToast(ok, tr);
      },
    },
  });
}

// "Descartar todas" com desfazer.
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
        undoneToast(ok, tr);
      },
    },
  });
}

// Quantas sugestões do lote ativo já foram aceitas uma a uma.
export const acceptedCount = (batch: { acceptedMap?: Record<string, string> } | null): number =>
  batch?.acceptedMap ? Object.keys(batch.acceptedMap).length : 0;

// Tamanho do lote como a IA propôs (aceitas + descartadas + restantes).
export const originalBatchCount = (
  batch: { nodes: unknown[]; acceptedMap?: Record<string, string>; originalCount?: number } | null,
): number => (batch ? batch.originalCount ?? batch.nodes.length + acceptedCount(batch) : 0);
