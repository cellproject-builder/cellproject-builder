import { useCallback, useEffect, useRef, useState } from 'react';
import { t } from '@/i18n';
import { useGraphStore, type AIJobKind } from '@/store';

// ---------------------------------------------------------------------------
// useAIAction — um único jeito de chamar a IA a partir da UI: estado de
// carregamento, cronômetro, cancelar, erro classificado e "tentar de novo".
//
// TODO(integração): o classificador definitivo é `classifyAIError` de
// '@/ai/service' (pacote de IA). Enquanto ele não existe aqui, o tipo é
// espelhado abaixo e o fallback local cobre os casos comuns. Trocar o default
// de `classify` por `classifyAIError` e remover `fallbackClassifyAIError`.
// ---------------------------------------------------------------------------

export interface ClassifiedAIError {
  kind: 'auth' | 'credits' | 'model' | 'schema' | 'rate' | 'timeout' | 'network' | 'aborted' | 'unknown';
  title: string;
  hint: string;
  detail?: string;
}

export type AIErrorClassifier = (err: unknown) => ClassifiedAIError;

const errorText = (err: unknown): string => {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
};

const statusOf = (err: unknown): number | undefined => {
  if (!err || typeof err !== 'object') return undefined;
  const e = err as { statusCode?: unknown; status?: unknown };
  const s = e.statusCode ?? e.status;
  return typeof s === 'number' ? s : undefined;
};

// Classificação heurística por status HTTP e texto — boa o bastante para dar
// um título humano e uma dica acionável; o texto cru vai para `detail`.
export const fallbackClassifyAIError: AIErrorClassifier = (err) => {
  const detail = errorText(err);
  const text = detail.toLowerCase();
  const status = statusOf(err);
  let kind: ClassifiedAIError['kind'] = 'unknown';
  if (
    (err instanceof Error && err.name === 'AbortError') ||
    (typeof DOMException !== 'undefined' && err instanceof DOMException && err.name === 'AbortError')
  ) {
    kind = 'aborted';
  } else if (status === 401 || status === 403 || /unauthori[sz]ed|invalid api key|incorrect api key|no auth/.test(text)) {
    kind = 'auth';
  } else if (status === 402 || /insufficient|credits|quota|billing|payment/.test(text)) {
    kind = 'credits';
  } else if (status === 429 || /rate.?limit|too many requests/.test(text)) {
    kind = 'rate';
  } else if (status === 404 || /model.*(not found|does not exist|unavailable)|no endpoints/.test(text)) {
    kind = 'model';
  } else if (/no object generated|schema|json|typevalidation|parse/.test(text)) {
    kind = 'schema';
  } else if (status === 408 || status === 504 || /timeout|timed out/.test(text)) {
    kind = 'timeout';
  } else if (/failed to fetch|networkerror|network error|load failed|econn|offline/.test(text)) {
    kind = 'network';
  }
  const copy = t().app.aiError[kind];
  return { kind, title: copy.title, hint: copy.hint, detail };
};

export interface UseAIActionOptions {
  classify?: AIErrorClassifier;
  // Registra a chamada em aiJobs (store) — o carregamento sobrevive à
  // remontagem do card e outros lugares sabem que o nó está ocupado.
  job?: { nodeId: string; kind: AIJobKind } | null;
}

export interface AIActionHandle<T extends unknown[], R> {
  run: (...args: T) => Promise<R | undefined>;
  running: boolean;
  error: ClassifiedAIError | null;
  elapsedMs: number;
  cancel: () => void;
  retry: () => Promise<R | undefined>;
  reset: () => void;
}

const TICK_MS = 250;

export function useAIAction<T extends unknown[], R>(
  fn: (signal: AbortSignal, ...args: T) => Promise<R>,
  opts?: UseAIActionOptions,
): AIActionHandle<T, R> {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<ClassifiedAIError | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);

  // Refs para o run sempre usar a fn/opts mais recentes sem recriar callbacks.
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const controllerRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const runIdRef = useRef(0);
  const lastArgsRef = useRef<T | null>(null);
  const mountedRef = useRef(true);
  const activeJobRef = useRef<{ nodeId: string; kind: AIJobKind } | null>(null);

  const endActiveJob = () => {
    if (activeJobRef.current) useGraphStore.getState().endAIJob(activeJobRef.current.nodeId);
    activeJobRef.current = null;
  };

  const stopTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  };

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      // Não aborta ao desmontar: a resposta ainda deve chegar ao store (ex.:
      // sugestões em staging) mesmo se o usuário trocou de card no meio.
      mountedRef.current = false;
      stopTimer();
    };
  }, []);

  const run = useCallback(async (...args: T): Promise<R | undefined> => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const runId = ++runIdRef.current;
    lastArgsRef.current = args;
    const job = optsRef.current?.job ?? null;

    const startedAt = Date.now();
    setRunning(true);
    setError(null);
    setElapsedMs(0);
    stopTimer();
    timerRef.current = setInterval(() => {
      if (mountedRef.current) setElapsedMs(Date.now() - startedAt);
    }, TICK_MS);
    endActiveJob();
    activeJobRef.current = job;
    if (job) useGraphStore.getState().startAIJob(job.nodeId, job.kind);

    const isCurrent = () => runId === runIdRef.current;
    try {
      const result = await fnRef.current(controller.signal, ...args);
      if (controller.signal.aborted) return undefined;
      return result;
    } catch (err) {
      // Cancelado pelo usuário (ou substituído por outro run): não é erro.
      if (controller.signal.aborted) return undefined;
      const classify = optsRef.current?.classify ?? fallbackClassifyAIError;
      const classified = classify(err);
      if (classified.kind !== 'aborted' && isCurrent() && mountedRef.current) setError(classified);
      return undefined;
    } finally {
      // Run substituído/cancelado: quem o substituiu cuida do job e do timer.
      if (isCurrent()) {
        endActiveJob();
        stopTimer();
        controllerRef.current = null;
        if (mountedRef.current) {
          setRunning(false);
          setElapsedMs(Date.now() - startedAt);
        }
      }
    }
  }, []);

  const cancel = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    runIdRef.current++;
    stopTimer();
    endActiveJob();
    setRunning(false);
  }, []);

  const retry = useCallback(async () => {
    if (!lastArgsRef.current) return undefined;
    return run(...lastArgsRef.current);
  }, [run]);

  const reset = useCallback(() => {
    setError(null);
    setElapsedMs(0);
  }, []);

  return { run, running, error, elapsedMs, cancel, retry, reset };
}
