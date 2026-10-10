import { Fragment, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

/** A deliberately small Markdown subset. User content only becomes React text nodes. */
function inline(text: string): ReactNode[] {
  const token = /(`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*|_[^_\n]+_)/g;
  const result: ReactNode[] = []; let start = 0, match: RegExpExecArray | null;
  while ((match = token.exec(text))) {
    if (match.index > start) result.push(text.slice(start, match.index));
    const value = match[0], key = match.index;
    result.push(value.startsWith('`') ? <code key={key}>{value.slice(1, -1)}</code>
      : value.startsWith('**') || value.startsWith('__') ? <strong key={key}>{value.slice(2, -2)}</strong>
        : <em key={key}>{value.slice(1, -1)}</em>);
    start = token.lastIndex;
  }
  if (start < text.length) result.push(text.slice(start));
  return result;
}

export function BoardRichText({ text }: { text: string }) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n'); const blocks: ReactNode[] = [];
  for (let index = 0; index < lines.length;) {
    const key = index, line = lines[index];
    if (/^\s*```/.test(line)) {
      const code: string[] = []; index++;
      while (index < lines.length && !/^\s*```/.test(lines[index])) code.push(lines[index++]);
      if (index < lines.length) index++;
      blocks.push(<pre key={key}><code>{code.join('\n')}</code></pre>); continue;
    }
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      const content = inline(heading[2]);
      blocks.push(heading[1].length === 1 ? <h1 key={key}>{content}</h1> : heading[1].length === 2 ? <h2 key={key}>{content}</h2> : <h3 key={key}>{content}</h3>); index++; continue;
    }
    const list = /^\s*(?:([-*])|\d+\.)\s+(.+)$/.exec(line);
    if (list) {
      const ordered = !list[1], entries: ReactNode[] = [];
      while (index < lines.length) {
        const next = /^\s*(?:([-*])|\d+\.)\s+(.+)$/.exec(lines[index]);
        if (!next || !next[1] !== ordered) break;
        entries.push(<li key={index}>{inline(next[2])}</li>); index++;
      }
      blocks.push(ordered ? <ol key={key}>{entries}</ol> : <ul key={key}>{entries}</ul>); continue;
    }
    if (!line.trim()) { index++; continue; }
    const paragraph: string[] = [line]; index++;
    while (index < lines.length && lines[index].trim() && !/^(?:#{1,3}\s|\s*```|\s*(?:[-*]|\d+\.)\s)/.test(lines[index])) paragraph.push(lines[index++]);
    blocks.push(<p key={key}>{paragraph.map((entry, i) => <Fragment key={i}>{i > 0 && <br />}{inline(entry)}</Fragment>)}</p>);
  }
  return <div className="board-rich-text">{blocks}</div>;
}

