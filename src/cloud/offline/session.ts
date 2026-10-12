import { CloudConflictError, CloudHttpError, CloudRuntime, cloudJson, type CloudConfig } from '../runtime';
import { readDeviceVault } from '../vault/deviceKeys';
import { sessionFromDeviceKey, validateCipher, validateHeader, type VaultSession } from '../vault/crypto';
import { VaultTransport, type VaultHead } from '../vault/transport';
import { OfflineRepository, acquireOfflineLease, authorizeOffline, readOfflineAuthorization, type OfflineAuthorization } from './repository';

export interface OfflineWorkspace {
  runtime: CloudRuntime;
  vault: VaultTransport;
  config: CloudConfig;
  start(): void;
  disconnect(): void;
  reconnect(): Promise<void>;
}
export async function hasOfflineCheckpoints(session: VaultSession): Promise<boolean> {
  const repository = new OfflineRepository(session);
  return await repository.read('runtime') !== null || await repository.read('transport') !== null;
}
const allowedEmail = 'wylgnerbossman@gmail.com';
const sameHeader = (a: unknown, b: unknown) => JSON.stringify(validateHeader(a)) === JSON.stringify(validateHeader(b));

async function construct(authorization: OfflineAuthorization, session: VaultSession, fetcher: typeof fetch, online: boolean, fresh?: VaultTransport): Promise<OfflineWorkspace> {
  const release = await acquireOfflineLease(session.ownerId, session.header.id);
  if (!release) { session.dispose(); throw new Error('Este workspace está aberto em outra aba ou o navegador não permite edição offline. Feche a outra aba e tente novamente.'); }
  let ready = false, disposed = false, started = false, pendingRecovery = false, timer: number | undefined, connecting: Promise<void> | null = null;
  const repository = new OfflineRepository(session), networkReady = () => ready && !disposed && navigator.onLine !== false;
  let vault: VaultTransport | undefined, runtime: CloudRuntime | undefined;
  let unsubscribe: (() => void) | undefined;
  const disconnect = () => { ready = false; runtime?.notifyNetworkState(); };
  const connected = () => { void reconnect(); };
  const dispose = () => {
    if (disposed) return;
    disposed = true; ready = false;
    window.removeEventListener('online', connected); window.removeEventListener('offline', disconnect);
    if (timer !== undefined) window.clearInterval(timer);
    unsubscribe?.();
    // A transaction already issued by this owner must finish before another
    // tab can acquire its lease and prepare a newer checkpoint.
    void repository.settled().finally(() => { vault?.dispose(); if (!vault) session.dispose(); release(); });
  };
  const reportIssue = (reason: unknown) => {
    if (disposed) return;
    ready = false; runtime!.notifyNetworkState();
    const preserved = runtime!.getSnapshot().issue;
    if (preserved?.kind === 'conflict') { runtime!.reportSyncIssue(preserved); return; }
    runtime!.reportSyncIssue({ key: 'offline-sync', kind: reason instanceof CloudConflictError ? 'conflict' : reason instanceof CloudHttpError && [401, 403].includes(reason.status) ? 'session' : 'network', message: reason instanceof CloudHttpError && [401, 403].includes(reason.status) ? 'Entre novamente para sincronizar. Seus rascunhos continuam neste aparelho.' : reason instanceof CloudConflictError ? reason.message : 'Sem conexão com a nuvem. As alterações salvas neste aparelho serão enviadas ao reconectar.' });
  };
  const recoverVerified = async (verifiedHead: VaultHead) => {
    // Clearing a persisted session/network issue publishes status. Keep the gate
    // closed through that publication so its subscriber cannot close a new gate.
    await runtime!.resumeAfterAuthentication(session.ownerId);
    await runtime!.retry();
    if (disposed) return;
    ready = true; runtime!.notifyNetworkState();
    const recovered = await vault!.recoverAuxiliaryOperations();
    pendingRecovery = recovered.length > 0;
    await runtime!.retry();
    if (!networkReady()) return;
    // A restored checkpoint can be older even when there is no auxiliary receipt.
    // Replay queued writes first, then adopt the canonical head only while idle.
    pendingRecovery = true;
    if (!runtime!.isIdle()) return;
    if (verifiedHead.revision > vault!.head().revision) await vault!.refreshSnapshot();
    let adopted: boolean;
    if (!started) adopted = await runtime!.adoptRecoveredSnapshot(vault!.snapshot());
    else {
      // Importing these modules before application loading would initialize the
      // domain stores before their encrypted runtime has been configured.
      const { cloudCanvasIdle, applyRemoteCanvasDocuments } = await import('../CloudLiveSync');
      const idle = () => !disposed && networkReady() && !runtime!.getSnapshot().pending && !runtime!.getSnapshot().saving && cloudCanvasIdle();
      adopted = await runtime!.adoptRecoveredSnapshot(vault!.snapshot(), { isIdle: idle, apply: applyRemoteCanvasDocuments });
    }
    if (!adopted || disposed) return;
    // The runtime checkpoint now contains the recovered effects. Only this
    // durable boundary permits dropping the original request/receipt journal.
    for (const id of recovered) await vault!.acknowledgeOperation(id);
    pendingRecovery = false;
  };
  const reconnect = (): Promise<void> => {
    if (connecting) return connecting;
    if (disposed || navigator.onLine === false) { disconnect(); return Promise.resolve(); }
    const task = (async () => {
      ready = false; runtime!.notifyNetworkState();
      const config = await cloudJson<CloudConfig>('/api/cloud/config', {}, fetcher);
      if (!config.enabled || !config.authenticated || config.passwordSetup || config.user?.id !== session.ownerId || config.user.email.toLowerCase() !== allowedEmail) throw new CloudHttpError(401, 'Entre novamente com a mesma conta para sincronizar. Seus rascunhos estão neste aparelho.');
      const head = await cloudJson<VaultHead>('/api/cloud/vault', {}, fetcher);
      const local = vault!.head();
      if (!sameHeader(head?.header, session.header) || !Number.isSafeInteger(head.revision) || head.revision < local.revision) throw new CloudConflictError();
      const cipher = validateCipher(head.manifest);
      if (head.revision === local.revision && (cipher.iv !== local.manifest.iv || cipher.data !== local.manifest.data)) throw new CloudConflictError();
      // Validate the newer encrypted head without adopting it over an unresolved
      // local operation. That operation must still replay its original ciphertext.
      if (head.revision > local.revision) {
        const checkSession = sessionFromDeviceKey(session.ownerId, session.header, session.deviceKeyForStorage());
        try { (await VaultTransport.open(checkSession, head, fetcher)).dispose(); }
        finally { checkSession.dispose(); }
      }
      if (disposed) return;
      await recoverVerified(head);
    })().catch(reportIssue).finally(() => { if (connecting === task) connecting = null; });
    connecting = task; return task;
  };
  try {
    if (!online && JSON.stringify(await readOfflineAuthorization()) !== JSON.stringify(authorization)) throw new Error('O acesso offline foi encerrado. Entre novamente com conexão.');
    let transportCheckpoint = await repository.read('transport'), runtimeCheckpoint = await repository.read('runtime');
    if ((transportCheckpoint === null) !== (runtimeCheckpoint === null)) {
      // An interrupted first preparation has no user edits yet. Recover only
      // after real account verification, with no prior authorization or work.
      let emptyPreparation = false;
      if (fresh && await readOfflineAuthorization() === null) {
        if (transportCheckpoint !== null) {
          const checkSession = sessionFromDeviceKey(session.ownerId, session.header, session.deviceKeyForStorage());
          try { const check = await VaultTransport.restore(checkSession, transportCheckpoint, fetcher); emptyPreparation = !check.hasPendingOperations(); check.dispose(); }
          finally { checkSession.dispose(); }
        } else {
          const check = new CloudRuntime(fresh.snapshot(), fetcher, undefined, undefined, { checkpoint: runtimeCheckpoint });
          emptyPreparation = check.getSnapshot().pending === 0 && check.checkpoint().drafts.length === 0; check.dispose();
        }
      }
      if (!emptyPreparation) throw new Error('A cópia offline está incompleta. Conecte-se para conferir seus dados; nenhum rascunho foi substituído.');
      transportCheckpoint = null; runtimeCheckpoint = null;
    }
    if (!fresh && transportCheckpoint === null) throw new Error('A cópia offline está incompleta. Entre com conexão primeiro.');
    vault = transportCheckpoint !== null
      ? await VaultTransport.restore(session, transportCheckpoint, fetcher, { persistence: repository, networkReady })
      : await VaultTransport.open(session, fresh!.head(), fetcher, { persistence: repository, networkReady });
    runtime = new CloudRuntime(vault.snapshot(), vault.fetch, dispose, () => vault!.refreshSnapshot(), {
      persistence: repository, checkpoint: runtimeCheckpoint ?? undefined, networkReady,
      acknowledgeOperation: id => vault!.acknowledgeOperation(id),
      rejectOperation: id => vault!.discardRejectedOperation(id),
    });
    unsubscribe = runtime.subscribe(() => {
      const kind = runtime!.getSnapshot().issue?.kind;
      if (ready && (kind === 'session' || kind === 'network')) { ready = false; runtime!.notifyNetworkState(); }
    });
    await vault.reconcileOperations(runtime.checkpoint().queue.map(operation => operation.operationId));
    // prepareOfflineWorkspace's caller already verified this owner and header.
    // Recover before the domain stores load; offline opening performs no sends.
    if (online) {
      try {
        const current = fresh!.head(), local = vault.head();
        if (!sameHeader(current.header, session.header) || current.revision < local.revision || current.revision === local.revision && (current.manifest.iv !== local.manifest.iv || current.manifest.data !== local.manifest.data)) throw new CloudConflictError();
        await recoverVerified(current);
      } catch (reason) { reportIssue(reason); }
    }
    await vault.persistCheckpoint(); await runtime.persistCheckpoint();
    if (online && ready) await authorizeOffline(authorization);
    return {
      runtime, vault,
      // This is an offline device authorization, not a claim of server authentication.
      config: { enabled: true, authenticated: online && ready, vaultAvailable: true, user: { id: authorization.ownerId, email: authorization.email }, providers: authorization.providers, liveInkAvailable: authorization.liveInkAvailable },
      disconnect, reconnect,
      start() {
        if (started || disposed) return; started = true;
        window.addEventListener('online', connected); window.addEventListener('offline', disconnect);
        // Canonical adoption can wait for an idle runtime. Rechecking an already
        // verified session mid-drain would close its gate and interrupt flush().
        timer = window.setInterval(() => { if ((!ready || (pendingRecovery && runtime!.isIdle())) && navigator.onLine !== false && runtime!.getSnapshot().issue?.kind !== 'conflict') void reconnect(); }, 5000);
        if (networkReady()) void runtime!.retry(); else if (navigator.onLine !== false) void reconnect();
      },
    };
  } catch (reason) { dispose(); throw reason; }
}

