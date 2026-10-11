import { getVaultSession, vaultIsProtected } from './vault/privacy';
import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { CloseIcon, ExclamationTriangleIcon } from '@/components/ui/SoftIcons';
import { captureLegacyBackup, downloadBackup } from './migration';
import { CloudRuntime, cloudJson, getCloudRuntime, mutationHeaders } from './runtime';
import { CloudMigration } from './CloudMigration';
import { downloadSessionRescue } from './rescue';
import { assertDataTransitionIdle } from './activity';
import { CloudSessionRecovery } from './CloudSessionRecovery';
import type { PasswordProvider } from './passwordAuth';
import { revokeOfflineAuthorization } from './offline/repository';
import { acknowledgeDeferredPersistenceCapture, captureDeferredPersistence, flushDeferredPersistences, getDeferredPersistenceSnapshot, hasDeferredPersistence, isDeferredPersistenceCaptureCurrent, subscribeDeferredPersistence, type DeferredPersistenceCapture } from '@/data/selectiveJSONStorage';

function assertPersistenceOwner(owner: CloudRuntime | null) {
  if (getCloudRuntime() !== owner) throw new Error('A sessão de persistência mudou. Preserve o rascunho antes de continuar.');
}
const runtimeDataSignature = (runtime: CloudRuntime) => JSON.stringify({ documents: runtime.documents(), media: runtime.media() });
function assertCapturedRuntimeData(runtime: CloudRuntime, signature: string) {
  assertPersistenceOwner(runtime);
  if (runtimeDataSignature(runtime) !== signature) throw new Error('Os dados mudaram durante a operação. Seus rascunhos continuam nesta aba; baixe uma nova cópia antes de sair.');
}
async function graphPersistenceGuard() {
  const graph = await import('@/store');
  return () => {
    if (graph.hasPendingGraphPersistence()) throw new Error('Há alterações do plano que ainda não entraram na cópia. Mantenha esta aba aberta e tente salvar novamente.');
  };
}

async function requireDataIdle() {
  const [chat, planner] = await Promise.all([import('@/chat/store'), import('@/workspace/planner')]);
  assertDataTransitionIdle(chat.useChatStore.getState().running, planner.plannerBusy());
}

