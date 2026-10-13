import { useEffect, useRef, useState } from 'react';
import { OfflineWorkspaceBusyError, waitForOfflineLease } from './offline/repository';

interface Props { issue: OfflineWorkspaceBusyError; onRetry: () => void; onRestart?: () => Promise<void> }
export function WorkspaceInUse({ issue, onRetry, onRestart }: Props) {
  const retry = useRef(onRetry); retry.current = onRetry;
  const waiter = useRef<AbortController | null>(null);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => {
    if (busy) return;
    const controller = new AbortController(); waiter.current = controller;
    void waitForOfflineLease(issue.ownerId, issue.vaultId, controller.signal).then(() => {
      if (!controller.signal.aborted) retry.current();
    }).catch(reason => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Não foi possível conferir a outra aba. Tente novamente.');
    });
    return () => { controller.abort(); if (waiter.current === controller) waiter.current = null; };
  }, [issue.ownerId, issue.vaultId, busy]);
  return <main className="cloud-entry"><section className="cloud-card" aria-label="Workspace em outra aba">
    <p className="cloud-kicker">DYNAMIC DIARY</p>
    <h1>Seus projetos estão abertos em outra aba</h1>
    <p>Continue na aba que já está aberta ou feche-a para usar esta. Os rascunhos salvos neste aparelho serão mantidos.</p>
    <p role="status">Esta aba abrirá automaticamente quando a outra for fechada.</p>
    {error && <p role="alert">{error}</p>}
    <div className="cloud-actions">
      <button className="primary" disabled={busy} onClick={() => { waiter.current?.abort(); onRetry(); }}>Tentar novamente</button>
      {onRestart && <button className="cloud-text-button" disabled={busy} onClick={() => {
        waiter.current?.abort(); setBusy(true); setError('');
        void onRestart().catch(reason => { setError(reason instanceof Error ? reason.message : 'Não foi possível voltar ao login.'); setBusy(false); });
      }}>Voltar ao login</button>}
    </div>
  </section></main>;
}
