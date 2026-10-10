import { useEffect, useRef, useState } from 'react';
import { captureLegacyBackup, downloadBackup } from './migration';
import type { CloudSnapshot } from './runtime';
import { createVault, unlockVault, recoverVault } from './vault/crypto';
import { configureVault } from './vault/privacy';
import { activateVault, VaultTransport, type VaultHead } from './vault/transport';
interface Props { ownerId: string; head: VaultHead | null; snapshot: CloudSnapshot | null; fetcher: typeof fetch; onUnlocked: (transport: VaultTransport) => Promise<void> | void; onSkip: () => void }
export function VaultGate({ ownerId, head, snapshot, fetcher, onUnlocked, onSkip }: Props) {
  const [secret, setSecret] = useState(''), [confirmation, setConfirmation] = useState(''), [recovery, setRecovery] = useState(false);
  const [created, setCreated] = useState<Awaited<ReturnType<typeof createVault>> | null>(null), [savedKey, setSavedKey] = useState(false), [savedBackup, setSavedBackup] = useState(false), [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const owned = useRef<Awaited<ReturnType<typeof createVault>> | null>(null), accepted = useRef(false);
  useEffect(() => () => { if (!accepted.current) { owned.current?.session.dispose(); configureVault(null); } }, []);
  async function run(task: () => Promise<void>) { if (busy) return; setBusy(true); setError(''); try { await task(); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível abrir o cofre.'); } finally { setBusy(false); } }
  async function enter() {
    if (!head) {
      if (secret !== confirmation) throw new Error('As frases precisam ser iguais.');
      const next = await createVault(ownerId, secret); owned.current = next; setCreated(next); setSecret(''); setConfirmation(''); return;
    }
    let session;
    try {
      session = recovery ? await recoverVault(ownerId, head.header, secret) : await unlockVault(ownerId, head.header, secret);
      const transport = await VaultTransport.open(session, head, fetcher); accepted.current = true; await onUnlocked(transport);
    } catch (reason) { session?.dispose(); throw reason; } finally { setSecret(''); }
  }
  function saveKey() {
    if (!created) return;
    const url = URL.createObjectURL(new Blob([`Dynamic Diary — chave de recuperação\nConta: ${ownerId}\nCofre: ${created.header.id}\n\n${created.recoveryKey}\n\nGuarde fora do Dynamic Diary. Quem possui esta chave pode abrir o cofre.\n`], { type: 'text/plain' }));
    const link = document.createElement('a'); link.href = url; link.download = 'dynamic-diary-chave-recuperacao.txt'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); setSavedKey(true);
  }
  const legacyMedia = !head && (snapshot?.media.length ?? 0) > 0;
  return <section className="cloud-card cloud-vault-card" aria-label="Cofre privado">
    <p className="cloud-kicker">DYNAMIC DIARY · PRIVACIDADE</p><h1>{head ? 'Desbloquear seu cofre' : created ? 'Guarde sua recuperação' : 'Ativar cofre privado'}</h1>
    {head ? <><p>Seu conteúdo é aberto neste dispositivo. A senha de login não desbloqueia o cofre.</p><form onSubmit={event => { event.preventDefault(); void run(enter); }}><label>{recovery ? 'Chave de recuperação' : 'Frase do cofre'}<input type="password" autoComplete="off" value={secret} disabled={busy} onChange={event => setSecret(event.target.value)} required maxLength={1024}/></label><button className="primary" disabled={busy}>{busy ? 'Desbloqueando…' : 'Desbloquear'}</button></form><button className="cloud-text-button" disabled={busy} onClick={() => { setSecret(''); setRecovery(value => !value); }}>{recovery ? 'Usar frase do cofre' : 'Usar chave de recuperação'}</button><p className="cloud-muted">Em outro dispositivo, entre na conta e use a mesma frase ou chave. Redefinir a senha de login não recupera o cofre.</p></> : legacyMedia ? <p role="alert">Este armazenamento contém arquivos antigos e precisa de migração assistida antes da ativação. O conteúdo atual foi preservado.</p> : created ? <>
      <p>Guarde a chave de recuperação fora da aplicação. Sem a frase e sem essa chave, ninguém poderá recuperar o conteúdo.</p>
      <div className="cloud-actions"><button disabled={busy} onClick={saveKey}>{savedKey ? 'Baixar chave novamente' : 'Baixar chave de recuperação'}</button><button disabled={busy} onClick={() => void run(async () => {
        configureVault(created.session);
        const backup = await captureLegacyBackup({ getDocument: async key => snapshot?.documents.find(doc => doc.key === key)?.value ?? null, getPreference: key => snapshot?.documents.find(doc => doc.key === key)?.value ?? null, getMedia: async () => [] });
        await downloadBackup(backup); setSavedBackup(true);
      })}>{savedBackup ? 'Baixar backup novamente' : 'Baixar backup criptografado atual'}</button></div>
      <label className="cloud-vault-ack"><input type="checkbox" checked={acknowledged} disabled={busy} onChange={event => setAcknowledged(event.target.checked)}/>Guardei a chave e o backup em local privado.</label>
      <button className="primary" disabled={busy || !savedKey || !savedBackup || !acknowledged} onClick={() => void run(async () => {
        const activated = await activateVault(created.session, snapshot ?? { documents: [], media: [] }, fetcher);
        const transport = await VaultTransport.open(created.session, activated, fetcher); accepted.current = true; await onUnlocked(transport);
      })}>{busy ? 'Ativando…' : 'Ativar e abrir cofre'}</button>
    </> : <><p>Proteja conversas, projetos e anexos antes de enviá-los para a nuvem. Use uma frase exclusiva, diferente da senha de login; ela fica somente neste dispositivo enquanto o cofre está aberto.</p><form onSubmit={event => { event.preventDefault(); void run(enter); }}><label>Frase exclusiva do cofre<input type="password" autoComplete="new-password" value={secret} disabled={busy} onChange={event => setSecret(event.target.value)} required minLength={12} maxLength={1024}/></label><label>Confirmar frase<input type="password" autoComplete="new-password" value={confirmation} disabled={busy} onChange={event => setConfirmation(event.target.value)} required minLength={12} maxLength={1024}/></label><button className="primary" disabled={busy}>{busy ? 'Preparando…' : 'Preparar cofre'}</button></form></>}
    {!head && <><p className="cloud-muted">A ativação troca os documentos atuais por uma versão criptografada, sem apagar o legado deste navegador. Backups históricos do provedor podem conservar versões antigas conforme a retenção.</p><button disabled={busy || !!created} onClick={onSkip}>Continuar sem ativar agora</button></>}
    <details className="cloud-vault-details"><summary>O que esta proteção cobre?</summary><p>O banco e o servidor de armazenamento recebem conteúdo criptografado. Conta, horários, tamanhos e volume continuam visíveis. Exportações individuais JSON/TXT são arquivos legíveis.</p><p>IA, busca e TypeSafe recebem o contexto que você autorizar compartilhar. A proteção não impede acesso de código malicioso executado enquanto o cofre está aberto, nem garante segurança contra alterações futuras da aplicação por quem a publica.</p><p>A chave de recuperação permite abrir os dados. Alterar a frase do cofre e compartilhar projetos ainda não fazem parte desta versão.</p></details>
    {error && <p role="alert">{error}</p>}
  </section>;
}
