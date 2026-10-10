import { useContext, useEffect, useLayoutEffect, useRef, useState, type TextareaHTMLAttributes } from 'react';
import { nanoid } from 'nanoid';
import { EnterFullScreenIcon, ExitFullScreenIcon, Pencil1Icon, ImageIcon, MagicWandIcon } from '@/components/ui/SoftIcons';
import { useLocaleStore, useT } from '@/i18n';
import { Modal } from '@/components/ui/Modal';
import { ExpandedChrome } from '@/components/ui/ExpandedChrome';
import { toast } from '@/components/ui/Toast';
import { flushWorkspacePersistence, useWorkspaceStore } from './store';
import type { BlockType, Note, NoteBlock } from './types';
import { Empty, Icon, attempt } from './ui';
import { NoteTextActions } from './NoteTextActions';
import { NotesLibrary, type NoteFilter } from './NotesLibrary';
import { PageHeaderContext } from './PageHeader';
import { NoteNotebook, type NoteNotebookTools } from './NoteNotebook';
import { NoteInkOverlay } from './NoteInkOverlay';
import './NotesNotebook.css';

function AutoText(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const resize = () => {
    const input = ref.current;
    if (input) { input.style.height = '0px'; input.style.height = `${Math.max(26, input.scrollHeight)}px`; }
  };
  useLayoutEffect(() => {
    resize();
  }, [props.value]);
  useEffect(() => {
    const input = ref.current;
    if (!input || typeof ResizeObserver === 'undefined') return;
    let width = input.getBoundingClientRect().width;
    const observer = new ResizeObserver(([entry]) => {
      if (Math.abs(entry.contentRect.width - width) < .5) return;
      width = entry.contentRect.width;
      resize();
    });
    observer.observe(input);
    return () => observer.disconnect();
  }, []);
  return <textarea {...props} ref={ref} rows={1} />;
}

