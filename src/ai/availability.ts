import { useGraphStore, isDemoProject } from '@/store';
import { getActiveConfig } from '@/config/store';
import { t } from '@/i18n';

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

// Erro tipado pra UI mostrar inline/toast com CTA "Configurar chave" em vez
// do alert() nativo. `message` já vem no idioma do usuário.
export class AIUnavailableError extends Error {
  readonly reason: Exclude<AIBlockReason, null>;
  constructor(opts: { reason: Exclude<AIBlockReason, null> }) {
    const n = t().notify;
    super((opts.reason === 'demo' ? n.aiBlockedDemo : n.aiMissingKey).replace(/\.{2,}$/, '.'));
    this.name = 'AIUnavailableError';
    this.reason = opts.reason;
  }
}

// Versão sem efeito colateral: null quando a IA pode rodar.
export function checkAI(): AIUnavailableError | null {
  const reason = aiBlockReason();
  return reason ? new AIUnavailableError({ reason }) : null;
}

// Quem mostra o bloqueio. A UI registra um handler (toast com CTA) via
// setAIUnavailableHandler; sem handler, cai no alert() como antes.
type UnavailableHandler = (err: AIUnavailableError) => void;
let unavailableHandler: UnavailableHandler | null = null;

export function setAIUnavailableHandler(handler: UnavailableHandler | null): () => void {
  unavailableHandler = handler;
  return () => {
    if (unavailableHandler === handler) unavailableHandler = null;
  };
}

// Gate every AI call site with this. Notifies the user (handler or alert)
// and returns false when blocked; returns true when the AI can run.
export function requireAI(): boolean {
  const err = checkAI();
  if (!err) return true;
  if (unavailableHandler) unavailableHandler(err);
  else if (typeof window !== 'undefined') alert(err.message);
  return false;
}
