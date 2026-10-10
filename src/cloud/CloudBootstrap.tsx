import { useEffect, useRef, useState, type ComponentType } from 'react';
import { CloudRuntime, cloudJson, configureCloud, mutationHeaders, type CloudConfig, type CloudSnapshot } from './runtime';
import { captureLegacyBackup, type MigrationBackup } from './migration';
import { CloudMigration } from './CloudMigration';
import { CloudStatus } from './CloudStatus';
import './cloud.css';

interface Props { loadApplication: () => Promise<{ default: ComponentType }>; fetcher?: typeof fetch }
export function CloudBootstrap({ loadApplication, fetcher = fetch }: Props) {
  const [config, setConfig] = useState<CloudConfig | null>(null), [App, setApp] = useState<ComponentType | null>(null), [runtime, setRuntime] = useState<CloudRuntime | null>(null);
  const [snapshot, setSnapshot] = useState<CloudSnapshot | null>(null), [legacy, setLegacy] = useState<MigrationBackup | null>(null), [migration, setMigration] = useState(false);
  const [email, setEmail] = useState('wylgnerbossman@gmail.com'), [token, setToken] = useState(''), [codeSent, setCodeSent] = useState(false), [busy, setBusy] = useState(true), [error, setError] = useState('');
  const [showCode, setShowCode] = useState(false);
  const emailLink = config?.authMethod === 'email_link';
  const generation = useRef(0);
  const invalidLink = useRef(new URLSearchParams(window.location.search).get('auth_error') === 'link_invalid');
  async function load(selected: CloudSnapshot | null, next: CloudConfig) {
    const cloud = selected ? new CloudRuntime(selected, fetcher) : null; configureCloud(cloud, next.providers); setRuntime(cloud); setMigration(false);
    const application = await loadApplication(); setApp(() => application.default);
  }
  async function refresh(id = ++generation.current) {
    setBusy(true); setError('');
    try {
      const next = await cloudJson<CloudConfig>('/api/cloud/config', {}, fetcher); if (id !== generation.current) return;
      if (typeof next.enabled !== 'boolean' || typeof next.authenticated !== 'boolean') throw new Error('Configuração remota inválida.');
      setConfig(next);
      if (!next.enabled) { await load(null, next); return; }
      if (!next.authenticated) { if (invalidLink.current) { invalidLink.current = false; setError('Este link expirou ou não é válido neste navegador. Solicite um novo link de acesso.'); } return; }
      if (!next.user?.id || next.user.email.toLowerCase() !== 'wylgnerbossman@gmail.com') throw new Error('Esta conta não tem acesso ao workspace.');
      const remote = await cloudJson<CloudSnapshot>('/api/cloud/snapshot', {}, fetcher); if (id !== generation.current) return;
      // Validate before importing stores; malformed cloud data never falls back to legacy.
      const validation = new CloudRuntime(remote, fetcher); validation.dispose(); setSnapshot(remote);
      if (!remote.documents.length) {
        const backup = await captureLegacyBackup(); if (id !== generation.current) return;
        setLegacy(backup.documents.length || backup.media.length ? backup : null);
        setMigration(true); return;
      }
      await load(remote, next);
    } catch (reason) { if (id === generation.current) setError(reason instanceof Error ? reason.message : 'Não foi possível abrir o workspace.'); }
    finally { if (id === generation.current) setBusy(false); }
  }
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has('auth_error')) { const clean = new URL(window.location.href); clean.searchParams.delete('auth_error'); window.history.replaceState(window.history.state, '', clean.pathname + clean.search + clean.hash); }
    const id = ++generation.current; void refresh(id); return () => { generation.current++; };
  }, []);
  async function auth(verify: boolean) {
    setBusy(true); setError('');
    try {
      if (email.trim().toLowerCase() !== 'wylgnerbossman@gmail.com') throw new Error('Use a conta autorizada para este workspace.');
      await cloudJson(verify ? '/api/auth/verify-code' : '/api/auth/request-code', { method: 'POST', headers: mutationHeaders, body: JSON.stringify({ email: email.trim().toLowerCase(), ...(verify ? { token: token.trim() } : {}) }) }, fetcher);
      if (verify) await refresh(); else setCodeSent(true);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível entrar.'); }
    finally { setBusy(false); }
  }
  if (App) return <><App/>{runtime && <CloudStatus runtime={runtime} userId={config?.user?.id ?? ''} email={config?.user?.email ?? email} onLogout={() => { runtime.dispose(); window.location.reload(); }}/>}</>;
  return <main className="cloud-entry">
    {migration && config && snapshot ? <CloudMigration backup={legacy} snapshot={snapshot} fetcher={fetcher} onContinue={() => void load(snapshot, config).catch(reason => setError(reason.message))} onDone={next => void load(next, config).catch(reason => setError(reason.message))}/> : <section className="cloud-card">
      <p className="cloud-kicker">DYNAMIC DIARY</p><h1>{config?.enabled && !config.authenticated ? 'Entrar' : 'Abrindo seus projetos'}</h1>
      {config?.enabled && !config.authenticated && <form onSubmit={event => { event.preventDefault(); void auth(codeSent && (!emailLink || showCode)); }}>
        <label>E-mail<input type="email" autoComplete="email" value={email} disabled={busy || codeSent} onChange={event => setEmail(event.target.value)} required/></label>
        {codeSent && emailLink && <><p role="status">Abra o link enviado para seu e-mail neste navegador para entrar.</p><button type="button" aria-expanded={showCode} disabled={busy} onClick={() => setShowCode(value => !value)}>Já tenho um código</button></>}
        {codeSent && (!emailLink || showCode) && <label>Código recebido por e-mail<input inputMode="numeric" autoComplete="one-time-code" value={token} onChange={event => setToken(event.target.value)} required minLength={6} maxLength={12}/></label>}
        {(!codeSent || !emailLink || showCode) && <button className="primary" disabled={busy}>{busy ? 'Aguarde…' : codeSent ? 'Confirmar e entrar' : emailLink ? 'Enviar link de acesso' : 'Enviar código'}</button>}
        {codeSent && <button type="button" disabled={busy} onClick={() => { setCodeSent(false); setShowCode(false); setToken(''); }}>{emailLink ? 'Reenviar link' : 'Usar outro código'}</button>}
      </form>}
      {busy && <p role="status">Carregando…</p>}{error && <><p role="alert">{error}</p><button disabled={busy} onClick={() => void refresh()}>Tentar novamente</button></>}
    </section>}
  </main>;
}
