import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import { signInPassword, type PasswordProvider } from './passwordAuth';
import { CloudHttpError, getCloudRuntime, type CloudRuntime } from './runtime';

interface Props { runtime: CloudRuntime; userId: string; email: string; provider?: PasswordProvider; fetcher?: typeof fetch; onResume?: () => Promise<void>; onBusyChange?: (busy: boolean) => void }
/** Reauthenticate without replacing the unlocked runtime or its unsaved documents. */
export function CloudSessionRecovery({ runtime, userId, email, provider, fetcher = fetch, onResume, onBusyChange }: Props) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const status = useSyncExternalStore(runtime.subscribe, runtime.getSnapshot);
  const password = useRef<HTMLInputElement>(null), mounted = useRef(false);
  const operation = useRef<{ controller: AbortController; promise: Promise<void> } | null>(null);
  const busyObserver = useRef(onBusyChange); busyObserver.current = onBusyChange;
  const resumeObserver = useRef(onResume); resumeObserver.current = onResume;
  const active = () => mounted.current && getCloudRuntime() === runtime;
  const run = (task: (controller: AbortController) => Promise<void>, quiet = false) => {
    if (!active()) return Promise.resolve();
    if (operation.current) return operation.current.promise;
    const controller = new AbortController();
    setBusy(true); busyObserver.current?.(true); if (!quiet) setError('');
    const promise = (async () => {
      try { await task(controller); }
      catch (reason) {
        if (mounted.current && !quiet && !controller.signal.aborted) setError(reason instanceof CloudHttpError && reason.status === 429 ? 'Muitas tentativas. Aguarde um pouco e tente novamente.' : reason instanceof CloudHttpError && reason.status === 401 ? 'Não foi possível entrar. Confira sua senha.' : 'Não foi possível retomar o acesso. Tente novamente.');
      } finally {
        if (operation.current?.controller === controller) operation.current = null;
        if (mounted.current) setBusy(false);
        busyObserver.current?.(false);
      }
    })();
    operation.current = { controller, promise }; return promise;
  };
  const continueSession = () => resumeObserver.current ? resumeObserver.current() : runtime.resumeAfterAuthentication(userId);
  const resume = (quiet = false) => run(async () => { await continueSession(); }, quiet);
  useEffect(() => {
    mounted.current = true; const field = password.current;
    return () => { mounted.current = false; if (field) field.value = ''; operation.current?.controller.abort(); busyObserver.current?.(false); };
  }, [runtime, userId]);
  useEffect(() => {
    const check = () => { if (document.visibilityState !== 'hidden' && runtime.getSnapshot().issue?.kind === 'session') void resume(true); };
    window.addEventListener('focus', check); document.addEventListener('visibilitychange', check);
    return () => { window.removeEventListener('focus', check); document.removeEventListener('visibilitychange', check); };
  }, [runtime, userId]);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!provider || operation.current || !password.current?.value) return;
    const field = password.current, secret = field.value;
    // Keep credentials out of React state and clear the native field immediately.
    field.value = '';
    void run(async controller => {
      try {
        const scopedFetch: typeof fetch = (input, init) => {
          if (!active() || controller.signal.aborted) throw new DOMException('Session recovery cancelled', 'AbortError');
          const signals = [controller.signal, AbortSignal.timeout(20000), ...(init?.signal ? [init.signal] : [])];
          return fetcher(input, { ...init, signal: AbortSignal.any(signals) });
        };
        await signInPassword(email, secret, provider, scopedFetch);
        if (active() && !controller.signal.aborted) await continueSession();
      } finally { field.value = ''; }
    });
  };
  return <section className="cloud-session-recovery" aria-label="Recuperar sessão">
    <strong>Entrar novamente</strong>
    <p role="alert">Sua sessão expirou. {status.localSaved === true && !status.localSaving && !status.localError ? 'Seus rascunhos continuam na cópia cifrada deste aparelho.' : 'Seus rascunhos continuam preservados nesta aba.'}</p>
    {provider ? <form onSubmit={submit}>
      <span className="cloud-session-email">{email}</span>
      <label>Senha<input ref={password} type="password" name="password" autoComplete="current-password" maxLength={128} required disabled={busy} onInput={() => setError('')}/></label>
      <button className="cloud-session-submit" disabled={busy}>{busy ? 'Entrando…' : 'Entrar e continuar'}</button>
    </form> : <>
      <a href="/" target="_blank" rel="noopener noreferrer">Entrar novamente em outra aba ↗</a>
      <button disabled={busy} onClick={() => void resume()}>Retomar salvamento nesta aba</button>
    </>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
