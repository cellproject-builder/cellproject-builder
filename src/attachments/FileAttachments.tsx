import { useEffect, useRef, useState } from 'react';
import { extractPlanFile, mergePlanFiles, PLAN_FILE_ACCEPT, attachmentError, type PlanFile } from './files';
import './attachments.css';

interface Props { files: PlanFile[]; onChange: (files: PlanFile[]) => void; english: boolean; disabled?: boolean; compact?: boolean; scopeKey: string; onBusy?: (busy: boolean) => void }
export function FileAttachments({ files, onChange, english, disabled, compact, scopeKey, onBusy }: Props) {
  const input = useRef<HTMLInputElement>(null), request = useRef<AbortController | null>(null);
  const current = useRef({ files, onChange, scopeKey, onBusy }); current.current = { files, onChange, scopeKey, onBusy };
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => { setBusy(false); setError(''); return () => { request.current?.abort(); current.current.onBusy?.(false); }; }, [scopeKey]);
  async function attach(selected: File[]) {
    if (busy || disabled) return;
    const controller = new AbortController(); request.current = controller;
    const initialScope = scopeKey; setBusy(true); setError(''); onBusy?.(true);
    try {
      const added: PlanFile[] = [];
      for (const file of selected) added.push(await extractPlanFile(file, controller.signal));
      controller.signal.throwIfAborted(); if (current.current.scopeKey !== initialScope) return;
      current.current.onChange(mergePlanFiles(current.current.files, added));
    } catch (reason) { if (!controller.signal.aborted && current.current.scopeKey === initialScope) setError(attachmentError(reason, english)); }
    finally { if (request.current === controller && !controller.signal.aborted) { request.current = null; setBusy(false); current.current.onBusy?.(false); } }
  }
  return <div className={`plan-attachments ${compact ? 'is-compact' : ''}`}>
    <input ref={input} type="file" multiple accept={PLAN_FILE_ACCEPT} aria-label={english ? 'Attach files' : 'Anexar arquivos'} hidden onChange={event => { const selected = [...(event.target.files ?? [])]; event.target.value = ''; void attach(selected); }} />
    <button type="button" className={compact ? 'plan-attachment-icon' : 'plan-attachment-add'} disabled={disabled || busy || files.length >= 12} aria-label={english ? 'Attach files' : 'Anexar arquivos'} title={english ? 'PDF, DOCX, Markdown and source code' : 'PDF, DOCX, Markdown e código'} onClick={() => input.current?.click()}>
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="m8 12 7-7a3 3 0 0 1 4 4l-9 9a5 5 0 0 1-7-7l10-10M6 14l9-9" strokeLinecap="round" strokeLinejoin="round" /></svg>
      {!compact && <span>{busy ? (english ? 'Reading…' : 'Lendo…') : (english ? 'Attach references' : 'Anexar referências')}</span>}
    </button>
    {!compact && <small>{english ? 'PDF, DOCX, Markdown and code · text extracted locally' : 'PDF, DOCX, Markdown e código · texto extraído localmente'}</small>}
    {busy && compact && <small role="status">{english ? 'Reading…' : 'Lendo…'}</small>}
    {files.length > 0 && <div className="plan-attachment-list">{files.map(file => <div className="plan-attachment-chip" key={file.id}>
      <details><summary title={file.name}>{file.name}<small>{file.truncated ? (english ? 'excerpt' : 'trecho') : file.kind.toUpperCase()}</small></summary><div className="plan-attachment-preview"><strong>{file.name}</strong><p>{english ? 'Source text saved locally. Original binary is not archived.' : 'Texto da fonte salvo neste dispositivo. O arquivo binário original não é arquivado.'}</p><pre>{file.text.slice(0, 8000)}</pre></div></details>
      <button type="button" aria-label={`${english ? 'Remove file' : 'Remover anexo'} ${file.name}`} disabled={disabled || busy} onClick={() => onChange(files.filter(item => item.id !== file.id))}>×</button>
    </div>)}</div>}
    {error && <p className="plan-attachment-error" role="alert">{error}</p>}
  </div>;
}
