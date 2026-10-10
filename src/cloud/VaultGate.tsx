import { useEffect, useRef, useState } from 'react';
import type { CloudSnapshot } from './runtime';
import { b64, createVault, unlockVault, recoverVault, type VaultSession } from './vault/crypto';
import { rememberDeviceVault, readPreparedDeviceVault, completeDeviceActivation } from './vault/deviceKeys';
import { activateVault, prepareVaultActivation, VaultTransport, type PreparedVaultActivation, type VaultHead } from './vault/transport';
interface Props { ownerId: string; head: VaultHead | null; snapshot: CloudSnapshot | null; fetcher: typeof fetch; onUnlocked: (transport: VaultTransport) => Promise<void> | void; onSkip: () => void; deviceError?: string }
interface Preparation { session: VaultSession; activation: PreparedVaultActivation; recoveryKey?: string }
export function VaultGate({ ownerId, head, snapshot, fetcher, onUnlocked, onSkip, deviceError }: Props) {
  const [secret, setSecret] = useState(''), [recovery, setRecovery] = useState(true), [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false), [error, setError] = useState(deviceError ?? ''), [attempted, setAttempted] = useState(false);
  const owned = useRef<Preparation | null>(null), accepted = useRef(false), live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; if (!accepted.current) owned.current?.session.dispose(); }; }, []);
  function ensureLive(session?: VaultSession) { if (!live.current) { session?.dispose(); throw new Error('A abertura deste navegador foi cancelada.'); } }
  async function run(task: () => Promise<void>) { if (busy) return; setBusy(true); setError(''); try { await task(); } catch (reason) { if (live.current) setError(reason instanceof Error ? reason.message : 'Não foi possível abrir o cofre.'); } finally { if (live.current) setBusy(false); } }
  async function protect() {
    const current = snapshot ?? { documents: [], media: [] };
    if (!owned.current) {
      const prepared = await readPreparedDeviceVault(ownerId);
      ensureLive(prepared?.session);
      if (prepared) {
        const activation = await prepareVaultActivation(prepared.session, current, prepared.activation); ensureLive(prepared.session);
        owned.current = { session: prepared.session, activation };
      } else {
        const next = await createVault(ownerId, b64(crypto.getRandomValues(new Uint8Array(32))));
        ensureLive(next.session);
        const activation = await prepareVaultActivation(next.session, current); ensureLive(next.session);
        owned.current = { session: next.session, recoveryKey: next.recoveryKey, activation };
      }
    }
    const preparation = owned.current;
    await rememberDeviceVault(preparation.session, { recoveryKey: preparation.recoveryKey, activation: preparation.activation });
    ensureLive(preparation.session);
    preparation.recoveryKey = undefined;
    setAttempted(true);
    const activated = await activateVault(preparation.session, current, fetcher, preparation.activation);
    ensureLive(preparation.session);
    const transport = await VaultTransport.open(preparation.session, activated, fetcher);
    ensureLive(preparation.session);
    await completeDeviceActivation(preparation.session);
    ensureLive(preparation.session);
    accepted.current = true;
    try { await onUnlocked(transport); } catch (reason) { accepted.current = false; throw reason; }
  }
  async function enter() {
    if (!head) return;
    let session: VaultSession | undefined;
    try {
      session = recovery ? await recoverVault(ownerId, head.header, secret) : await unlockVault(ownerId, head.header, secret);
      ensureLive(session);
      const transport = await VaultTransport.open(session, head, fetcher);
      ensureLive(session);
      if (remember) await rememberDeviceVault(session, recovery ? { recoveryKey: secret } : undefined);
      ensureLive(session);
      accepted.current = true;
      try { await onUnlocked(transport); } catch (reason) { accepted.current = false; throw reason; }
    } catch (reason) { session?.dispose(); throw reason; } finally { if (live.current) setSecret(''); }
  }
  const legacyMedia = !head && (snapshot?.media.length ?? 0) > 0;
  return <section className="cloud-card cloud-vault-card" aria-label="Cofre privado">
    <p className="cloud-kicker">DYNAMIC DIARY · PRIVACIDADE</p><h1>{head ? 'Abrir seus dados neste navegador' : 'Proteja seus dados'}</h1>
    {head ? <>
      <p>Este navegador ainda precisa da sua chave de recuperação. Se você usava uma frase do cofre, ela continua funcionando.</p>
      <form onSubmit={event => { event.preventDefault(); void run(enter); }}>
        <label>{recovery ? 'Chave de recuperação' : 'Frase antiga do cofre'}<input type="password" autoComplete="off" value={secret} disabled={busy} onChange={event => setSecret(event.target.value)} required maxLength={1024}/></label>
        <label className="cloud-vault-ack"><input type="checkbox" checked={remember} disabled={busy} onChange={event => setRemember(event.target.checked)}/>Lembrar neste navegador após o login</label>
        <small>Em um navegador compartilhado, desmarque esta opção.</small>
        <button className="primary" disabled={busy}>{busy ? 'Abrindo…' : 'Abrir meus dados'}</button>
      </form>
      <button className="cloud-text-button" disabled={busy} onClick={() => { setSecret(''); setRecovery(value => !value); }}>{recovery ? 'Usar minha frase antiga do cofre' : 'Usar chave de recuperação'}</button>
      <p className="cloud-muted">Sem lembrar, você precisará informar a chave ou frase novamente. A senha de login não substitui essa recuperação.</p>
    </> : legacyMedia ? <p role="alert">Este armazenamento contém arquivos antigos e precisa de migração assistida antes da ativação. O conteúdo atual foi preservado.</p> : <>
      <p>O navegador guarda a chave e abre seus projetos automaticamente depois do login. Seus dados chegam criptografados à nuvem.</p>
      <button className="primary" disabled={busy} onClick={() => void run(protect)}>{busy ? 'Protegendo…' : attempted ? 'Tentar concluir proteção' : 'Proteger meus dados neste navegador'}</button>
      <p className="cloud-muted">Limpar este navegador ou usar outro dispositivo exige recuperação. Depois de entrar, você pode baixar sua chave em Dados e backup.</p>
    </>}
    {!head && <><button disabled={busy || attempted} onClick={onSkip}>Continuar sem ativar agora</button></>}
    <details className="cloud-vault-details"><summary>Como funciona a proteção?</summary><p>A chave fica guardada neste perfil do navegador, sem ser enviada ao servidor. Sair da conta fecha a sessão e mantém esse navegador lembrado. O login controla a abertura na interface; ele não é a chave criptográfica.</p><p>Quem acessa este perfil do navegador ou executa código malicioso na aplicação pode usar a chave. Não prometemos armazenamento protegido por hardware. Banco e servidor recebem conteúdo cifrado; conta, horários e tamanhos continuam visíveis.</p><p>IA, busca e TypeSafe recebem o contexto que você autorizar compartilhar. Exportações individuais JSON/TXT são legíveis. Recuperação e backups são opcionais; sem chave local nem recuperação, os dados não podem ser abertos.</p><p>Backups antigos do provedor podem conservar versões anteriores. Seus dados locais continuam intactos.</p></details>
    {error && <p role="alert">{error}</p>}
  </section>;
}
