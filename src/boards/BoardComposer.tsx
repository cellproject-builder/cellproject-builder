import { AudioTextarea } from '@/audio/AudioField';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { getActiveConfig, useConfigStore } from '@/config/store';
import { useWorkspaceStore } from '@/workspace/store';
import { requestWorkspaceUI } from '@/workspace/uiRequests';
import { ExplanationContent } from '@/components/Markdown';
import { FloatingPopup } from '@/visuals/ui/FloatingPopup';
import { DiagramView } from '@/visuals/diagram/DiagramView';
import type { ImageReference } from '@/visuals/types';
import { boardAISignature, generateBoardItem, searchBoardImages, importBoardReference, type BoardGenerationKind } from './generation';
import { boardItemSchema, type BoardItem } from './model';
import '@/visuals/ui/visuals.css';
import './board-composer.css';

const BoardModelPreview = lazy(() => import('./BoardModelPreview').then(module => ({ default: module.BoardModelPreview })));

export interface BoardComposerProps { boardId: string; kind: BoardGenerationKind; itemId?: string; onInsert: (item: BoardItem) => void; onClose: () => void; english?: boolean }
const pt = {
  diagram: 'Diagrama', model: 'Modelo 3D', image: 'Imagens', refine: 'Aprimorar texto', subtitle: 'Dynamic Board',
  prompt: 'O que você quer esboçar? Use @ para referenciar…', searchPrompt: 'Buscar uma imagem…', refinePrompt: 'Como podemos melhorar esse texto?',
  useContent: 'Usar conteúdo do quadro', generate: 'Gerar', search: 'Buscar', refineAction: 'Aprimorar', working: 'Preparando…', ready: 'Pronto',
  cancel: 'Cancelar', insert: 'Inserir no quadro', apply: 'Aplicar ajuste', mention: 'Referenciar item', remove: 'Remover referência',
  refsEmpty: 'Nenhum item encontrado', changed: 'O quadro mudou. Gere novamente com o contexto atual.', failure: 'Não foi possível concluir. Confira a conexão e tente novamente.',
  invalid: 'O resultado veio inválido. Tente ajustar o pedido.', incomplete: 'O resultado veio incompleto. Tente um pedido menor.', missing: 'Uma referência não está mais disponível.',
  diagramLabelsMissing: 'O desenho veio sem nomes ou legendas visíveis. Gere novamente para obter um diagrama explicativo.',
  configure: 'Configurar IA', noKey: 'Configure a IA para gerar.', restore: 'Restaurar', empty: 'Nenhuma imagem encontrada. Tente uma busca mais específica.',
  pixels: 'As imagens referenciadas serão enviadas à IA.', references: 'Referências do quadro', source: 'Abrir fonte', imageAdd: 'Adicionar imagem',
};
const en: typeof pt = {
  diagram: 'Diagram', model: '3D model', image: 'Images', refine: 'Refine text', subtitle: 'Dynamic Board',
  prompt: 'What would you like to sketch? Use @ for references…', searchPrompt: 'Search for an image…', refinePrompt: 'How should this text improve?',
  useContent: 'Use board content', generate: 'Generate', search: 'Search', refineAction: 'Refine', working: 'Preparing…', ready: 'Ready',
  cancel: 'Cancel', insert: 'Insert in board', apply: 'Apply adjustment', mention: 'Reference an item', remove: 'Remove reference',
  refsEmpty: 'No matching item', changed: 'The board changed. Generate again with its current context.', failure: 'Could not complete. Check your connection and try again.',
  invalid: 'The result was invalid. Try adjusting the request.', incomplete: 'The result was incomplete. Try a smaller request.', missing: 'A reference is no longer available.',
  diagramLabelsMissing: 'The drawing came without visible names or labels. Generate again to get an explanatory diagram.',
  configure: 'Configure AI', noKey: 'Configure AI to generate.', restore: 'Restore', empty: 'No images found. Try a more specific search.',
  pixels: 'Referenced images will be sent to AI.', references: 'Board references', source: 'Open source', imageAdd: 'Add image',
};
const itemLabel = (item: BoardItem) => item.kind === 'card' || item.kind === 'text' ? item.text.slice(0, 70) || 'Texto' : item.kind === 'image' ? item.label : item.kind === 'model' ? item.scene.label : item.kind === 'diagram' ? item.diagram.title : '';
type RequestContext = { signature: string; useContent: boolean; references: string[]; itemId?: string; changed: boolean };

