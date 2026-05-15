import { useGraphStore, isDemoProject } from '@/store';
import { getActiveConfig } from '@/config/store';
import { useLocaleStore } from '@/i18n/store';
import { en, ptBR } from '@/i18n/messages';

export type AIBlockReason = 'demo' | 'no-key' | null;

// Returns the reason AI is unavailable, or null if it can be called.
// Demo always blocks even with a key configured — keeps the demo deterministic
// and prevents the AI from generating children with real ids alongside the
// hardcoded `demo-*` ids in the sample project.
export function aiBlockReason(): AIBlockReason {
  if (isDemoProject(useGraphStore.getState().project)) return 'demo';
  if (!getActiveConfig()) return 'no-key';
  return null;
}

// Gate every AI call site with this. Shows a friendly alert in the user's
// locale and returns false when blocked; returns true when the AI can run.
export function requireAI(): boolean {
  const reason = aiBlockReason();
  if (!reason) return true;
  const messages = useLocaleStore.getState().locale === 'pt-BR' ? ptBR : en;
  const msg = reason === 'demo' ? messages.notify.aiBlockedDemo : messages.notify.aiMissingKey;
  if (typeof window !== 'undefined') alert(msg);
  return false;
}