function NoteEditor({ note, onTrash, onRestore, maximized, onToggleMaximized }: { note: Note; onTrash: () => void; onRestore: () => void; maximized: boolean; onToggleMaximized: () => void }) {
  const tr = useT().workspace;
  const english = useLocaleStore(state => state.locale) === 'en';
  const projects = useWorkspaceStore((s) => s.projects);
  const tasks = useWorkspaceStore((s) => s.tasks);
  const folders = useWorkspaceStore((s) => s.folders);
  const [activeBlock, setActiveBlock] = useState(note.blocks[0]?.id);
  const [connections, setConnections] = useState(false);
  const [notebookVisible, setNotebookVisible] = useState(!!note.canvas);
  const [drawing, setDrawing] = useState(false);
  const notebook = useRef<NoteNotebookTools>(null);
  const [saveState, setSaveState] = useState<'saving' | 'saved' | 'error'>('saving');
  const editorRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null), inkToolsRef = useRef<HTMLDivElement>(null);
  const trashed = note.deletedAt !== null;
  const patch = (value: Parameters<ReturnType<typeof useWorkspaceStore.getState>['updateNote']>[1]) => attempt(() => useWorkspaceStore.getState().updateNote(note.id, value));
  const updateBlock = (id: string, value: Partial<NoteBlock>) => patch({ blocks: note.blocks.map((block) => block.id === id ? { ...block, ...value } : block) });
  const selectedBlock = note.blocks.find((b) => b.id === activeBlock) ?? note.blocks[0];
  const focusBlock = (id: string) => requestAnimationFrame(() => editorRef.current?.querySelector<HTMLTextAreaElement>(`[data-block="${id}"]`)?.focus());
  const addBlock = (type: BlockType, afterId = activeBlock) => {
    const block: NoteBlock = { id: nanoid(10), type, text: '', ...(type === 'check' ? { checked: false } : {}) };
    const blocks = [...note.blocks], index = blocks.findIndex((b) => b.id === afterId);
    blocks.splice(index >= 0 ? index + 1 : blocks.length, 0, block);
    patch({ blocks }); setActiveBlock(block.id); focusBlock(block.id);
  };
  const removeBlock = (id: string) => {
    if (note.blocks.length <= 1) { updateBlock(id, { text: '', type: 'text' }); return; }
    const index = note.blocks.findIndex((b) => b.id === id), previous = note.blocks[Math.max(0, index - 1)];
    patch({ blocks: note.blocks.filter((b) => b.id !== id) }); setActiveBlock(previous.id); focusBlock(previous.id);
  };
  useEffect(() => {
    let current = true;
    setSaveState('saving');
    void flushWorkspacePersistence().then(() => { if (current) setSaveState('saved'); }).catch(() => { if (current) setSaveState('error'); });
    return () => { current = false; };
  }, [note]);
  return <section className={`ws-note-editor${drawing ? ' is-drawing' : ''}`} ref={editorRef}>
    <ExpandedChrome expanded={maximized} label={note.title || tr.untitled} english={english} onRestore={onToggleMaximized}>
    <div className="ws-note-toolbar">
      <div className="ws-note-format" hidden={drawing}>{!trashed && <>
        <select aria-label={tr.text} value={selectedBlock?.type ?? 'text'} onChange={(e) => selectedBlock && updateBlock(selectedBlock.id, { type: e.target.value as BlockType })}>{(['text', 'heading', 'bullet', 'check'] as const).map((type) => <option key={type} value={type}>{type === 'check' ? tr.checklist : tr[type]}</option>)}</select>
        <button aria-label={tr.bold} title={tr.bold} aria-pressed={!!selectedBlock?.bold} className="ws-icon-button note-bold" onMouseDown={(e) => e.preventDefault()} onClick={() => selectedBlock && updateBlock(selectedBlock.id, { bold: !selectedBlock.bold })}>B</button>
        <button aria-label={tr.italic} title={tr.italic} aria-pressed={!!selectedBlock?.italic} className="ws-icon-button note-italic" onMouseDown={(e) => e.preventDefault()} onClick={() => selectedBlock && updateBlock(selectedBlock.id, { italic: !selectedBlock.italic })}>I</button>
        <button className="ws-icon-button" aria-label={tr.checklist} title={tr.checklist} onMouseDown={(e) => e.preventDefault()} onClick={() => { if (selectedBlock && !selectedBlock.text) updateBlock(selectedBlock.id, { type: 'check', checked: false }); else addBlock('check'); }}><Icon name="check" /></button>
      </>}</div>
      {!trashed && <div className="ws-note-insert-tools">
        <button type="button" className="ws-icon-button" aria-label={drawing ? english ? 'Back to text' : 'Voltar ao texto' : english ? 'Draw in note' : 'Desenhar na nota'} title={drawing ? english ? 'Back to text' : 'Voltar ao texto' : english ? 'Draw in note' : 'Desenhar na nota'} aria-pressed={drawing} onClick={() => setDrawing(!drawing)}><Pencil1Icon aria-hidden="true" /></button>
        {!notebookVisible && <><button type="button" className="ws-icon-button" aria-label={english ? 'Add image to note' : 'Adicionar imagem à nota'} title={english ? 'Add image to note' : 'Adicionar imagem à nota'} onClick={() => notebook.current?.addImage()}><ImageIcon aria-hidden="true" /></button>
        <button type="button" className="ws-icon-button" aria-label={english ? 'Generate note diagram' : 'Gerar diagrama na nota'} title={english ? 'Generate note diagram' : 'Gerar diagrama na nota'} onClick={() => notebook.current?.generate()}><MagicWandIcon aria-hidden="true" /></button></>}
      </div>}
      <span className={`ws-save-state ${saveState === 'error' ? 'save-error' : ''}`} role="status">{saveState === 'saved' ? tr.saved : saveState === 'error' ? tr.saveFailed : tr.saving}</span>
      {saveState === 'error' && <button className="ws-icon-button" aria-label={tr.retrySave} title={tr.retrySave} onClick={() => patch({})}><Icon name="scrum" size={15} /></button>}
      {trashed ? <button className="ws-button small" onClick={onRestore}>{tr.restore}</button> : <>
        <button className={`ws-icon-button ws-note-secondary ${note.pinned ? 'is-pinned' : ''}`} aria-label={note.pinned ? tr.unpin : tr.pin} title={note.pinned ? tr.unpin : tr.pin} aria-pressed={note.pinned} onClick={() => patch({ pinned: !note.pinned })}><Icon name="pin" /></button>
        <button className="ws-icon-button ws-note-secondary" aria-label={tr.noteLink} title={tr.noteLink} aria-expanded={connections} onClick={() => setConnections(!connections)}><Icon name="projects" /></button>
        <button className="ws-icon-button ws-note-secondary" aria-label={tr.trashNote} title={tr.trashNote} onClick={onTrash}><Icon name="trash" /></button>
      </>}
      <button type="button" className="ws-icon-button" aria-label={maximized ? tr.restoreEditor : tr.maximizeEditor} title={maximized ? `${tr.restoreEditor} (Esc)` : tr.maximizeEditor} aria-pressed={maximized} onMouseDown={(e) => e.preventDefault()} onClick={onToggleMaximized}>{maximized ? <ExitFullScreenIcon aria-hidden="true" /> : <EnterFullScreenIcon aria-hidden="true" />}</button>
    </div>
    <div className="ws-note-ink-tools-host" ref={inkToolsRef} hidden={(!drawing && !notebookVisible && !note.canvas) || trashed} />
    {connections && !trashed && <div className="ws-note-connections">
      <label>{tr.project}<select value={note.projectId ?? ''} onChange={(e) => patch({ projectId: e.target.value || null, taskId: null })}><option value="">{tr.noProject}</option>{Object.values(projects).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <label>{tr.linkedTask}<select disabled={!note.projectId} value={note.taskId ?? ''} onChange={(e) => patch({ taskId: e.target.value || null })}><option value="">{tr.noTask}</option>{Object.values(tasks).filter((t) => t.projectId === note.projectId).map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}</select></label>
      <label>{tr.folder}<select value={note.folderId ?? ''} onChange={(e) => patch({ folderId: e.target.value || null })}><option value="">{tr.noFolder}</option>{Object.values(folders).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>
    </div>}
    </ExpandedChrome>
    <div className="ws-note-paper">
      <div className="ws-note-document" ref={bodyRef} data-note-document>
      <p className="ws-note-date">{new Intl.DateTimeFormat(document.documentElement.lang || 'pt-BR', { dateStyle: 'long', timeStyle: 'short' }).format(note.updatedAt)}</p>
      <AutoText className="ws-note-title" data-ink-anchor="title" aria-label={tr.noteTitle} placeholder={tr.untitled} value={note.title} readOnly={trashed} onChange={(e) => patch({ title: e.target.value })} />
      {note.projectId && <span className="ws-note-project-label"><Icon name="projects" size={13} />{projects[note.projectId]?.name}{note.taskId && ` / ${tasks[note.taskId]?.title ?? ''}`}</span>}
      <div className="ws-note-blocks">{note.blocks.map((block) => <div className={`ws-note-block type-${block.type} ${block.checked ? 'is-checked' : ''} ${block.bold ? 'is-bold' : ''} ${block.italic ? 'is-italic' : ''}`} key={block.id} data-ink-anchor={`block:${block.id}`}>
        {!trashed && <NoteTextActions noteId={note.id} block={block} input={() => editorRef.current?.querySelector<HTMLTextAreaElement>(`[data-block="${block.id}"]`)} onFormat={(value) => updateBlock(block.id, value)} />}
        {block.type === 'check' && <input type="checkbox" disabled={trashed} aria-label={block.text || tr.checklist} checked={!!block.checked} onChange={(e) => updateBlock(block.id, { checked: e.target.checked })} />}
        {block.type === 'bullet' && <span className="ws-bullet" aria-hidden>•</span>}
        <AutoText data-block={block.id} aria-label={block.type === 'check' ? tr.checklist : tr[block.type]} value={block.text} placeholder={tr.notePlaceholder} readOnly={trashed} onFocus={() => setActiveBlock(block.id)} onChange={(e) => updateBlock(block.id, { text: e.target.value })} onKeyDown={(e) => {
          if (trashed) return;
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); addBlock(block.type === 'heading' ? 'text' : block.type, block.id); }
          if (e.key === 'Backspace' && !block.text && note.blocks.length > 1) { e.preventDefault(); removeBlock(block.id); }
        }} />
        {!trashed && <button className="ws-remove-block" aria-label={tr.removeBlock} onClick={() => removeBlock(block.id)}><Icon name="close" size={13} /></button>}
      </div>)}</div>
      {!trashed && <button className="ws-add-block" onClick={() => addBlock('text')}><Icon name="plus" size={14} />{tr.addBlock}</button>}
      <NoteNotebook ref={notebook} note={note} editorRef={editorRef} visible={notebookVisible || !!note.canvas} onReveal={() => setNotebookVisible(true)} english={english} toolsRef={inkToolsRef} toolsVisible={!drawing && (notebookVisible || !!note.canvas)}/>
      <NoteInkOverlay note={note} bodyRef={bodyRef} toolsRef={inkToolsRef} drawing={drawing} onDrawingChange={setDrawing} english={english}/>
      </div>
    </div>
  </section>;
}

