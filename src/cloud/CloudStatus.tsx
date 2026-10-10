import { getVaultSession, vaultIsProtected } from './vault/privacy';
import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { ExclamationTriangleIcon } from '@radix-ui/react-icons';
import { captureLegacyBackup, downloadBackup } from './migration';
import { CloudRuntime, cloudJson, getCloudRuntime, mutationHeaders } from './runtime';
import { CloudMigration } from './CloudMigration';
import { downloadSessionRescue } from './rescue';
import { assertDataTransitionIdle } from './activity';

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
export function CloudStatus({ runtime, userId, email, onLogout }: { runtime: CloudRuntime; userId: string; email: string; onLogout: () => void }) {
  const status = useSyncExternalStore(runtime.subscribe, runtime.getSnapshot), [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [saved, setSaved] = useState(false), [error, setError] = useState('');
  const panelId = useId(), panelVisible = open || !!status.issue;
  const statusLabel = status.issue ? 'Alterações sem salvar' : status.pending ? `Salvando (${status.pending})` : 'Salvo na nuvem';
  const [rescued, setRescued] = useState(false), [missing, setMissing] = useState<number | null>(null);
  const [passwordLinkSent, setPasswordLinkSent] = useState(false), [sendingPasswordLink, setSendingPasswordLink] = useState(false);
  const pendingGraph = useRef<() => boolean>(() => false);
  useEffect(() => { setSaved(false); setRescued(false); }, [status]);
  useEffect(() => { let live = true; void import('@/store').then(graph => { if (live) pendingGraph.current = graph.hasPendingGraphPersistence; }); const unload = (event: BeforeUnloadEvent) => { if (runtime.getSnapshot().pending || pendingGraph.current()) { event.preventDefault(); event.returnValue = ''; } }; window.addEventListener('beforeunload', unload); return () => { live = false; window.removeEventListener('beforeunload', unload); }; }, [runtime]);
  async function backup() { setBusy(true); setError(''); try { await saveCurrentBackup(runtime); setSaved(true); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Falha no backup.'); } finally { setBusy(false); } }
  return <aside className={`cloud-status ${status.issue ? 'has-error' : status.pending ? 'is-saving' : ''} ${panelVisible ? 'is-open' : ''}`} aria-label="Persistência na nuvem">
    <button className="cloud-status-indicator" onClick={() => setOpen(value => !value)} aria-label={statusLabel} title={statusLabel} aria-expanded={panelVisible} aria-controls={panelId}>
      {status.issue ? <ExclamationTriangleIcon width={12} height={12} aria-hidden="true"/> : <span className="cloud-status-dot" aria-hidden="true"/>}
    </button>
    {panelVisible && <div className="cloud-status-panel" id={panelId}><strong>{email}</strong>
      {status.issue && <><p role="alert">{status.issue.message} Seu trabalho atual continua nesta sessão.</p><small>{status.issue.key}</small></>}
      {vaultIsProtected() && <><p>Cofre aberto neste dispositivo. Armazenamento criptografado; IA recebe somente o contexto que você autorizar compartilhar.</p><button disabled={busy} onClick={() => {
        setBusy(true); setError('');
        void requireDataIdle().then(async () => {
          if (runtime.getSnapshot().issue && rescued) { runtime.dispose(); window.location.reload(); return; }
          await prepareCurrentData(true); await runtime.flush(); await requireDataIdle(); runtime.dispose(); window.location.reload();
        }).catch(() => setError('Antes de bloquear, conclua os processos. Se o salvamento falhou, baixe o resgate criptografado e bloqueie novamente.')).finally(() => setBusy(false));
      }}>{status.issue && rescued ? 'Bloquear após baixar resgate' : 'Bloquear cofre'}</button></>}
      <p>Dados remotos são a fonte principal. Rascunhos sem confirmação ficam somente na memória desta aba.</p>
      <button disabled={busy} onClick={() => {
        setBusy(true); setSendingPasswordLink(true); setError(''); setPasswordLinkSent(false);
        void cloudJson('/api/auth/password/setup-link', { method: 'POST', headers: mutationHeaders, body: JSON.stringify({ email }) }).then(() => setPasswordLinkSent(true)).catch(() => setError('Não foi possível enviar o link de senha. Tente novamente em instantes.')).finally(() => { setBusy(false); setSendingPasswordLink(false); });
      }}>{sendingPasswordLink ? 'Enviando link de senha…' : 'Criar ou alterar senha'}</button>
      {passwordLinkSent && <p role="status">Abra o link enviado para seu e-mail neste navegador para criar ou alterar a senha. Depois, entre diretamente com ela.</p>}
      {status.issue?.kind === 'network' && <button onClick={() => void runtime.retry()}>Tentar salvar novamente</button>}
      {status.issue?.kind === 'session' && <><a href="/" target="_blank" rel="noopener noreferrer">Entrar novamente em outra aba ↗</a><p>Mantenha esta aba aberta. Conclua o acesso na outra aba e depois retome aqui; seus rascunhos não serão substituídos.</p><button disabled={busy} onClick={() => { setBusy(true); setError(''); void runtime.resumeAfterAuthentication(userId).catch(reason => setError(reason instanceof Error ? reason.message : 'Não foi possível retomar.')).finally(() => setBusy(false)); }}>Retomar salvamento nesta aba</button></>}
      <button disabled={busy} onClick={() => void backup()}>{busy && !sendingPasswordLink ? 'Preparando backup…' : 'Baixar cópia completa desta sessão'}</button>
      {status.issue && <><button disabled={busy} onClick={() => {
        setBusy(true); setError('');
        void requireDataIdle().then(() => prepareCurrentData().catch(() => {})).then(requireDataIdle).then(() => downloadSessionRescue(runtime)).then(rescue => { setRescued(true); setMissing(rescue.missingMediaIds.length); }).catch(reason => setError(reason instanceof Error ? reason.message : 'Falha no resgate.')).finally(() => setBusy(false));
      }}>Baixar rascunhos de resgate ({vaultIsProtected() ? '.ddvault' : '.json'})</button><p>O resgate preserva os documentos e arquivos já lidos nesta aba. Os demais arquivos ficam identificados pelos IDs; este pacote é parcial e requer recuperação manual.</p>{missing !== null && <p role="status">Resgate baixado: {missing} arquivo(s) original(is) ainda precisam ser recuperados da nuvem.</p>}<button disabled={(!saved && !rescued) || busy} onClick={() => void requireDataIdle().then(() => window.location.reload()).catch(reason => setError(reason.message))}>{saved ? 'Reabrir dados remotos após baixar cópia' : 'Reabrir após baixar resgate parcial'}</button></>}
      <button disabled={!!status.pending || busy} onClick={() => { setBusy(true); void prepareCurrentData(true).then(() => runtime.flush()).then(requireDataIdle).then(() => cloudJson('/api/auth/logout', { method: 'POST', headers: mutationHeaders, body: '{}' })).then(onLogout).catch(reason => setError(reason.message)).finally(() => setBusy(false)); }}>Sair da conta</button>
      {error && <p role="alert">{error}</p>}
    </div>}
  </aside>;
}
export function CloudDataControls() {
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [importing, setImporting] = useState(false);
  const cloud = getCloudRuntime();
  return <section><h3>Dados e backup</h3><p className="text-control text-text-secondary">Backup completo: planos, chat, documentos e arquivos. {getVaultSession() ? 'O arquivo .ddvault é criptografado com a chave do cofre.' : 'O arquivo .zip é legível; guarde em local privado.'} As chaves de IA ficam de fora.</p><div className="cloud-actions"><button className="ws-button" disabled={busy} onClick={() => { setBusy(true); setError(''); void saveCurrentBackup().catch(reason => setError(reason instanceof Error ? reason.message : 'Falha no backup.')).finally(() => setBusy(false)); }}>{busy ? 'Preparando…' : 'Exportar backup global'}</button>
    {cloud && <button className="ws-button" disabled={busy} onClick={() => { setBusy(true); setError(''); void prepareCurrentData(true).then(() => cloud.flush()).then(() => saveCurrentBackup(cloud)).then(() => setImporting(true)).catch(reason => setError(reason.message)).finally(() => setBusy(false)); }}>Baixar cópia atual e importar backup</button>}</div>{error && <p role="alert">{error}</p>}
    {importing && cloud && <div className="cloud-import-overlay" role="dialog" aria-modal="true" aria-label="Importar backup global"><CloudMigration backup={null} snapshot={{ documents: cloud.documents(), media: cloud.media() }} onContinue={() => setImporting(false)} onDone={() => window.location.reload()}/></div>}
  </section>;
}