/** Compact, board-scoped tool. Minimize only hides the window; requests continue. */
export function BoardComposer({ boardId, kind, itemId, onInsert, onClose, english = false }: BoardComposerProps) {
  const tr = english ? en : pt, title = tr[kind];
  const ready = useConfigStore(() => Boolean(getActiveConfig()));
  const board = useWorkspaceStore(state => state.boards[boardId]);
  const [prompt, setPrompt] = useState(''), [useContent, setUseContent] = useState(true), [references, setReferences] = useState<string[]>([]);
  const [mention, setMention] = useState<string | null>(null), [preview, setPreview] = useState<BoardItem | null>(null), [images, setImages] = useState<ImageReference[] | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [stale, setStale] = useState(false), [minimized, setMinimized] = useState(false);
  const [pendingImage, setPendingImage] = useState<string | null>(null), [addedImages, setAddedImages] = useState<string[]>([]);
  const controller = useRef<AbortController | null>(null), sequence = useRef(0), context = useRef<RequestContext | null>(null), textarea = useRef<HTMLTextAreaElement>(null);
  const latest = useRef({ onInsert, onClose }); latest.current = { onInsert, onClose };
  const matches = (board?.document.items ?? []).filter(item => item.kind !== 'drawing' && !references.includes(item.id) && itemLabel(item).toLocaleLowerCase().includes((mention ?? '').toLocaleLowerCase())).slice(0, 12);
  useEffect(() => {
    setPrompt(''); setUseContent(true); setReferences([]); setMention(null); setPreview(null); setImages(null); setBusy(false); setError(''); setStale(false); setMinimized(false); setPendingImage(null); setAddedImages([]); context.current = null;
    const off = useWorkspaceStore.subscribe(() => {
      const source = context.current; if (!source || source.changed) return;
      try { if (boardAISignature(boardId, source.useContent, source.references, source.itemId) === source.signature && (!useWorkspaceStore.getState().activeBoardId || useWorkspaceStore.getState().activeBoardId === boardId)) return; }
      catch { /* Removed or archived board also invalidates the result. */ }
      source.changed = true; setStale(true); controller.current?.abort();
    });
    return () => { off(); sequence.current++; controller.current?.abort(); controller.current = null; context.current = null; };
  }, [boardId, kind, itemId]);
  const clear = () => { context.current = null; setPreview(null); setImages(null); setError(''); setStale(false); setAddedImages([]); };
  const cancel = () => { sequence.current++; controller.current?.abort(); controller.current = null; context.current = null; setBusy(false); setPendingImage(null); };
  const close = () => { cancel(); latest.current.onClose(); };
  const errorText = (reason: unknown) => {
    const message = reason instanceof Error ? reason.message : '';
    if (message === 'diagramLabelsMissing') return tr.diagramLabelsMissing;
    return message.includes('ContextChanged') ? tr.changed : message.includes('Incomplete') ? tr.incomplete : message.includes('Invalid') ? tr.invalid : message.includes('ReferenceMissing') ? tr.missing : tr.failure;
  };
  async function submit() {
    if (controller.current || !prompt.trim() || (kind !== 'image' && !ready)) return;
    clear(); setMention(null);
    let signature: string;
    try { signature = boardAISignature(boardId, useContent, references, kind === 'refine' ? itemId : undefined); }
    catch (error) { setError(errorText(error)); return; }
    const source: RequestContext = { signature, useContent, references: [...references], itemId: kind === 'refine' ? itemId : undefined, changed: false };
    context.current = source; const operation = new AbortController(), current = ++sequence.current; controller.current = operation; setBusy(true);
    try {
      const input = { boardId, prompt, useContent, referenceIds: references, ...(kind === 'refine' ? { itemId } : {}) };
      const result = kind === 'image' ? await searchBoardImages(input, { signal: operation.signal }) : await generateBoardItem({ ...input, kind }, { signal: operation.signal });
      if (current !== sequence.current || controller.current !== operation) return;
      if (source.changed || boardAISignature(boardId, source.useContent, source.references, source.itemId) !== signature) { setStale(true); return; }
      if (Array.isArray(result)) setImages(result); else setPreview(result);
    } catch (error) {
      if (current !== sequence.current || controller.current !== operation) return;
      if (source.changed) setStale(true); else if (!operation.signal.aborted) setError(errorText(error));
    } finally { if (current === sequence.current && controller.current === operation) { controller.current = null; setBusy(false); } }
  }
  const isCurrent = () => {
    const source = context.current;
    if (!source || source.changed || stale) return false;
    try { if (boardAISignature(boardId, source.useContent, source.references, source.itemId) === source.signature) return true; } catch { /* context missing */ }
    source.changed = true; setStale(true); return false;
  };
  function insert() {
    if (!preview || !isCurrent()) return;
    try {
      let item = preview;
      if (kind === 'refine' && (preview.kind === 'card' || preview.kind === 'text')) {
        const live = useWorkspaceStore.getState().boards[boardId]?.document.items.find(item => item.id === preview.id);
        if (!live || (live.kind !== 'card' && live.kind !== 'text')) throw new Error('boardReferenceMissing');
        item = { ...live, text: preview.text };
      }
      latest.current.onInsert(boardItemSchema.parse(item)); close();
    } catch (error) { setError(errorText(error)); }
  }
  async function addImage(reference: ImageReference) {
    if (controller.current || addedImages.includes(reference.id) || !isCurrent()) return;
    const operation = new AbortController(), current = ++sequence.current; controller.current = operation; setPendingImage(reference.id); setError('');
    try {
      const item = await importBoardReference({ boardId, reference }, { signal: operation.signal });
      if (current !== sequence.current || operation.signal.aborted || !isCurrent()) return;
      // Own insertions update the search baseline; unrelated edits still invalidate it.
      const previous = context.current!; context.current = null;
      try { latest.current.onInsert(item); }
      finally { context.current = { ...previous, changed: false, signature: boardAISignature(boardId, previous.useContent, previous.references, previous.itemId) }; }
      setStale(false); setAddedImages(added => [...added, reference.id]);
    } catch (error) { if (current === sequence.current && !operation.signal.aborted) setError(errorText(error)); }
    finally { if (current === sequence.current && controller.current === operation) { controller.current = null; setPendingImage(null); } }
  }
  function reference(item: BoardItem) {
    if (references.length >= 12) return;
    clear(); setReferences(selected => [...selected, item.id]); setPrompt(text => text.replace(/(?:^|\s)@[^@\n]*$/, ' ').trimEnd()); setMention(null); textarea.current?.focus();
  }
  return <>
    <FloatingPopup kind={kind === 'image' ? 'search' : 'model'} title={title} subtitle={tr.subtitle} actionLabels={{ minimize: `${english ? 'Minimize' : 'Minimizar'}: ${title}`, close: `${english ? 'Close' : 'Fechar'}: ${title}` }} minimized={minimized} onMinimize={() => setMinimized(true)} onClose={close}>
      <div className="board-composer">
        <form onSubmit={event => { event.preventDefault(); void submit(); }}>
          <div className="board-composer-input">
            {!!references.length && <div className="board-reference-chips">{references.map(id => { const item = board?.document.items.find(item => item.id === id); return <span key={id}>{item ? itemLabel(item) : tr.missing}<button type="button" aria-label={`${tr.remove}: ${item ? itemLabel(item) : id}`} disabled={busy} onClick={() => { clear(); setReferences(current => current.filter(reference => reference !== id)); }}>×</button></span>; })}</div>}
            <AudioTextarea audioScope={`board:${boardId}:${itemId ?? kind}:prompt`} audioLanguage={english ? 'en' : 'pt'} ref={textarea} autoFocus rows={kind === 'image' ? 2 : 3} maxLength={4000} value={prompt} disabled={busy} aria-label={title}
              placeholder={kind === 'image' ? tr.searchPrompt : kind === 'refine' ? tr.refinePrompt : tr.prompt}
              onChange={event => { const text = event.target.value; clear(); setPrompt(text); const tail = text.slice(0, event.target.selectionStart); const match = /(?:^|\s)@([^@\n]*)$/.exec(tail); setMention(match?.[1] ?? null); }}
              onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && mention === null) { event.preventDefault(); void submit(); } if (event.key === 'Escape' && mention !== null) { event.preventDefault(); event.stopPropagation(); setMention(null); } }} />
            <div className="board-composer-toolbar"><button type="button" className="visual-icon-button" aria-label={tr.mention} title={tr.mention} disabled={busy || references.length >= 12} onClick={() => setMention(current => current === null ? '' : null)}>＠</button>
              <span className="board-composer-keyhint">Enter ↵</span>
              {busy ? <button type="button" className="ws-button small" onClick={cancel}>{tr.cancel}</button> : <button className="ws-button small primary" disabled={!prompt.trim() || (kind !== 'image' && !ready)}>{kind === 'image' ? tr.search : kind === 'refine' ? tr.refineAction : tr.generate}<span aria-hidden>↗</span></button>}
            </div>
          </div>
          {mention !== null && <div className="board-mention-list" role="group" aria-label={tr.references}>{matches.length ? matches.map(item => <button type="button" key={item.id} data-board-reference={item.id} onClick={() => reference(item)}><span>{item.kind === 'image' ? '▧' : item.kind === 'model' ? '◇' : item.kind === 'diagram' ? '⌘' : '≡'}</span>{itemLabel(item)}</button>) : <span>{tr.refsEmpty}</span>}</div>}
          <div className="board-composer-options"><label><input type="checkbox" checked={useContent} disabled={busy} onChange={event => { clear(); setUseContent(event.target.checked); }} />{tr.useContent}</label>{busy && <span role="status"><span className="visual-spinner" aria-hidden="true" />{tr.working}</span>}</div>
          {kind !== 'image' && references.some(id => board?.document.items.find(item => item.id === id)?.kind === 'image') && <p className="board-composer-hint">{tr.pixels}</p>}
          {!ready && kind !== 'image' && <p className="board-composer-config"><span>{tr.noKey}</span><button type="button" className="ws-button small" onClick={() => requestWorkspaceUI({ settings: true })}>{tr.configure}</button></p>}
          {(stale || error) && <p className="board-composer-error" role="alert">{stale ? tr.changed : error}</p>}
        </form>
        {preview && <div className={`board-composer-result${stale ? ' is-stale' : ''}`}>
          {preview.kind === 'diagram' ? <DiagramView diagram={preview.diagram} values={preview.values} english={english} onParameter={(id, value) => setPreview(item => item?.kind === 'diagram' ? { ...item, values: { ...item.values, [id]: value } } : item)} />
            : preview.kind === 'model' ? <><Suspense fallback={<span role="status">{tr.working}</span>}><BoardModelPreview scene={preview.scene} english={english} /></Suspense><small>{preview.scene.label}</small></>
              : (preview.kind === 'card' || preview.kind === 'text') ? <div className="board-text-preview"><ExplanationContent text={preview.text} /></div> : null}
          <div className="board-composer-apply"><button type="button" className="ws-button small primary" data-board-insert disabled={stale || busy} onClick={insert}>{kind === 'refine' ? tr.apply : tr.insert}<span aria-hidden>＋</span></button></div>
        </div>}
        {images && !images.length && <p className="board-composer-hint">{tr.empty}</p>}
        {images && images.length > 0 && <div className={`board-image-results${stale ? ' is-stale' : ''}`}>{images.map(image => <article key={image.id}>
          <button type="button" data-board-image={image.id} disabled={stale || pendingImage !== null || addedImages.includes(image.id)} aria-label={`${tr.imageAdd}: ${image.title}`} onClick={() => void addImage(image)}><img src={image.imageUrl} alt={image.title} loading="lazy" draggable={false} referrerPolicy="no-referrer" /><span>{addedImages.includes(image.id) ? '✓' : pendingImage === image.id ? '…' : '+'}</span></button>
          <strong title={image.title}>{image.title}</strong><a href={image.sourcePageUrl} target="_blank" rel="noopener noreferrer" title={tr.source}>{new URL(image.sourcePageUrl).hostname.replace(/^www\./, '')} ↗</a>
          {image.assessment && <small title={english ? 'Textual relevance; pixels are not assessed.' : 'Relevância textual; os pixels não são avaliados.'}>{'kind' in image.assessment ? 'TypeSafe · ' : ''}{image.assessment.score.toFixed(1)}/3</small>}
        </article>)}</div>}
      </div>
    </FloatingPopup>
    {minimized && <button type="button" className="board-composer-restore liquid-glass" data-board-restore aria-label={`${tr.restore}: ${title}`} onClick={() => setMinimized(false)}><span aria-hidden>{busy || pendingImage ? '◌' : error || stale ? '!' : preview || images ? '✓' : '◇'}</span><span><b>{title}</b><small>{busy || pendingImage ? tr.working : tr.ready}</small></span><span aria-hidden>↖</span></button>}
  </>;
}
