import { useState } from 'react';
import { downloadBackup, importBackup, readBackup, type MigrationBackup } from './migration';
import type { CloudSnapshot } from './runtime';

export function CloudMigration({ backup: initial, onContinue, onDone, snapshot, fetcher = fetch }: { backup: MigrationBackup | null; snapshot: CloudSnapshot; onContinue: () => void; onDone: (snapshot: CloudSnapshot) => void; fetcher?: typeof fetch }) {
  const [backup, setBackup] = useState(initial), [saved, setSaved] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [progress, setProgress] = useState('');
  async function run(action: () => Promise<void>) { setBusy(true); setError(''); try { await action(); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível concluir.'); } finally { setBusy(false); } }
  return <section className="cloud-card" aria-label="Migração dos dados locais">
    <p className="cloud-kicker">DYNAMIC DIARY · SEUS DADOS</p><h1>Leve seu trabalho para a nuvem</h1>
    <p>O legado deste navegador continuará intacto. Importe os dados completos ou escolha um backup global de outro dispositivo.</p>
    {backup && <p>{backup.documents.length} documentos · {backup.media.length} arquivos · {(backup.media.reduce((sum, file) => sum + file.size, 0) / 1024 / 1024).toFixed(1)} MB<br/><small>Manifesto SHA-256: {backup.manifestHash.slice(0, 16)}…</small></p>}
    <label className="cloud-file">Abrir backup global (.zip)<input type="file" accept=".zip,application/zip" disabled={busy} onChange={event => { const file = event.target.files?.[0]; if (file) void run(async () => { setBackup(await readBackup(file)); setSaved(false); }); event.target.value = ''; }}/></label>
    {backup && <div className="cloud-actions"><button disabled={busy} onClick={() => void run(async () => { await downloadBackup(backup); setSaved(true); })}>Baixar backup antes de importar</button><button className="primary" disabled={busy || !saved} onClick={() => void run(async () => onDone(await importBackup(backup, fetcher, setProgress)))}>Importar e conferir</button></div>}
    <p className="cloud-muted">As chaves de IA ficam fora do backup. Se houver dados remotos divergentes, a importação será recusada.</p>
    {busy && <p role="status">{progress || 'Preparando…'}</p>}{error && <p role="alert">{error}</p>}
    <button disabled={busy} onClick={onContinue}>{snapshot.documents.length ? 'Continuar com os dados da nuvem' : 'Começar na nuvem sem importar agora'}</button>
  </section>;
}