const tones = ['#e5e7eb', '#a78bfa', '#60a5fa', '#2dd4bf', '#fbbf24'];
export function BoardTextEditor({ text, color, fontSize, english, onCommit, onCancel }: {
  text: string; color: string; fontSize: number; english: boolean;
  onCommit(value: { text: string; color: string; fontSize: number }): void; onCancel(): void;
}) {
  const [draft, setDraft] = useState(text), [tone, setTone] = useState(color), [size, setSize] = useState(fontSize);
  const textarea = useRef<HTMLTextAreaElement>(null), finished = useRef(false), editor = useRef<HTMLDivElement>(null);
  const selection = useRef<{ start: number; end: number } | null>(null);
  useLayoutEffect(() => { textarea.current?.focus({ preventScroll: true }); }, []);
  useLayoutEffect(() => { if (!selection.current) return; textarea.current?.focus({ preventScroll: true }); textarea.current?.setSelectionRange(selection.current.start, selection.current.end); selection.current = null; }, [draft]);
  const commit = () => { if (finished.current) return; finished.current = true; onCommit({ text: draft, color: tone, fontSize: size }); };
  const cancel = () => { if (finished.current) return; finished.current = true; onCancel(); };
  const format = (kind: 'bold' | 'italic' | 'code' | 'heading' | 'list') => {
    const input = textarea.current; if (!input) return;
    const start = input.selectionStart, end = input.selectionEnd, chosen = draft.slice(start, end);
    if (kind === 'heading' || kind === 'list') {
      const first = draft.lastIndexOf('\n', Math.max(0, start - 1)) + 1, prefix = kind === 'heading' ? '# ' : '- ';
      const segment = draft.slice(first, end), formatted = segment.split('\n').map(line => line.startsWith(prefix) ? line.slice(prefix.length) : prefix + line).join('\n');
      const next = draft.slice(0, first) + formatted + draft.slice(end); if (next.length > 20_000) return;
      selection.current = { start: first, end: first + formatted.length }; setDraft(next); return;
    }
    const wrapper = kind === 'bold' ? '**' : kind === 'italic' ? '_' : chosen.includes('\n') ? '```\n' : '`';
    const closing = wrapper === '```\n' ? '\n```' : wrapper;
    const content = chosen || (english ? 'text' : 'texto');
    const value = wrapper + content + closing;
    if (draft.length - (end - start) + value.length > 20_000) return;
    selection.current = { start: start + wrapper.length, end: start + wrapper.length + content.length };
    setDraft(draft.slice(0, start) + value + draft.slice(end));
  };
  return <div ref={editor} className="board-text-editor nodrag nopan nowheel" onPointerDown={event => event.stopPropagation()} onMouseDown={event => event.stopPropagation()}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) commit(); }}>
    <div className="board-format-toolbar" role="toolbar" aria-label={english ? 'Text formatting' : 'Formatação do texto'}>
      {([{ kind: 'bold', label: english ? 'Bold' : 'Negrito', icon: <strong>B</strong> }, { kind: 'italic', label: english ? 'Italic' : 'Itálico', icon: <em>I</em> }, { kind: 'code', label: english ? 'Code' : 'Código', icon: <span aria-hidden="true">{'</>'}</span> }, { kind: 'heading', label: english ? 'Heading' : 'Título', icon: <span>H</span> }, { kind: 'list', label: english ? 'List' : 'Lista', icon: <span aria-hidden="true">☷</span> }] as const).map(action =>
        <button key={action.kind} type="button" title={action.label} aria-label={action.label} onMouseDown={event => event.preventDefault()} onClick={() => format(action.kind)}>{action.icon}</button>)}
      <span className="board-format-divider" />
      <select aria-label={english ? 'Text size' : 'Tamanho do texto'} value={size} onChange={event => setSize(Number(event.target.value))}>
        {[12, 14, 18, 24, 32, 48].map(value => <option key={value} value={value}>{value}</option>)}
        {![12, 14, 18, 24, 32, 48].includes(size) && <option value={size}>{size}</option>}
      </select>
      <div className="board-text-tones">{tones.map(value => <button key={value} type="button" aria-label={`${english ? 'Color' : 'Cor'} ${value}`} aria-pressed={tone === value} style={{ backgroundColor: value }} onMouseDown={event => event.preventDefault()} onClick={() => setTone(value)} />)}</div>
      <button type="button" className="board-text-done" aria-label={english ? 'Finish editing' : 'Concluir edição'} title={english ? 'Finish editing · Ctrl+Enter' : 'Concluir edição · Ctrl+Enter'} onMouseDown={event => event.preventDefault()} onClick={commit}>✓</button>
    </div>
    <textarea ref={textarea} value={draft} maxLength={20000} aria-label={english ? 'Board text' : 'Texto do quadro'} style={{ color: tone, fontSize: size }} placeholder={english ? 'Your idea…' : 'Sua ideia…'}
      onChange={event => setDraft(event.target.value.slice(0, 20_000))} onKeyDown={event => {
        event.stopPropagation();
        if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); commit(); }
        if (event.key === 'Escape') { event.preventDefault(); cancel(); }
        if ((event.ctrlKey || event.metaKey) && ['b', 'i'].includes(event.key.toLowerCase())) { event.preventDefault(); format(event.key.toLowerCase() === 'b' ? 'bold' : 'italic'); }
      }} />
  </div>;
}
