import { lazy, Suspense, useEffect, useRef, useState, type ComponentType } from 'react';
import { CloudHttpError, CloudRuntime, cloudJson, configureCloud, getCloudRuntime, mutationHeaders, type CloudConfig, type CloudSnapshot } from './runtime';
import { captureLegacyBackup, type MigrationBackup } from './migration';
import { CloudMigration } from './CloudMigration';
import { CloudStatus } from './CloudStatus';
import { PasswordSetup } from './PasswordSetup';
import { VaultGate } from './VaultGate';
import { PasswordVaultGate } from './PasswordVaultGate';
import { signInPassword } from './passwordAuth';
import { preparePasswordProtection } from './vault/passwordSetup';
import { VaultTransport, type VaultHead } from './vault/transport';
import { configureVault } from './vault/privacy';
import { readDeviceVault } from './vault/deviceKeys';
import { configureLiveInk } from '@/ink/live';
import { CloudInkConnection } from './CloudInkConnection';
import './cloud.css';

const CloudLiveSync = lazy(() => import('./CloudLiveSync').then(module => ({ default: module.CloudLiveSync })));

interface Props { loadApplication: () => Promise<{ default: ComponentType }>; fetcher?: typeof fetch }
export function CloudBootstrap({ loadApplication, fetcher = fetch }: Props) {
  const [config, setConfig] = useState<CloudConfig | null>(null), [App, setApp] = useState<ComponentType | null>(null), [runtime, setRuntime] = useState<CloudRuntime | null>(null);
  const [snapshot, setSnapshot] = useState<CloudSnapshot | null>(null), [legacy, setLegacy] = useState<MigrationBackup | null>(null), [migration, setMigration] = useState(false);
  const [email, setEmail] = useState('wylgnerbossman@gmail.com'), [token, setToken] = useState(''), [codeSent, setCodeSent] = useState(false), [busy, setBusy] = useState(true), [error, setError] = useState('');
  const [showCode, setShowCode] = useState(false);
  const [loginMethod, setLoginMethod] = useState<'password' | 'link' | 'setup'>('password');
  const [password, setPassword] = useState('');
  const [vaultGate, setVaultGate] = useState(false), [vaultHead, setVaultHead] = useState<VaultHead | null>(null);
  const [deviceError, setDeviceError] = useState('');
  const emailLink = config?.authMethod === 'email_link';
  const passwordLogin = config?.passwordAuth && loginMethod === 'password', passwordLink = config?.passwordAuth && loginMethod === 'setup';
  const generation = useRef(0);
  const submittedPassword = useRef<string | null>(null);
  const activeRuntime = useRef<CloudRuntime | null>(null);
  const invalidLink = useRef(new URLSearchParams(window.location.search).get('auth_error') === 'link_invalid');
  async function load(selected: CloudSnapshot | null, next: CloudConfig, vault?: VaultTransport) {
    const id = generation.current;
    let ink: CloudInkConnection | null = null;
    const cloud = selected ? new CloudRuntime(selected, vault?.fetch ?? fetcher, vault ? () => { ink?.dispose(); vault.dispose(); } : undefined, vault ? () => vault.refreshSnapshot() : undefined) : null;
    activeRuntime.current = cloud;
    configureCloud(cloud, next.providers); configureVault(vault?.session ?? null, !!vault);
    configureLiveInk(null);
    if (cloud && vault && next.liveInkAvailable) ink = new CloudInkConnection({ runtime: cloud, session: vault.session, fetcher });
    try { const application = await loadApplication(); if (id !== generation.current) { cloud?.dispose(); return; } ink?.start(); setRuntime(cloud); setMigration(false); setVaultGate(false); setApp(() => application.default); }
    catch (reason) { ink?.dispose(); if (getCloudRuntime() === cloud) { configureCloud(null); configureLiveInk(null); configureVault(null, !!vault); } throw reason; }
  }
  async function verifyAccount(ownerId: string) {
    const latest = await cloudJson<CloudConfig>('/api/cloud/config', {}, fetcher);
    if (!latest.enabled || !latest.authenticated || latest.passwordSetup || latest.user?.id !== ownerId || latest.user.email.toLowerCase() !== 'wylgnerbossman@gmail.com') throw new CloudHttpError(401, 'Sua sessão mudou. Entre novamente para abrir os dados.');
    return latest;
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
      if (next.passwordSetup) return;
      if (next.vaultAvailable) {
        setDeviceError('');
        const head = await cloudJson<VaultHead | { vault: null }>('/api/cloud/vault', {}, fetcher); if (id !== generation.current) return;
        if ('vault' in head && head.vault === null) {
          const original = await cloudJson<CloudSnapshot>('/api/cloud/snapshot', {}, fetcher); if (id !== generation.current) return;
          const validation = new CloudRuntime(original, fetcher); validation.dispose(); setSnapshot(original); setVaultHead(null);
        } else {
          const current = head as VaultHead; setVaultHead(current); setSnapshot(null); configureVault(null, true);
          if (next.passwordProvider) { setVaultGate(true); return; }
          let session;
          try {
            session = await readDeviceVault(next.user.id, current.header);
            if (id !== generation.current) { session?.dispose(); return; }
            if (session) {
              const vault = await VaultTransport.open(session, current, fetcher);
              const latest = await verifyAccount(next.user.id);
              if (id !== generation.current) { vault.dispose(); return; }
              await load(vault.snapshot(), latest, vault); return;
            }
          } catch (reason) {
            session?.dispose();
            if (reason instanceof CloudHttpError && [401, 403].includes(reason.status)) throw reason;
            setDeviceError(reason instanceof Error ? reason.message : 'Use sua recuperação para abrir este navegador.');
          }
        }
        setVaultGate(true); return;
      }
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
    const id = ++generation.current; void refresh(id); return () => {
      generation.current++;
      submittedPassword.current = null;
      const cloud = activeRuntime.current; activeRuntime.current = null; cloud?.dispose();
      // Clear the global adapter after child cleanup, so unmounting stores cannot write to local persistence.
      queueMicrotask(() => { if (cloud && getCloudRuntime() === cloud) configureCloud(null); });
    };
  }, []);
  async function auth(verify: boolean) {
    if (busy) return;
    setBusy(true); setError('');
    try {
      if (email.trim().toLowerCase() !== 'wylgnerbossman@gmail.com') throw new Error('Use a conta autorizada para este workspace.');
      if (passwordLogin) {
        const result = config?.passwordProvider ? await signInPassword(email.trim().toLowerCase(), password, config.passwordProvider, fetcher) : await cloudJson<{ authenticated: boolean }>('/api/auth/password/sign-in', { method: 'POST', headers: mutationHeaders, body: JSON.stringify({ email: email.trim().toLowerCase(), password }) }, fetcher);
        if (!result.authenticated) throw new Error('Login recusado.');
        submittedPassword.current = config?.passwordProvider ? password : null;
        setPassword(''); await refresh(); return;
      }
      if (passwordLink) {
        await cloudJson('/api/auth/password/setup-link', { method: 'POST', headers: mutationHeaders, body: JSON.stringify({ email: email.trim().toLowerCase() }) }, fetcher);
        setCodeSent(true); return;
      }
      await cloudJson(verify ? '/api/auth/verify-code' : '/api/auth/request-code', { method: 'POST', headers: mutationHeaders, body: JSON.stringify({ email: email.trim().toLowerCase(), ...(verify ? { token: token.trim() } : {}) }) }, fetcher);
      if (verify) await refresh(); else setCodeSent(true);
    } catch (reason) { setError(reason instanceof CloudHttpError && reason.status === 429 ? 'Você fez muitas tentativas. Aguarde um pouco e tente novamente.' : passwordLogin ? 'Não foi possível entrar. Confira seu e-mail e senha e tente novamente.' : passwordLink ? 'Não foi possível enviar o link de senha. Tente novamente em instantes.' : reason instanceof Error ? reason.message : 'Não foi possível entrar.'); }
    finally { setPassword(''); setBusy(false); }
  }
  function switchMethod(method: typeof loginMethod) { submittedPassword.current = null; setLoginMethod(method); setPassword(''); setCodeSent(false); setShowCode(false); setToken(''); setError(''); }
  async function restartLogin() {
    await cloudJson('/api/auth/logout', { method: 'POST', headers: mutationHeaders, body: '{}' }, fetcher);
    submittedPassword.current = null; setPassword(''); setVaultGate(false); setVaultHead(null); setSnapshot(null); setDeviceError('');
    await refresh();
  }
  if (App) return <><App/>{runtime && <><Suspense fallback={null}><CloudLiveSync runtime={runtime}/></Suspense><CloudStatus runtime={runtime} userId={config?.user?.id ?? ''} email={config?.user?.email ?? email} passwordProvider={config?.passwordProvider} fetcher={fetcher} onLogout={() => { runtime.dispose(); window.location.reload(); }}/></>}</>;
  return <main className="cloud-entry">
    {vaultGate && config?.user && config.passwordProvider ? <PasswordVaultGate key={`${config.user.id}:${vaultHead?.header.id ?? 'new'}`} ownerId={config.user.id} email={config.user.email} provider={config.passwordProvider} head={vaultHead} snapshot={snapshot} fetcher={fetcher} takeLoginPassword={() => { const secret = submittedPassword.current; submittedPassword.current = null; return secret; }} onRetry={() => window.location.reload()} onRestart={restartLogin} onUnlocked={async vault => {
      const id = generation.current;
      try { const latest = await verifyAccount(config.user!.id); if (id !== generation.current) { vault.dispose(); return; } await load(vault.snapshot(), latest, vault); }
      catch (reason) { vault.dispose(); throw reason; }
    }}/> : vaultGate && config?.user ? <VaultGate key={`${config.user.id}:${vaultHead?.header.id ?? 'new'}`} ownerId={config.user.id} head={vaultHead} snapshot={snapshot} fetcher={fetcher} deviceError={deviceError} onUnlocked={async vault => {
      const id = generation.current;
      try { const latest = await verifyAccount(config.user!.id); if (id !== generation.current) { vault.dispose(); return; } await load(vault.snapshot(), latest, vault); }
      catch (reason) { vault.dispose(); throw reason; }
    }} onSkip={() => {
      if (!snapshot) return; setVaultGate(false);
      if (snapshot.documents.length) void load(snapshot, config).catch(reason => setError(reason.message));
      else void captureLegacyBackup().then(backup => { setLegacy(backup.documents.length || backup.media.length ? backup : null); setMigration(true); }).catch(reason => setError(reason.message));
    }}/> : config?.enabled && config.authenticated && config.passwordSetup ? <div className="cloud-auth-flow"><PasswordSetup email={config.user?.email ?? email} provider={config.passwordProvider} fetcher={fetcher} prepareProtection={config.passwordProvider && config.vaultAvailable && config.user ? secret => preparePasswordProtection(config.user!.id, secret, fetcher) : undefined} onSaved={secret => { submittedPassword.current = config.passwordProvider ? secret ?? null : null; return refresh(); }}/>{error && <div className="cloud-auth-retry"><p role="alert">{error}</p><button disabled={busy} onClick={() => void refresh()}>Tentar novamente</button></div>}</div> : migration && config && snapshot ? <CloudMigration backup={legacy} snapshot={snapshot} fetcher={fetcher} onContinue={() => void load(snapshot, config).catch(reason => setError(reason.message))} onDone={next => void load(next, config).catch(reason => setError(reason.message))}/> : <section className="cloud-card">
      <p className="cloud-kicker">DYNAMIC DIARY</p><h1>{config?.enabled && !config.authenticated ? passwordLink ? 'Criar ou recuperar senha' : 'Entrar' : 'Abrindo seus projetos'}</h1>
      {config?.enabled && !config.authenticated && <form onSubmit={event => { event.preventDefault(); void auth(codeSent && (!emailLink || showCode)); }}>
        <label>E-mail<input type="email" autoComplete="email" value={email} disabled={busy || codeSent} onChange={event => setEmail(event.target.value)} required/></label>
        {passwordLogin ? <>
          <label>Senha<input type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} disabled={busy} required maxLength={128}/></label>
          <button className="primary cloud-auth-submit" disabled={busy}>{busy ? 'Entrando…' : 'Entrar'}</button>
        </> : passwordLink ? <>
          {codeSent ? <p role="status">Abra o link enviado para seu e-mail neste navegador para criar ou redefinir sua senha. Depois, entre diretamente com ela.</p> : <p>Confirme seu e-mail uma vez para definir a senha. Nos próximos acessos, entre com e-mail e senha.</p>}
          <button className="primary cloud-auth-submit" disabled={busy}>{busy ? 'Enviando…' : codeSent ? 'Reenviar link de senha' : 'Enviar link para criar senha'}</button>
        </> : <>
          {codeSent && emailLink && <><p role="status">Abra o link enviado para seu e-mail neste navegador para entrar.</p><button type="button" aria-expanded={showCode} disabled={busy} onClick={() => setShowCode(value => !value)}>Já tenho um código</button></>}
          {codeSent && (!emailLink || showCode) && <label>Código recebido por e-mail<input inputMode="numeric" autoComplete="one-time-code" value={token} onChange={event => setToken(event.target.value)} required minLength={6} maxLength={12}/></label>}
          {(!codeSent || !emailLink || showCode) && <button className="primary cloud-auth-submit" disabled={busy}>{busy ? 'Aguarde…' : codeSent ? 'Confirmar e entrar' : emailLink ? 'Enviar link de acesso' : 'Enviar código'}</button>}
          {codeSent && <button type="button" disabled={busy} onClick={() => { setCodeSent(false); setShowCode(false); setToken(''); }}>{emailLink ? 'Reenviar link' : 'Usar outro código'}</button>}
        </>}
        {config.passwordAuth && <div className="cloud-auth-actions">
          {passwordLogin ? <><button type="button" className="cloud-text-button" disabled={busy} onClick={() => switchMethod('setup')}>Criar ou recuperar senha</button><button type="button" className="cloud-text-button" disabled={busy} onClick={() => switchMethod('link')}>Entrar com link</button></> : <button type="button" className="cloud-text-button" disabled={busy} onClick={() => switchMethod('password')}>Voltar para entrar com senha</button>}
        </div>}
      </form>}
      {busy && <p role="status">Carregando…</p>}{error && <><p role="alert">{error}</p><button disabled={busy} onClick={() => void refresh()}>Tentar novamente</button></>}
    </section>}
  </main>;
}
