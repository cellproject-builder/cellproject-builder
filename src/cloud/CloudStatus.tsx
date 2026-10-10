import { getVaultSession, vaultIsProtected } from './vault/privacy';
import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { ExclamationTriangleIcon } from '@/components/ui/SoftIcons';
import { captureLegacyBackup, downloadBackup } from './migration';
import { CloudRuntime, cloudJson, getCloudRuntime, mutationHeaders } from './runtime';
import { CloudMigration } from './CloudMigration';
import { downloadSessionRescue } from './rescue';
import { assertDataTransitionIdle } from './activity';
import { CloudSessionRecovery } from './CloudSessionRecovery';
import type { PasswordProvider } from './passwordAuth';
import { revokeOfflineAuthorization } from './offline/repository';

async function requireDataIdle() {
  const [chat, planner] = await Promise.all([import('@/chat/store'), import('@/workspace/planner')]);
  assertDataTransitionIdle(chat.useChatStore.getState().running, planner.plannerBusy());
}

/** Capture the editor owner before reading envelopes; preserve paid results and drafts. */
async function prepareCurrentData(requireIdle = false) {
  const [graph, workspace, chat, planner] = await Promise.all([import('@/store'), import('@/workspace/store'), import('@/chat/store'), import('@/workspace/planner')]);
  if (requireIdle) assertDataTransitionIdle(chat.useChatStore.getState().running, planner.plannerBusy());
  const owner = planner.getPlannerOwnerId(); if (owner) workspace.useWorkspaceStore.getState().savePlanner(owner, planner.capturePlanner());
  await graph.flushGraphPersistence(); await Promise.all([workspace.flushWorkspacePersistence(), chat.flushChatPersistence()]);
}
export async function saveCurrentBackup(cloud: CloudRuntime | null = getCloudRuntime()) {
  await requireDataIdle();
  // Even on conflict, the runtime preserves the latest full envelope in memory.
  try { await prepareCurrentData(); } catch (reason) { if (!cloud) throw reason; }
  await requireDataIdle();
  const backup = cloud ? await captureLegacyBackup({
    getDocument: async key => cloud.get(key), getPreference: key => cloud.get(key),
    getMedia: async () => { const files = []; for (const metadata of cloud.media()) { const bytes = await cloud.readMedia(metadata.id); if (!bytes) throw new Error('Arquivo remoto ausente.'); const { sha256: _hash, size: _size, ...record } = metadata; files.push({ ...record, bytes }); } return files; },
  }) : await captureLegacyBackup();
  await downloadBackup(backup);
}
export function CloudStatus({ runtime, userId, email, onLogout, onResume, passwordProvider, fetcher = fetch }: { runtime: CloudRuntime; userId: string; email: string; onLogout: () => void; onResume?: () => Promise<void>; passwordProvider?: PasswordProvider; fetcher?: typeof fetch }) {
  const status = useSyncExternalStore(runtime.subscribe, runtime.getSnapshot), [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [saved, setSaved] = useState(false), [error, setError] = useState('');
  const durable = status.localSaved === true && !status.localSaving && !status.localError;
  const needsAttention = !!status.localError || !!status.issue && (status.issue.kind !== 'network' || !durable);
  const waitingForConnection = durable && (status.offline || status.issue?.kind === 'network');
  const panelId = useId(), panelVisible = open || needsAttention;
  const statusLabel = status.localError ? 'Não foi possível salvar neste aparelho' : needsAttention ? 'Alterações sem salvar' : waitingForConnection ? 'Salvo neste aparelho · aguardando conexão' : status.localSaving ? 'Salvando neste aparelho' : status.pending ? `Salvando (${status.pending})` : 'Salvo na nuvem';
  const [rescued, setRescued] = useState(false), [missing, setMissing] = useState<number | null>(null);
  const canLeaveWithRescue = vaultIsProtected() && (!!status.issue || !!status.localError) && rescued && !status.saving;
  const canLeaveWithLocalCopy = vaultIsProtected() && durable && !status.saving;
  const [passwordLinkSent, setPasswordLinkSent] = useState(false), [sendingPasswordLink, setSendingPasswordLink] = useState(false);
  const pendingGraph = useRef<() => boolean>(() => false);
  useEffect(() => { setSaved(false); setRescued(false); }, [status]);
  useEffect(() => { let live = true; void import('@/store').then(graph => { if (live) pendingGraph.current = graph.hasPendingGraphPersistence; }); const unload = (event: BeforeUnloadEvent) => { const current = runtime.getSnapshot(); if (pendingGraph.current() || current.pending > 0 && (current.localSaved !== true || current.localSaving || current.localError)) { event.preventDefault(); event.returnValue = ''; } }; window.addEventListener('beforeunload', unload); return () => { live = false; window.removeEventListener('beforeunload', unload); }; }, [runtime]);
  async function backup() { setBusy(true); setError(''); try { await saveCurrentBackup(runtime); setSaved(true); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Falha no backup.'); } finally { setBusy(false); } }
  async function retry() {
    if (busy) return; setBusy(true); setError('');
    try { if (onResume && !runtime.getSnapshot().localError) await onResume(); else await runtime.retry(); const localError = runtime.getSnapshot().localError; if (localError) throw new Error(localError); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível retomar o salvamento.'); }
    finally { setBusy(false); }
  }
  async function leave() {
    if (busy) return; setBusy(true); setError('');
    let localRevoked = false;
    try {
      await requireDataIdle();
      if (runtime.getSnapshot().saving) throw new Error('Aguarde a tentativa de salvamento antes de sair.');
      if (!(vaultIsProtected() && (runtime.getSnapshot().issue || runtime.getSnapshot().localError) && rescued)) {
        await prepareCurrentData(true);
        const current = runtime.getSnapshot();
        if (!(vaultIsProtected() && current.localSaved === true && !current.localSaving && !current.localError)) await runtime.flush();
        await requireDataIdle();
      }
      await revokeOfflineAuthorization();
      localRevoked = true;
      await cloudJson('/api/auth/logout', { method: 'POST', headers: mutationHeaders, body: '{}' }, fetcher);
      runtime.dispose(); onLogout();
    } catch (reason) { setError(`${reason instanceof Error ? reason.message : 'Não foi possível encerrar a sessão. Tente novamente.'}${localRevoked ? ' A abertura offline deste navegador já foi revogada. Seus rascunhos continuam nesta sessão.' : ''}`); }
    finally { setBusy(false); }
  }
  return <aside className={`cloud-status ${needsAttention ? 'has-error' : waitingForConnection ? 'is-offline' : status.pending || status.localSaving ? 'is-saving' : ''} ${panelVisible ? 'is-open' : ''}`} aria-label="Persistência na nuvem">
    <button className="cloud-status-indicator" onClick={() => setOpen(value => !value)} aria-label={statusLabel} title={statusLabel} aria-expanded={panelVisible} aria-controls={panelId}>
      {needsAttention ? <ExclamationTriangleIcon width={12} height={12} aria-hidden="true"/> : <span className="cloud-status-dot" aria-hidden="true"/>}
    </button>
    {panelVisible && <div className="cloud-status-panel" id={panelId}>
      {status.issue?.kind === 'session' ? <CloudSessionRecovery key={`${userId}:${email}`} runtime={runtime} userId={userId} email={email} provider={passwordProvider} fetcher={fetcher} onResume={onResume} onBusyChange={setBusy}/> : <strong>{email}</strong>}
      {status.localError && <p role="alert">{status.localError} Mantenha esta aba aberta até salvar no aparelho ou baixar um resgate.</p>}
      {status.issue && status.issue.kind !== 'session' && !waitingForConnection && <p role="alert">{status.issue.message} {durable ? 'Seu rascunho continua na cópia cifrada deste aparelho.' : 'Seu trabalho atual continua nesta sessão.'}</p>}
      {waitingForConnection && <p role="status">Salvo na cópia cifrada deste aparelho. A sincronização com a nuvem aguarda conexão e confirmação da conta.</p>}
      {(status.localError || status.issue?.kind === 'network') && <button disabled={busy} onClick={() => void retry()}>Tentar salvar novamente</button>}
      <details className="cloud-status-advanced"><summary>Mais opções</summary><div>
      {vaultIsProtected() && <p>Seus dados estão protegidos. Sair revoga a abertura offline deste navegador e preserva os rascunhos cifrados. Use sua senha para entrar.</p>}
      <p>{status.localSaved !== undefined ? 'A cópia cifrada neste aparelho preserva os rascunhos confirmados localmente. Salvo na nuvem indica confirmação do servidor.' : 'Dados remotos são a fonte principal. Rascunhos sem confirmação ficam somente na memória desta aba.'}</p>
      <button disabled={busy} onClick={() => {
        setBusy(true); setSendingPasswordLink(true); setError(''); setPasswordLinkSent(false);
        void cloudJson('/api/auth/password/setup-link', { method: 'POST', headers: mutationHeaders, body: JSON.stringify({ email }) }, fetcher).then(() => setPasswordLinkSent(true)).catch(() => setError('Não foi possível enviar o link de senha. Tente novamente em instantes.')).finally(() => { setBusy(false); setSendingPasswordLink(false); });
      }}>{sendingPasswordLink ? 'Enviando link de senha…' : 'Criar ou alterar senha'}</button>
      {passwordLinkSent && <p role="status">Abra o link enviado para seu e-mail neste navegador para criar ou alterar a senha. Depois, entre diretamente com ela.</p>}
      <button disabled={busy} onClick={() => void backup()}>{busy && !sendingPasswordLink ? 'Preparando backup…' : 'Baixar cópia completa desta sessão'}</button>
      {(status.issue || status.localError) && <><button disabled={busy} onClick={() => {
        setBusy(true); setError('');
        void requireDataIdle().then(() => prepareCurrentData().catch(() => {})).then(requireDataIdle).then(() => downloadSessionRescue(runtime)).then(rescue => { setRescued(true); setMissing(rescue.missingMediaIds.length); }).catch(reason => setError(reason instanceof Error ? reason.message : 'Falha no resgate.')).finally(() => setBusy(false));
      }}>Baixar rascunhos de resgate ({vaultIsProtected() ? '.ddvault' : '.json'})</button><p>O resgate preserva os documentos e arquivos já lidos nesta aba. Os demais arquivos ficam identificados pelos IDs; este pacote é parcial e requer recuperação manual.</p>{missing !== null && <p role="status">Resgate baixado: {missing} arquivo(s) original(is) ainda precisam ser recuperados da nuvem.</p>}<button disabled={(!saved && !rescued) || busy} onClick={() => void requireDataIdle().then(() => window.location.reload()).catch(reason => setError(reason.message))}>{saved ? 'Reabrir dados remotos após baixar cópia' : 'Reabrir após baixar resgate parcial'}</button></>}
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
