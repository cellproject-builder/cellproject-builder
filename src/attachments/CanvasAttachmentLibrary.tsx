import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { Paperclip } from 'lucide-react';
import { CloseIcon, FileTextIcon, ImageIcon, Link1Icon, PlusIcon, SearchIcon, TrashIcon, UploadIcon } from '@/components/ui/SoftIcons';
import { CANVAS_ATTACHMENT_DRAG_TYPE, safeResourceUrl, type CanvasResource } from './canvasModel';
import './canvas-attachments.css';

export interface CanvasAttachmentLibraryProps {
  resources: CanvasResource[];
  english?: boolean;
  importing?: boolean;
  error?: string;
  onImport: (files: File[]) => void;
  onAddLink: (url: string) => void;
  onPlace: (ids: string[]) => void;
  onOpen: (resource: CanvasResource) => void;
  onRemove: (id: string) => void;
}

const FILE_ACCEPT = 'application/pdf,image/*,text/plain,text/markdown,.pdf,.txt,.md';

function fileSize(size: number) {
  if (size < 1024) return `${size} B`;
  return size < 1024 * 1024 ? `${Math.round(size / 1024)} KB` : `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function CanvasAttachmentLibrary({ resources, english = false, importing = false, error,
  onImport, onAddLink, onPlace, onOpen, onRemove }: CanvasAttachmentLibraryProps) {
  const trigger = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null), searchInput = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false), [query, setQuery] = useState(''), [kind, setKind] = useState('all');
  const [link, setLink] = useState(''), [linkError, setLinkError] = useState('');
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [position, setPosition] = useState<CSSProperties>({});
  const id = useId(), panelId = `${id}-attachments`, headingId = `${id}-heading`, errorId = `${id}-link-error`;
  const title = english ? 'Attachments' : 'Anexos';
  const kinds = { all: english ? 'All types' : 'Todos os tipos', pdf: 'PDF', image: english ? 'Images' : 'Imagens', text: english ? 'Text' : 'Texto', link: 'Links' };
  const selectedIds = resources.filter(resource => selected.has(resource.id)).map(resource => resource.id);
  const search = query.trim().toLocaleLowerCase();
  const visible = resources.filter(resource => (kind === 'all' || resource.kind === kind)
    && (!search || `${resource.name} ${resource.url ?? ''}`.toLocaleLowerCase().includes(search)));
  const close = useCallback(() => { setOpen(false); trigger.current?.focus(); }, []);
  const updatePosition = useCallback(() => {
    const rect = trigger.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(360, Math.max(0, window.innerWidth - 24));
    const height = Math.min(520, Math.max(0, window.innerHeight - 24));
    const below = window.innerHeight - rect.bottom - 20;
    const top = below < 240 && rect.top > below ? Math.max(12, rect.top - height - 8) : Math.max(12, rect.bottom + 8);
    setPosition({ width, left: Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12)), top, maxHeight: Math.max(0, window.innerHeight - top - 12) });
  }, []);

  useLayoutEffect(() => { if (open) { updatePosition(); searchInput.current?.focus(); } }, [open, updatePosition]);
  useEffect(() => {
    if (!open) return;
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault(); event.stopPropagation(); close();
    };
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !panel.current?.contains(event.target) && !trigger.current?.contains(event.target)) close();
    };
    window.addEventListener('keydown', keydown, true);
    document.addEventListener('pointerdown', outside);
    window.addEventListener('resize', updatePosition);
    document.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('keydown', keydown, true); document.removeEventListener('pointerdown', outside);
      window.removeEventListener('resize', updatePosition); document.removeEventListener('scroll', updatePosition, true);
    };
  }, [open, close, updatePosition]);

  function select(resourceId: string) {
    setSelected(current => { const next = new Set(current); if (next.has(resourceId)) next.delete(resourceId); else next.add(resourceId); return next; });
  }

  return <div className="canvas-attachment-library nodrag nopan">
    <button ref={trigger} type="button" className="canvas-attachment-trigger" aria-label={title} title={`${title} (${resources.length})`}
      aria-expanded={open} aria-controls={open ? panelId : undefined} aria-haspopup="dialog" onClick={() => open ? close() : setOpen(true)}>
      <Paperclip size={18} strokeWidth={1.7} aria-hidden="true" />
      {resources.length > 0 && <span className="canvas-attachment-badge" aria-hidden="true">{resources.length > 99 ? '99+' : resources.length}</span>}
    </button>
    {open && createPortal(<div ref={panel} id={panelId} role="dialog" aria-labelledby={headingId} className="canvas-attachment-panel nodrag nopan nowheel" style={position}
      onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}>
      <header className="canvas-attachment-heading"><h2 id={headingId}>{title}<span>{resources.length}</span></h2>
        <button type="button" className="canvas-attachment-icon" aria-label={english ? 'Close attachments' : 'Fechar anexos'} onClick={close}><CloseIcon size={17} /></button>
      </header>
      <div className="canvas-attachment-import">
        <input ref={fileInput} type="file" multiple accept={FILE_ACCEPT} hidden disabled={importing} aria-label={english ? 'Choose files' : 'Escolher arquivos'}
          onChange={event => { const files = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = ''; if (!importing && files.length) onImport(files); }} />
        <button type="button" className="canvas-attachment-upload" disabled={importing} aria-label={english ? 'Upload files' : 'Enviar arquivos'} onClick={() => fileInput.current?.click()}>
          <UploadIcon size={16} /><span>{english ? 'Upload files' : 'Enviar arquivos'}</span><small>PDF · {english ? 'images' : 'imagens'} · TXT · MD</small>
        </button>
        <form className="canvas-attachment-link" noValidate onSubmit={event => {
          event.preventDefault(); if (importing) return;
          const url = link.trim();
          try { safeResourceUrl(url); } catch { setLinkError(english ? 'Enter a valid HTTP or HTTPS link.' : 'Informe um link HTTP ou HTTPS válido.'); return; }
          setLinkError(''); onAddLink(url); setLink('');
        }}>
          <Link1Icon size={16} />
          <input type="url" value={link} placeholder="https://" aria-label={english ? 'Link URL' : 'Endereço do link'} disabled={importing}
            aria-invalid={linkError ? true : undefined} aria-describedby={linkError ? errorId : undefined} onChange={event => { setLink(event.target.value); setLinkError(''); }} />
          <button type="submit" className="canvas-attachment-icon" disabled={importing || !link.trim()} aria-label={english ? 'Add link' : 'Adicionar link'} title={english ? 'Add link' : 'Adicionar link'}><PlusIcon size={17} /></button>
        </form>
        {linkError && <p id={errorId} className="canvas-attachment-error" role="alert">{linkError}</p>}
        {importing && <p className="canvas-attachment-status" role="status">{english ? 'Importing…' : 'Importando…'}</p>}
        {error && <p className="canvas-attachment-error" role="alert">{error}</p>}
      </div>
      <div className="canvas-attachment-filters">
        <label className="canvas-attachment-search"><SearchIcon size={15} /><input ref={searchInput} type="search" value={query} placeholder={english ? 'Search attachments' : 'Buscar anexos'}
          aria-label={english ? 'Search attachments' : 'Buscar anexos'} onChange={event => setQuery(event.target.value)} /></label>
        <select aria-label={english ? 'Attachment type' : 'Tipo de anexo'} value={kind} onChange={event => setKind(event.target.value)}>
          {Object.entries(kinds).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </div>
      <ul className="canvas-attachment-list" aria-label={title}>
        {visible.map(resource => {
          const Icon = resource.kind === 'image' ? ImageIcon : resource.kind === 'link' ? Link1Icon : FileTextIcon;
          const metadata = [kinds[resource.kind], resource.kind === 'link' ? resource.url : fileSize(resource.size), resource.pages ? `${resource.pages} ${english ? 'pages' : 'páginas'}` : null].filter(Boolean).join(' · ');
          return <li key={resource.id} data-resource-id={resource.id} data-selected={selected.has(resource.id)} draggable onClick={event => {
            if (!(event.target instanceof Element) || !event.target.closest('button,input,label')) onOpen(resource);
          }} onDragStart={event => {
            event.dataTransfer.setData(CANVAS_ATTACHMENT_DRAG_TYPE, JSON.stringify({ ids: selected.has(resource.id) ? selectedIds : [resource.id] }));
            event.dataTransfer.effectAllowed = 'copy';
          }}>
            <label className="canvas-attachment-select"><input type="checkbox" checked={selected.has(resource.id)} aria-label={`${english ? 'Select' : 'Selecionar'} ${resource.name}`} onChange={() => select(resource.id)} /></label>
            <Icon className="canvas-attachment-kind" size={18} />
            <button type="button" className="canvas-attachment-open" aria-label={`${english ? 'Open' : 'Abrir'} ${resource.name}`} onClick={() => onOpen(resource)} title={resource.name}>
              <span>{resource.name}</span><small>{metadata}</small>
            </button>
            <button type="button" className="canvas-attachment-icon" aria-label={english ? `Place ${resource.name} on canvas` : `Colocar ${resource.name} no canvas`} title={english ? 'Place on canvas' : 'Colocar no canvas'} onClick={() => onPlace([resource.id])}><PlusIcon size={17} /></button>
            <button type="button" className="canvas-attachment-icon canvas-attachment-remove" aria-label={english ? `Remove ${resource.name} from attachments` : `Remover ${resource.name} dos anexos`}
              title={english ? 'Remove from attachments' : 'Remover dos anexos'} onClick={() => { setSelected(current => { const next = new Set(current); next.delete(resource.id); return next; }); onRemove(resource.id); }}><TrashIcon size={15} /></button>
          </li>;
        })}
        {visible.length === 0 && <li className="canvas-attachment-empty">{resources.length === 0 ? (english ? 'No attachments yet' : 'Nenhum anexo ainda') : (english ? 'No attachments found' : 'Nenhum anexo encontrado')}</li>}
      </ul>
      {selectedIds.length > 0 && <footer className="canvas-attachment-selection"><span>{selectedIds.length} {english ? 'selected' : 'selecionados'}</span>
        <button type="button" className="canvas-attachment-place" aria-label={english ? 'Place selection on canvas' : 'Colocar seleção no canvas'} onClick={() => onPlace(selectedIds)}><PlusIcon size={15} />{english ? 'Place selection' : 'Colocar seleção'}</button>
        <button type="button" className="canvas-attachment-icon" aria-label={english ? 'Clear selection' : 'Limpar seleção'} onClick={() => setSelected(new Set())}><CloseIcon size={15} /></button>
      </footer>}
    </div>, document.body)}
  </div>;
}