/** Call only after the server has verified the account and the current encrypted head. */
export async function prepareOfflineWorkspace(config: CloudConfig, vault: VaultTransport, fetcher: typeof fetch = fetch): Promise<OfflineWorkspace> {
  if (!config.enabled || !config.authenticated || config.passwordSetup || config.user?.id !== vault.session.ownerId || config.user.email.toLowerCase() !== allowedEmail) throw new Error('Confirme a conta antes de preparar o acesso offline.');
  return construct({ version: 1, ownerId: config.user.id, email: config.user.email, header: vault.session.header, providers: config.providers, liveInkAvailable: config.liveInkAvailable }, vault.session, fetcher, true, vault);
}

export async function openOfflineWorkspace(fetcher: typeof fetch = fetch): Promise<OfflineWorkspace | null> {
  const authorization = await readOfflineAuthorization();
  if (!authorization) return null;
  if (authorization.email.toLowerCase() !== allowedEmail) throw new Error('A cópia offline pertence a outra conta.');
  // The saved authorization and encrypted checkpoint must both authenticate on
  // this previously approved device before any persisted application store loads.
  const session = await readDeviceVault(authorization.ownerId, authorization.header);
  if (!session) throw new Error('Este aparelho ainda não tem uma cópia offline autorizada. Entre com internet primeiro.');
  return construct(authorization, session, fetcher, false);
}