/** Capture the editor owner before reading envelopes; preserve paid results and drafts. */
async function prepareCurrentData(requireIdle = false) {
  const persistenceOwner = getCloudRuntime();
  const [graph, workspace, chat, planner] = await Promise.all([import('@/store'), import('@/workspace/store'), import('@/chat/store'), import('@/workspace/planner')]);
  assertPersistenceOwner(persistenceOwner);
  if (requireIdle) assertDataTransitionIdle(chat.useChatStore.getState().running, planner.plannerBusy());
  const owner = planner.getPlannerOwnerId(); if (owner) workspace.useWorkspaceStore.getState().savePlanner(owner, planner.capturePlanner());
  // Workspace flush owns the only deferred adapter. Try every document even if
  // another checkpoint fails, so a rescue can read each latest runtime draft.
  const results = await Promise.allSettled([graph.flushGraphPersistence(), workspace.flushWorkspacePersistence(), chat.flushChatPersistence()]);
  assertPersistenceOwner(persistenceOwner);
  const failure = results.find(result => result.status === 'rejected');
  if (failure?.status === 'rejected') throw failure.reason;
}
export async function saveCurrentBackup(cloud: CloudRuntime | null = getCloudRuntime()) {
  assertPersistenceOwner(cloud);
  await requireDataIdle();
  assertPersistenceOwner(cloud);
  const assertGraphSaved = await graphPersistenceGuard();
  assertPersistenceOwner(cloud);
  // Even on conflict, the runtime preserves the latest full envelope in memory.
  try { await prepareCurrentData(); } catch (reason) { if (!cloud) throw reason; }
  assertPersistenceOwner(cloud);
  await requireDataIdle();
  assertPersistenceOwner(cloud);
  assertGraphSaved();
  const captured = cloud ? captureDeferredPersistence(cloud, key => cloud.get(key)) : captureDeferredPersistence(null, () => null);
  if (!captured) throw new Error('Há alterações recentes fora da cópia de segurança. Tente salvar novamente antes de exportar.');
  const runtimeData = cloud ? runtimeDataSignature(cloud) : undefined;
  const backup = cloud ? await captureLegacyBackup({
    getDocument: async key => cloud.get(key), getPreference: key => cloud.get(key),
    getMedia: async () => { const files = []; for (const metadata of cloud.media()) { const bytes = await cloud.readMedia(metadata.id); if (!bytes) throw new Error('Arquivo remoto ausente.'); const { sha256: _hash, size: _size, ...record } = metadata; files.push({ ...record, bytes }); } return files; },
  }) : await captureLegacyBackup();
  assertGraphSaved();
  assertPersistenceOwner(cloud);
  if (cloud) assertCapturedRuntimeData(cloud, runtimeData!);
  if (!isDeferredPersistenceCaptureCurrent(captured)) throw new Error('Os dados mudaram durante a preparação da cópia. Exporte novamente.');
  await downloadBackup(backup);
  assertGraphSaved();
  assertPersistenceOwner(cloud);
  if (cloud) assertCapturedRuntimeData(cloud, runtimeData!);
  if (!isDeferredPersistenceCaptureCurrent(captured)) throw new Error('Os dados mudaram durante a preparação da cópia. Exporte novamente.');
}
export function CloudStatus({ runtime, userId, email, onLogout, onResume, passwordProvider, fetcher = fetch }: { runtime: CloudRuntime; userId: string; email: string; onLogout: () => void; onResume?: () => Promise<void>; passwordProvider?: PasswordProvider; fetcher?: typeof fetch }) {
  const status = useSyncExternalStore(runtime.subscribe, runtime.getSnapshot), [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [saved, setSaved] = useState(false), [error, setError] = useState('');
  const deferred = useSyncExternalStore(subscribeDeferredPersistence, getDeferredPersistenceSnapshot);
  const durable = status.localSaved === true && !status.localSaving && !status.localError;
  const needsAttention = !!deferred.error || !!status.localError || !!status.issue && (status.issue.kind !== 'network' || !durable);
  const waitingForConnection = durable && (status.offline || status.issue?.kind === 'network');
  const [dismissed, setDismissed] = useState<{ runtime: CloudRuntime; key: string } | null>(null);
  // Polling can report the same session issue through different API paths.
  // Only a new problem should reopen an explicitly minimized warning.
  const attentionKey = needsAttention ? JSON.stringify([status.localError ?? null, status.issue?.kind ?? null, status.issue?.kind === 'session' ? null : status.issue?.key ?? null, status.issue?.message ?? null, deferred.error ? deferred.revision : null]) : null;
  const indicator = useRef<HTMLButtonElement>(null);
  const panelId = useId(), panelVisible = open || !!attentionKey && (dismissed?.runtime !== runtime || dismissed.key !== attentionKey);
  const dismiss = (restoreFocus = false) => { setOpen(false); setDismissed(attentionKey ? { runtime, key: attentionKey } : null); if (restoreFocus) indicator.current?.focus(); };
  const statusLabel = status.localError ? 'Não foi possível salvar neste aparelho' : needsAttention ? 'Alterações sem salvar' : deferred.pending ? 'Salvando alterações recentes' : waitingForConnection ? 'Salvo neste aparelho · aguardando conexão' : status.localSaving ? 'Salvando neste aparelho' : status.pending ? `Salvando (${status.pending})` : 'Salvo na nuvem';
  const [rescued, setRescued] = useState(false), [missing, setMissing] = useState<number | null>(null);
  const rescueCapture = useRef<DeferredPersistenceCapture>();
  const rescueRuntimeData = useRef<string>();
  const canLeaveWithRescue = vaultIsProtected() && (!!status.issue || !!status.localError) && rescued && !!rescueCapture.current && isDeferredPersistenceCaptureCurrent(rescueCapture.current) && !status.saving;
  const canLeaveWithLocalCopy = vaultIsProtected() && durable && !status.saving;
  const [passwordLinkSent, setPasswordLinkSent] = useState(false), [sendingPasswordLink, setSendingPasswordLink] = useState(false);
  const pendingGraph = useRef<() => boolean>(() => false);
  useEffect(() => { if (!attentionKey) setDismissed(null); }, [attentionKey]);
  useEffect(() => { setSaved(false); setRescued(false); rescueCapture.current = undefined; rescueRuntimeData.current = undefined; }, [status, deferred.revision]);
  useEffect(() => { let live = true; void import('@/store').then(graph => { if (live) pendingGraph.current = graph.hasPendingGraphPersistence; }); const unload = (event: BeforeUnloadEvent) => { const current = runtime.getSnapshot(); if (pendingGraph.current() || hasDeferredPersistence() || current.pending > 0 && (current.localSaved !== true || current.localSaving || current.localError)) { event.preventDefault(); event.returnValue = ''; } }; window.addEventListener('beforeunload', unload); return () => { live = false; window.removeEventListener('beforeunload', unload); }; }, [runtime]);
  async function backup() { setBusy(true); setError(''); try { await saveCurrentBackup(runtime); setSaved(true); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Falha no backup.'); } finally { setBusy(false); } }
  async function retry() {
    if (busy) return; setBusy(true); setError('');
    try { if (onResume && !runtime.getSnapshot().localError) await onResume(); else await runtime.retry(); await flushDeferredPersistences(); const localError = runtime.getSnapshot().localError; if (localError) throw new Error(localError); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível retomar o salvamento.'); }
    finally { setBusy(false); }
  }
  async function leave() {
    if (busy) return; setBusy(true); setError('');
    let localRevoked = false;
    try {
      assertPersistenceOwner(runtime);
      await requireDataIdle();
      assertPersistenceOwner(runtime);
      const assertGraphSaved = await graphPersistenceGuard();
      assertPersistenceOwner(runtime);
      if (runtime.getSnapshot().saving) throw new Error('Aguarde a tentativa de salvamento antes de sair.');
      const usingRescue = vaultIsProtected() && (runtime.getSnapshot().issue || runtime.getSnapshot().localError) && rescued;
      let captured: DeferredPersistenceCapture | undefined;
      let runtimeData: string;
      if (usingRescue) {
        captured = rescueCapture.current;
        if (!captured || !isDeferredPersistenceCaptureCurrent(captured)) throw new Error('Os dados mudaram após o resgate. Baixe um novo resgate antes de sair.');
        if (!rescueRuntimeData.current) throw new Error('Baixe um novo resgate antes de sair.');
        runtimeData = rescueRuntimeData.current;
      } else {
        await prepareCurrentData(true);
        assertPersistenceOwner(runtime);
        const current = runtime.getSnapshot();
        if (!(vaultIsProtected() && current.localSaved === true && !current.localSaving && !current.localError)) await runtime.flush();
        assertPersistenceOwner(runtime);
        await requireDataIdle();
        assertPersistenceOwner(runtime);
        captured = captureDeferredPersistence(runtime, key => runtime.get(key));
        if (!captured) throw new Error('Há alterações recentes sem confirmação. Salve ou baixe um resgate antes de sair.');
        runtimeData = runtimeDataSignature(runtime);
      }
      assertGraphSaved();
      assertCapturedRuntimeData(runtime, runtimeData);
      await revokeOfflineAuthorization();
      localRevoked = true;
      assertGraphSaved();
      assertCapturedRuntimeData(runtime, runtimeData);
      if (!isDeferredPersistenceCaptureCurrent(captured)) throw new Error('Os dados mudaram antes de sair. Salve ou baixe um novo resgate.');
      await cloudJson('/api/auth/logout', { method: 'POST', headers: mutationHeaders, body: '{}' }, fetcher);
      assertGraphSaved();
      assertCapturedRuntimeData(runtime, runtimeData);
      await requireDataIdle();
      assertGraphSaved();
      assertCapturedRuntimeData(runtime, runtimeData);
      if (!acknowledgeDeferredPersistenceCapture(captured)) throw new Error('Os dados mudaram durante a saída. Seus rascunhos continuam nesta aba; baixe um novo resgate.');
      runtime.dispose(); onLogout();
    } catch (reason) { setError(`${reason instanceof Error ? reason.message : 'Não foi possível encerrar a sessão. Tente novamente.'}${localRevoked ? ' A abertura offline deste navegador já foi revogada. Seus rascunhos continuam nesta sessão.' : ''}`); }
    finally { setBusy(false); }
  }
  async function rescueDrafts() {
    setBusy(true); setError('');
    try {
      assertPersistenceOwner(runtime);
      await requireDataIdle();
      assertPersistenceOwner(runtime);
      const assertGraphSaved = await graphPersistenceGuard();
      assertPersistenceOwner(runtime);
      await prepareCurrentData().catch(() => {});
      assertPersistenceOwner(runtime);
      await requireDataIdle();
      assertPersistenceOwner(runtime);
      assertGraphSaved();
      const captured = captureDeferredPersistence(runtime, key => runtime.get(key));
      if (!captured) throw new Error('Há alterações recentes que ainda não entraram no resgate. Tente salvar novamente antes de baixar.');
      const runtimeData = runtimeDataSignature(runtime);
      const rescue = await downloadSessionRescue(runtime);
      assertGraphSaved();
      assertCapturedRuntimeData(runtime, runtimeData);
      if (!isDeferredPersistenceCaptureCurrent(captured)) throw new Error('Os dados mudaram durante o resgate. Baixe um novo resgate antes de sair.');
      rescueCapture.current = captured; rescueRuntimeData.current = runtimeData; setRescued(true); setMissing(rescue.missingMediaIds.length);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Falha no resgate.'); }
    finally { setBusy(false); }
  }
  return <aside className={`cloud-status ${needsAttention ? 'has-error' : deferred.pending ? 'is-saving' : waitingForConnection ? 'is-offline' : status.pending || status.localSaving ? 'is-saving' : ''} ${panelVisible ? 'is-open' : ''}`} aria-label="Persistência na nuvem">
    <button ref={indicator} className="cloud-status-indicator" onClick={() => panelVisible ? dismiss() : setOpen(true)} aria-label={statusLabel} title={statusLabel} aria-expanded={panelVisible} aria-controls={panelId}>
      {needsAttention ? <ExclamationTriangleIcon width={12} height={12} aria-hidden="true"/> : <span className="cloud-status-dot" aria-hidden="true"/>}
    </button>
    {panelVisible && <div className="cloud-status-panel" id={panelId} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); dismiss(true); } }}>
      <button className="cloud-status-close" aria-label="Fechar aviso de sincronização" onClick={() => dismiss(true)}><CloseIcon width={14} height={14}/>Fechar aviso</button>
      {status.issue?.kind === 'session' ? <CloudSessionRecovery key={`${userId}:${email}`} runtime={runtime} userId={userId} email={email} provider={passwordProvider} fetcher={fetcher} onResume={onResume} onBusyChange={setBusy}/> : <strong>{email}</strong>}
      {status.localError && <p role="alert">{status.localError} Mantenha esta aba aberta até salvar no aparelho ou baixar um resgate.</p>}
      {!!deferred.error && !status.localError && <p role="alert">Não foi possível salvar as alterações recentes. Tente novamente antes de sair.</p>}
      {status.issue && status.issue.kind !== 'session' && !waitingForConnection && <p role="alert">{status.issue.message} {durable ? 'Seu rascunho continua na cópia cifrada deste aparelho.' : 'Seu trabalho atual continua nesta sessão.'}</p>}
      {waitingForConnection && <p role="status">Salvo na cópia cifrada deste aparelho. A sincronização com a nuvem aguarda conexão e confirmação da conta.</p>}
      {(!!deferred.error || status.localError || status.issue?.kind === 'network' || status.issue?.kind === 'conflict') && <button disabled={busy} onClick={() => void retry()}>{status.issue?.kind === 'conflict' && !status.localError ? 'Conciliar alterações' : 'Tentar salvar novamente'}</button>}
      <details className="cloud-status-advanced"><summary>Mais opções</summary><div>
      {vaultIsProtected() && <p>Seus dados estão protegidos. Sair revoga a abertura offline deste navegador e preserva os rascunhos cifrados. Use sua senha para entrar.</p>}
      <p>{status.localSaved !== undefined ? 'A cópia cifrada neste aparelho preserva os rascunhos confirmados localmente. Salvo na nuvem indica confirmação do servidor.' : 'Dados remotos são a fonte principal. Rascunhos sem confirmação ficam somente na memória desta aba.'}</p>
      <button disabled={busy} onClick={() => {
        setBusy(true); setSendingPasswordLink(true); setError(''); setPasswordLinkSent(false);
        void cloudJson('/api/auth/password/setup-link', { method: 'POST', headers: mutationHeaders, body: JSON.stringify({ email }) }, fetcher).then(() => setPasswordLinkSent(true)).catch(() => setError('Não foi possível enviar o link de senha. Tente novamente em instantes.')).finally(() => { setBusy(false); setSendingPasswordLink(false); });
      }}>{sendingPasswordLink ? 'Enviando link de senha…' : 'Criar ou alterar senha'}</button>
      {passwordLinkSent && <p role="status">Abra o link enviado para seu e-mail neste navegador para criar ou alterar a senha. Depois, entre diretamente com ela.</p>}
      <button disabled={busy} onClick={() => void backup()}>{busy && !sendingPasswordLink ? 'Preparando backup…' : 'Baixar cópia completa desta sessão'}</button>
      {(status.issue || status.localError || !!deferred.error) && <><button disabled={busy} onClick={() => void rescueDrafts()}>Baixar rascunhos de resgate ({vaultIsProtected() ? '.ddvault' : '.json'})</button><p>O resgate preserva os documentos e arquivos já lidos nesta aba. Os demais arquivos ficam identificados pelos IDs; este pacote é parcial e requer recuperação manual.</p>{missing !== null && <p role="status">Resgate baixado: {missing} arquivo(s) original(is) ainda precisam ser recuperados da nuvem.</p>}<button disabled={(!saved && !rescued) || busy} onClick={() => void requireDataIdle().then(() => window.location.reload()).catch(reason => setError(reason.message))}>{saved ? 'Reabrir dados remotos após baixar cópia' : 'Reabrir após baixar resgate parcial'}</button></>}
      <button disabled={busy || !!status.pending && !canLeaveWithRescue && !canLeaveWithLocalCopy} onClick={() => void leave()}>{vaultIsProtected() ? canLeaveWithRescue ? 'Sair após baixar resgate' : 'Sair e bloquear' : 'Sair da conta'}</button>
      </div></details>
      {error && <p role="alert">{error}</p>}
    </div>}
  </aside>;
}
export function CloudDataControls() {
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [importing, setImporting] = useState(false);
  const cloud = getCloudRuntime();
  return <section><h3>Dados e backup</h3><p className="text-control text-text-secondary">Backup completo: planos, chat, documentos e arquivos. {getVaultSession() ? 'O arquivo .ddvault é criptografado com a chave do cofre.' : 'O arquivo .zip é legível; guarde em local privado.'} As chaves de IA ficam de fora.</p><div className="cloud-actions"><button className="ws-button" disabled={busy} onClick={() => { setBusy(true); setError(''); void saveCurrentBackup().catch(reason => setError(reason instanceof Error ? reason.message : 'Falha no backup.')).finally(() => setBusy(false)); }}>{busy ? 'Preparando…' : 'Exportar backup global'}</button>
    {cloud && <button className="ws-button" disabled={busy} onClick={() => { setBusy(true); setError(''); void prepareCurrentData(true).then(() => cloud.flush()).then(() => saveCurrentBackup(cloud)).then(() => setImporting(true)).catch(reason => setError(reason.message)).finally(() => setBusy(false)); }}>Baixar cópia atual e importar backup</button>}</div>{getVaultSession() && <p className="text-control text-text-secondary">Para recuperar a senha pelo e-mail, use um aparelho já autorizado. Sem a senha e sem esse aparelho, os dados privados não podem ser recuperados.</p>}{error && <p role="alert">{error}</p>}
    {importing && cloud && <div className="cloud-import-overlay" role="dialog" aria-modal="true" aria-label="Importar backup global"><CloudMigration backup={null} snapshot={{ documents: cloud.documents(), media: cloud.media() }} onContinue={() => setImporting(false)} onDone={() => window.location.reload()}/></div>}
  </section>;
}
