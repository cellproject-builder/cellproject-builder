import { useEffect, useRef, useState } from 'react';
import { cloudJson, type CloudConfig, type CloudSnapshot } from './runtime';
import { signInPassword, type PasswordProvider } from './passwordAuth';
import { b64, createVault, type VaultSession } from './vault/crypto';
import { completeDeviceActivation, readDeviceVault, readPreparedDeviceVault, rememberDeviceVault } from './vault/deviceKeys';
import { commitPasswordAccess, openPasswordAccess, preparePasswordAccess, readPasswordAccess, type PasswordAccessHead, type PreparedPasswordAccess } from './vault/passwordAccess';
import { activateVault, prepareVaultActivation, VaultTransport, type PreparedVaultActivation, type VaultHead } from './vault/transport';

interface Props {
  ownerId: string; email: string; provider: PasswordProvider; head: VaultHead | null;
  snapshot: CloudSnapshot | null; fetcher: typeof fetch; takeLoginPassword: () => string | null;
  onUnlocked: (vault: VaultTransport) => Promise<void>; onRetry: () => void; onRestart: () => Promise<void>;
}
/** Single-password UX. Legacy data keys are reused, never reset to simplify access. */
export function PasswordVaultGate({ ownerId, email, provider, head, snapshot, fetcher, takeLoginPassword, onUnlocked, onRetry, onRestart }: Props) {
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [password, setPassword] = useState(''), [trusted, setTrusted] = useState(false), [hasAccess, setHasAccess] = useState(false), [hasLoginPassword, setHasLoginPassword] = useState(false);
  const session = useRef<VaultSession | null>(null), currentHead = useRef(head), access = useRef<PasswordAccessHead>({ access: null });
  const activation = useRef<PreparedVaultActivation | undefined>(), pendingAccess = useRef<PreparedPasswordAccess | null>(null);
  const loginPassword = useRef<string | null>(null), accepted = useRef(false), live = useRef(true), epoch = useRef(0);
  const repairDeviceRecord = useRef(false);
  const createdRecovery = useRef<string | undefined>();
  function active(id: number) { if (!live.current || id !== epoch.current) throw new Error('A abertura deste aparelho foi cancelada.'); }
  async function finish(vault: VaultTransport, id: number) {
    active(id); accepted.current = true;
    try { await onUnlocked(vault); } catch (reason) { accepted.current = false; session.current = null; vault.dispose(); throw reason; }
  }
  async function enter(secret: string, verified: boolean, id: number) {
    active(id);
    if (!verified) {
      await signInPassword(email, secret, provider, fetcher); active(id);
      const account = await cloudJson<CloudConfig>('/api/cloud/config', {}, fetcher); active(id);
      if (!account.authenticated || account.passwordSetup || account.user?.id !== ownerId) throw new Error('Sua conta mudou. Entre novamente antes de abrir seus dados.');
    }
    let current = currentHead.current;
    if (!current) {
      if ((snapshot?.media.length ?? 0) > 0) throw new Error('Os arquivos antigos precisam de migração assistida. Nenhum dado foi alterado.');
      if (!session.current) {
        const prepared = await readPreparedDeviceVault(ownerId);
        if (!live.current || id !== epoch.current) { prepared?.session.dispose(); active(id); }
        if (prepared) { session.current = prepared.session; activation.current = prepared.activation; }
        else {
          const created = await createVault(ownerId, b64(crypto.getRandomValues(new Uint8Array(32))));
          if (!live.current || id !== epoch.current) { created.session.dispose(); active(id); }
          session.current = created.session;
          createdRecovery.current = created.recoveryKey;
          activation.current = await prepareVaultActivation(created.session, snapshot ?? { documents: [], media: [] }); active(id);
        }
      }
      const prepared = await prepareVaultActivation(session.current!, snapshot ?? { documents: [], media: [] }, activation.current); active(id); activation.current = prepared;
      // A saved, read-back device key is required before the first remote activation.
      await rememberDeviceVault(session.current!, { recoveryKey: createdRecovery.current, activation: prepared }); active(id); createdRecovery.current = undefined;
      current = await activateVault(session.current!, snapshot ?? { documents: [], media: [] }, fetcher, prepared); active(id); currentHead.current = current;
    }
    const remoteAccess = await readPasswordAccess(ownerId, current.header, fetcher); active(id); access.current = remoteAccess;
    if (!session.current) {
      if (!access.current.access) throw new Error('Entre em um aparelho onde seus dados já abrem para vincular sua senha. Seus dados continuam preservados.');
      const opened = await openPasswordAccess(ownerId, current.header, access.current.access, secret);
      if (!live.current || id !== epoch.current) { opened.session.dispose(); active(id); }
      session.current = opened.session;
      const vault = await VaultTransport.open(opened.session, current, fetcher); active(id);
      await rememberDeviceVault(opened.session, { recoveryKey: opened.recovery, replaceInvalidRecord: repairDeviceRecord.current }); active(id);
      await finish(vault, id); return;
    }
    const vault = await VaultTransport.open(session.current, current, fetcher); active(id);
    const preparedAccess = pendingAccess.current ?? await preparePasswordAccess(session.current, secret, fetcher, access.current); active(id); pendingAccess.current = preparedAccess;
    await commitPasswordAccess(pendingAccess.current, fetcher); active(id); pendingAccess.current = null;
    await completeDeviceActivation(session.current); active(id);
    await finish(vault, id);
  }
  async function run(secret: string, verified: boolean, id = epoch.current) {
    if (busy) return; setBusy(true); setError('');
    try { await enter(secret, verified, id); }
    catch (reason) { if (live.current && id === epoch.current) setError(reason instanceof Error ? reason.message : 'Não foi possível abrir seus dados.'); }
    finally { if (live.current && id === epoch.current) { loginPassword.current = null; setPassword(''); setHasLoginPassword(false); setBusy(false); } }
  }
  useEffect(() => {
    live.current = true; const id = ++epoch.current; loginPassword.current = takeLoginPassword(); setHasLoginPassword(!!loginPassword.current);
    void (async () => {
      try {
        if (head) {
          let restored: VaultSession | null = null;
          try { restored = await readDeviceVault(ownerId, head.header); }
          catch { repairDeviceRecord.current = true; }
          if (!live.current || id !== epoch.current) { restored?.dispose(); return; }
          session.current = restored; setTrusted(!!restored);
          const remoteAccess = await readPasswordAccess(ownerId, head.header, fetcher); active(id); access.current = remoteAccess; setHasAccess(!!access.current.access);
          if (restored && access.current.access && !loginPassword.current) { await finish(await VaultTransport.open(restored, head, fetcher), id); return; }
          if (loginPassword.current && (restored || access.current.access)) await run(loginPassword.current, true, id);
        }
      } catch (reason) { if (live.current && id === epoch.current) setError(reason instanceof Error ? reason.message : 'Não foi possível abrir seus dados.'); }
      finally { if (live.current && id === epoch.current) setLoading(false); }
    })();
    return () => { live.current = false; epoch.current++; loginPassword.current = null; createdRecovery.current = undefined; if (!accepted.current) session.current?.dispose(); };
  }, []);
  const unavailable = !!head && !trusted && !hasAccess;
  return <section className="cloud-card cloud-vault-card" aria-label="Acesso privado">
    <p className="cloud-kicker">DYNAMIC DIARY · PRIVACIDADE</p>
    <h1>{loading || busy ? 'Abrindo seus dados' : unavailable ? 'Conecte um aparelho autorizado' : head ? 'Sua senha, seus dados' : 'Privacidade com sua senha'}</h1>
    {loading ? <p role="status">Conferindo o acesso deste aparelho…</p> : unavailable ? <>
      <p>Abra o Dynamic Diary em um aparelho onde seus projetos já aparecem e entre com sua senha para vincular o acesso. Depois, volte aqui.</p>
      <button className="primary" disabled={busy} onClick={onRetry}>Conferir novamente</button>
    </> : <>
      <p>{head ? 'Use a mesma senha da sua conta para conectar seus dados privados.' : 'Seus projetos ficam criptografados. A mesma senha da conta abre seus dados nos seus aparelhos.'}</p>
      <form onSubmit={event => { event.preventDefault(); void run(loginPassword.current ?? password, !!loginPassword.current); }}>
        {!hasLoginPassword && <label>Senha da conta<input type="password" autoComplete="current-password" required minLength={10} maxLength={72} disabled={busy} value={password} onChange={event => { setPassword(event.target.value); pendingAccess.current = null; }}/></label>}
        <button className="primary" disabled={busy}>{busy ? 'Conectando…' : head ? 'Abrir meus dados' : 'Continuar com privacidade'}</button>
      </form>
      <p className="cloud-muted">Esqueceu a senha? Redefina pelo link temporário do e-mail em um aparelho já autorizado. Sem a senha e sem esse aparelho, os dados antigos não podem ser recuperados.</p>
    </>}
    {error && <p role="alert">{error}</p>}
    <button className="cloud-text-button" disabled={busy || loading} onClick={() => { setBusy(true); setError(''); loginPassword.current = null; setPassword(''); void onRestart().catch(reason => { if (live.current) { setError(reason instanceof Error ? reason.message : 'Não foi possível reiniciar o acesso.'); setBusy(false); } }); }}>Voltar ao login</button>
    <details className="cloud-vault-details"><summary>Sobre a privacidade</summary><p>A senha protege a chave no navegador. O servidor de armazenamento recebe dados cifrados. Seu navegador continua autorizado após sair da conta.</p><p>IA, busca e TypeSafe recebem o contexto que você autorizar. A proteção não cobre um aparelho comprometido nem alterações maliciosas futuras no código da aplicação.</p></details>
  </section>;
}
