import { useId, useState } from 'react';
import { CloudHttpError, cloudJson, mutationHeaders } from './runtime';

/** Only mounted after the server confirms a password-setup session from an email link. */
export function PasswordSetup({ email, onSaved, fetcher = fetch }: { email: string; onSaved: () => Promise<void>; fetcher?: typeof fetch }) {
  const [password, setPassword] = useState(''), [confirmation, setConfirmation] = useState('');
  const [visible, setVisible] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [expired, setExpired] = useState(false), [linkSent, setLinkSent] = useState(false);
  const helpId = useId(), errorId = useId();
  async function save() {
    if (busy || expired) return;
    setError('');
    if (Array.from(password).length < 10) { setError('Use uma senha com pelo menos 10 caracteres.'); return; }
    if (new TextEncoder().encode(password).byteLength > 72) { setError('A senha excede o limite permitido; reduza o tamanho. Acentos e emojis ocupam mais espaço.'); return; }
    if (password !== confirmation) { setError('As senhas precisam ser iguais.'); return; }
    setBusy(true);
    try {
      const result = await cloudJson<{ saved: boolean }>('/api/auth/password', { method: 'POST', headers: mutationHeaders, body: JSON.stringify({ password }) }, fetcher);
      if (!result.saved) throw new Error('Não foi possível salvar a senha. Solicite um novo link e tente novamente.');
      setPassword(''); setConfirmation(''); setVisible(false); await onSaved();
    } catch (reason) {
      const status = reason instanceof CloudHttpError ? reason.status : 0;
      if (status === 401 || status === 403) { setExpired(true); setPassword(''); setConfirmation(''); setVisible(false); setError('Este link de senha expirou. Solicite um novo link para continuar.'); }
      else if (status === 400 || status === 422) setError('Esta senha não foi aceita. Escolha outra senha com pelo menos 10 caracteres.');
      else if (status === 429) setError('Você fez muitas tentativas. Aguarde um pouco e tente novamente.');
      else setError('Não foi possível salvar a senha agora. Tente novamente.');
    }
    finally { setBusy(false); }
  }
  async function renew() {
    if (busy) return;
    setBusy(true); setError('');
    try { await cloudJson('/api/auth/password/setup-link', { method: 'POST', headers: mutationHeaders, body: JSON.stringify({ email }) }, fetcher); setLinkSent(true); }
    catch { setError('Não foi possível enviar o link de senha. Tente novamente em instantes.'); }
    finally { setBusy(false); }
  }
  return <section className="cloud-card">
    <p className="cloud-kicker">DYNAMIC DIARY</p><h1>Criar nova senha</h1>
    <p>Defina sua senha para entrar com {email} nos próximos acessos.</p>
    <form onSubmit={event => { event.preventDefault(); void save(); }}>
      <p className="cloud-muted" id={helpId}>Use pelo menos 10 caracteres. Nos próximos acessos, entre com e-mail e senha.</p>
      <label>Nova senha<input type={visible ? 'text' : 'password'} autoComplete="new-password" minLength={10} maxLength={72} required value={password} disabled={busy || expired} aria-describedby={`${helpId}${error ? ` ${errorId}` : ''}`} onChange={event => setPassword(event.target.value)}/></label>
      <label>Confirmar nova senha<input type={visible ? 'text' : 'password'} autoComplete="new-password" minLength={10} maxLength={72} required value={confirmation} disabled={busy || expired} aria-describedby={error ? errorId : undefined} onChange={event => setConfirmation(event.target.value)}/></label>
      <div className="cloud-auth-actions"><button type="button" className="cloud-text-button" aria-pressed={visible} disabled={busy || expired} onClick={() => setVisible(value => !value)}>{visible ? 'Ocultar senha' : 'Mostrar senha'}</button></div>
      {error && <p role="alert" id={errorId}>{error}</p>}
      {expired ? <><button type="button" className="primary cloud-auth-submit" disabled={busy} onClick={() => void renew()}>{busy ? 'Enviando…' : 'Enviar novo link de senha'}</button>{linkSent && <p role="status">Abra o novo link enviado para seu e-mail neste navegador para criar a senha.</p>}</> : <button className="primary cloud-auth-submit" disabled={busy}>{busy ? 'Salvando senha…' : 'Salvar senha e continuar'}</button>}
    </form>
  </section>;
}