export function Notes({ projectId = null, initialNoteId = null, onMaximizedChange }: { projectId?: string | null; initialNoteId?: string | null; onMaximizedChange?: (maximized: boolean) => void }) {
  const tr = useT().workspace;
  const shell = useContext(PageHeaderContext);
  const notes = useWorkspaceStore((s) => s.notes);
  const folders = useWorkspaceStore((s) => s.folders);
  const [filter, setFilter] = useState<NoteFilter>('all');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(initialNoteId);
  const [folderOpen, setFolderOpen] = useState(false);
  const [folderName, setFolderName] = useState('');
  const [mobileEditor, setMobileEditor] = useState(!!initialNoteId);
  const [maximized, setMaximized] = useState(false);
  useEffect(() => { onMaximizedChange?.(maximized); return () => onMaximizedChange?.(false); }, [maximized, onMaximizedChange]);
  useEffect(() => {
    if (!maximized) return;
    const restoreOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing || document.querySelector('[role="dialog"], [aria-modal="true"]')) return;
      event.preventDefault(); setMaximized(false);
    };
    document.addEventListener('keydown', restoreOnEscape);
    return () => document.removeEventListener('keydown', restoreOnEscape);
  }, [maximized]);
  const scoped = Object.values(notes).filter((n) => !projectId || n.projectId === projectId);
  const candidates = scoped.filter((n) => filter === 'trash' ? n.deletedAt !== null : n.deletedAt === null && (filter !== 'pinned' || n.pinned));
  const visible = candidates.filter((n) => `${n.title} ${n.blocks.map((b) => b.text).join(' ')}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt);
  const selected = candidates.find((n) => n.id === selectedId) ?? visible[0];
  useEffect(() => { if (!selected) setMaximized(false); }, [selected]);
  const changeFilter = (value: NoteFilter) => { setFilter(value); setSelectedId(null); setMobileEditor(false); };
  const create = (folderId: string | null = null, targetProjectId = projectId) => {
    const id = attempt(() => useWorkspaceStore.getState().createNote({ projectId: targetProjectId ?? null, folderId }));
    if (id) { setFilter('all'); setQuery(''); setSelectedId(id); setMobileEditor(true); }
  };
  return <div className={`ws-notes ${mobileEditor ? 'mobile-editing' : ''} ${maximized && selected ? 'is-maximized' : ''}`}>
    <NotesLibrary notes={visible} folders={Object.values(folders)} projectId={projectId} selectedId={selected?.id ?? null} filter={filter} query={query}
      counts={{ all: scoped.filter((n) => n.deletedAt === null).length, pinned: scoped.filter((n) => n.deletedAt === null && n.pinned).length, trash: scoped.filter((n) => n.deletedAt !== null).length }}
      onQuery={(value) => { setQuery(value); setSelectedId(null); }} onFilter={changeFilter}
      onSelect={(id) => { setSelectedId(id); setMobileEditor(true); }} onCreate={create} onNewFolder={() => setFolderOpen(true)}
      onDeleteFolder={(id) => { attempt(() => { useWorkspaceStore.getState().deleteFolder(id); toast.show(tr.folderDeleted); }); }} />
    <div className="ws-editor-container" onFocusCapture={() => { if (selected) setSelectedId(selected.id); }}><div className="ws-note-mobile-navigation">{shell?.navigation}<button className="ws-notes-back" onClick={() => setMobileEditor(false)}>‹ {tr.notes}</button></div>{selected ? <NoteEditor key={selected.id} note={selected} maximized={maximized} onToggleMaximized={() => setMaximized((value) => !value)} onTrash={() => {
      useWorkspaceStore.getState().trashNote(selected.id); setSelectedId(null); setMobileEditor(false);
      toast.show({ message: tr.noteTrashed, action: { label: tr.undo, onClick: () => { useWorkspaceStore.getState().restoreNote(selected.id); setSelectedId(selected.id); } } });
    }} onRestore={() => { useWorkspaceStore.getState().restoreNote(selected.id); setFilter('all'); setSelectedId(selected.id); }} /> : <Empty icon="notes" title={filter === 'trash' ? tr.emptyTrash : tr.noNotes} hint={filter === 'trash' ? tr.emptyTrashHint : tr.noNotesHint}>{filter !== 'trash' && <button className="ws-button notes-primary" onClick={() => create()}><Icon name="plus" />{tr.newNote}</button>}</Empty>}</div>
    {folderOpen && <Modal open title={tr.newFolder} onClose={() => setFolderOpen(false)}><form className="ws-form" onSubmit={(e) => { e.preventDefault(); attempt(() => { useWorkspaceStore.getState().createFolder(folderName); changeFilter('all'); setQuery(''); setFolderName(''); setFolderOpen(false); }); }}><label>{tr.folderName}<input autoFocus required value={folderName} onChange={(e) => setFolderName(e.target.value)} /></label><div className="ws-form-actions"><button type="button" className="ws-button" onClick={() => setFolderOpen(false)}>{tr.cancel}</button><button className="ws-button notes-primary" disabled={!folderName.trim()}>{tr.create}</button></div></form></Modal>}
  </div>;
}
