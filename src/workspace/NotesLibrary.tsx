import { useContext, useEffect, useId, useState, type ReactNode } from 'react';
import { ChevronRightIcon, HistoryIcon } from '@/components/ui/SoftIcons';
import { useLocaleStore, useT } from '@/i18n';
import { useWorkspaceStore } from './store';
import type { Folder, Note } from './types';
import { Icon, shortDate } from './ui';
import { PageHeaderContext } from './PageHeader';
import { ProjectIcon } from './project-appearance/projectIcons';
import './NotesLibrary.css';

export type NoteFilter = 'all' | 'pinned' | 'trash';

interface NotesLibraryProps {
  projectId?: string | null;
  notes: Note[];
  folders: Folder[];
  selectedId: string | null;
  filter: NoteFilter;
  counts: Record<NoteFilter, number>;
  query: string;
  onQuery: (query: string) => void;
  onFilter: (filter: NoteFilter) => void;
  onSelect: (id: string) => void;
  onCreate: (folderId: string | null, projectId?: string) => void;
  onNewFolder: () => void;
  onDeleteFolder: (id: string) => void;
}

function NoteGroup({ label, folderId, count, query, selectedId, selectedHere, onCreate, onDelete, icon, className = '', children }: {
  label: string;
  folderId: string | null;
  count: number;
  query: string;
  selectedId: string | null;
  selectedHere: boolean;
  onCreate?: () => void;
  onDelete?: () => void;
  icon?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const tr = useT().workspace;
  const [open, setOpen] = useState(true);
  const contentId = useId(), headingId = useId();
  useEffect(() => { if (query.trim()) setOpen(true); }, [query]);
  useEffect(() => { if (selectedHere) setOpen(true); }, [selectedId, selectedHere]);
  return <section className={`ws-note-group ${className}`} aria-labelledby={headingId}>
    <div className="ws-note-group-heading">
      <h3 id={headingId}><button type="button" className="ws-note-group-toggle" aria-label={label} title={label} aria-expanded={open} aria-controls={contentId} onClick={() => setOpen(!open)}>
        <ChevronRightIcon className={open ? 'is-expanded' : ''} />
        {icon ?? <Icon name={folderId ? 'folder' : 'notes'} size={15} />}
        <span>{label}</span><small>{count}</small>
      </button></h3>
      {onCreate && <button type="button" className="ws-icon-button ws-note-group-add" aria-label={`${tr.newNote}: ${label}`} title={`${tr.newNote}: ${label}`} onClick={() => { setOpen(true); onCreate(); }}><Icon name="plus" size={14} /></button>}
      {onDelete && <button type="button" className="ws-icon-button ws-note-group-delete" aria-label={`${tr.deleteFolder}: ${label}`} title={tr.deleteFolder} onClick={onDelete}><Icon name="close" size={13} /></button>}
    </div>
    <div id={contentId} className="ws-note-group-content" hidden={!open}>{children}</div>
  </section>;
}

export function NotesLibrary({ projectId, notes, folders, selectedId, filter, counts, query, onQuery, onFilter, onSelect, onCreate, onNewFolder, onDeleteFolder }: NotesLibraryProps) {
  const tr = useT().workspace;
  const english = useLocaleStore(state => state.locale) === 'en';
  const shell = useContext(PageHeaderContext);
  const projects = useWorkspaceStore((s) => s.projects);
  const allNotes = useWorkspaceStore((s) => s.notes);
  const [recent, setRecent] = useState(false), [sort, setSort] = useState<'recent' | 'name'>('recent');
  useEffect(() => { setRecent(false); }, [projectId]);
  const since = Date.now() - 7 * 86400000;
  const recentActive = recent && filter === 'all';
  const recentCount = Object.values(allNotes).filter(note => note.deletedAt === null && (!projectId || note.projectId === projectId) && note.updatedAt >= since).length;
  const collator = new Intl.Collator(english ? 'en' : 'pt-BR', { sensitivity: 'base', numeric: true });
  const shown = notes.filter(note => !recentActive || note.updatedAt >= since).sort((a, b) => sort === 'name'
    ? collator.compare(a.title || tr.untitled, b.title || tr.untitled) || a.id.localeCompare(b.id)
    : b.updatedAt - a.updatedAt || collator.compare(a.title || tr.untitled, b.title || tr.untitled) || a.id.localeCompare(b.id));
  const narrowed = !!query.trim() || filter !== 'all' || recentActive;
  const preview = (note: Note) => <button type="button" key={note.id} className={`ws-note-preview ${selectedId === note.id ? 'selected' : ''}`} aria-current={selectedId === note.id || undefined} onClick={() => onSelect(note.id)}>
    <div><strong>{note.title || tr.untitled}</strong>{note.pinned && <Icon name="pin" size={13} />}</div>
    <p><time>{shortDate(note.updatedAt)}</time><span>{note.blocks.find((b) => b.text.trim())?.text || (note.canvas?.items.length || note.canvas?.strokes.length || note.ink?.strokes.length ? english ? 'Drawings and images' : 'Desenhos e imagens' : english ? 'Empty note' : 'Nota vazia')}</span></p>
    {note.projectId && filter === 'trash' && <small>{projects[note.projectId]?.name}</small>}
  </button>;
  const notesByFolder = new Map<string | null, Note[]>();
  for (const note of shown) {
    if (!projectId && note.projectId) continue;
    const folderId = folders.some(folder => folder.id === note.folderId) ? note.folderId : null;
    const group = notesByFolder.get(folderId);
    if (group) group.push(note); else notesByFolder.set(folderId, [note]);
  }
  const groups = [
    { id: null, name: tr.unfiledNotes },
    ...folders,
  ].map((folder) => ({ ...folder, notes: notesByFolder.get(folder.id) ?? [] }))
    .filter((group) => !narrowed || group.notes.length > 0);
  const projectNotes = new Map<string, Note[]>();
  for (const note of shown) if (note.projectId) {
    const group = projectNotes.get(note.projectId);
    if (group) group.push(note); else projectNotes.set(note.projectId, [note]);
  }
  const projectIds = new Set([...Object.keys(projects), ...projectNotes.keys()]);
  const projectGroups = Array.from(projectIds).map(id => ({ id, name: projects[id]?.name ?? (english ? 'Unavailable project' : 'Projeto indisponível'), notes: projectNotes.get(id) ?? [] }))
    .filter(group => narrowed ? group.notes.length > 0 : !projects[group.id]?.archived || group.notes.length > 0)
    .sort((a, b) => collator.compare(a.name, b.name) || a.id.localeCompare(b.id));
  const projectsLabel = english ? 'Projects' : 'Projetos';
  const empty = <div className="ws-notes-list-empty"><p>{query.trim() ? tr.noResults : filter === 'trash' ? tr.emptyTrash : tr.noNotes}</p>{filter !== 'trash' && <button type="button" className="ws-text-button" onClick={() => onCreate(null)}>{tr.newNote}</button>}</div>;
  return <aside className="ws-note-library" aria-label={tr.notes}>
    <div className="ws-note-library-heading">{shell?.navigation}<h2>{tr.notes}</h2>
      <button type="button" className="ws-icon-button" aria-label={tr.newFolder} title={tr.newFolder} onClick={onNewFolder}><Icon name="folder" size={17} /></button>
      <button type="button" className="ws-icon-button" aria-label={tr.newNote} title={tr.newNote} onClick={() => onCreate(null)}><Icon name="edit" size={17} /></button>
    </div>
    <label className="ws-search"><Icon name="search" size={15} /><input aria-label={tr.searchNotes} placeholder={tr.searchNotes} value={query} onChange={(e) => onQuery(e.target.value)} /></label>
    <div className="ws-note-library-filters" role="group" aria-label={tr.notes}>
      <button type="button" aria-label={tr.allNotes} title={tr.allNotes} aria-pressed={filter === 'all' && !recentActive} onClick={() => { setRecent(false); onFilter('all'); }}><Icon name="notes" size={14} /><span>{tr.allNotes}</span><small>{counts.all}</small></button>
      <button type="button" aria-label={english ? 'Recent' : 'Recentes'} title={english ? 'Updated in the last 7 days' : 'Atualizadas nos últimos 7 dias'} aria-pressed={recentActive} onClick={() => { setRecent(true); onFilter('all'); }}><HistoryIcon size={14} /><span>{english ? 'Recent' : 'Recentes'}</span><small>{recentCount}</small></button>
      {([['pinned', tr.pinnedNotes, 'pin'], ['trash', tr.trash, 'trash']] as const).map(([value, label, icon]) => <button type="button" key={value} aria-label={label} title={label} aria-pressed={filter === value} onClick={() => { setRecent(false); onFilter(value); }}><Icon name={icon} size={14} /><span>{label}</span><small>{counts[value]}</small></button>)}
    </div>
    <div className="ws-note-library-order"><label><span>{english ? 'Sort' : 'Ordenar'}</span><select aria-label={english ? 'Sort notes' : 'Ordenar notas'} value={sort} onChange={event => setSort(event.target.value === 'name' ? 'name' : 'recent')}><option value="recent">{english ? 'Most recent' : 'Mais recentes'}</option><option value="name">{english ? 'Name A–Z' : 'Nome A–Z'}</option></select></label></div>
    <div className="ws-note-library-scroll">
      {filter === 'trash' ? shown.length ? shown.map(preview) : empty : <>
        {groups.map((group) => <NoteGroup key={group.id === null ? 'unfiled' : `folder:${group.id}`} label={group.name} folderId={group.id} count={group.notes.length} query={query} selectedId={selectedId} selectedHere={group.notes.some((note) => note.id === selectedId)} onCreate={() => onCreate(group.id)} onDelete={group.id ? () => onDeleteFolder(group.id!) : undefined}>
          {group.notes.length ? group.notes.map(preview) : <p className="ws-note-group-empty">{tr.emptyFolder}</p>}
        </NoteGroup>)}
        {!projectId && (!narrowed || projectGroups.length > 0) && <NoteGroup label={projectsLabel} folderId={null} count={Array.from(projectNotes.values()).reduce((count, list) => count + list.length, 0)} query={query} selectedId={selectedId} selectedHere={shown.some(note => note.projectId && note.id === selectedId)} icon={<Icon name="folder" size={15} />} className="ws-note-projects-group">
          {projectGroups.length ? projectGroups.map(group => <NoteGroup key={`project:${group.id}`} label={group.name} folderId={null} count={group.notes.length} query={query} selectedId={selectedId} selectedHere={group.notes.some(note => note.id === selectedId)} onCreate={projects[group.id] ? () => onCreate(null, group.id) : undefined} icon={<ProjectIcon appearance={projects[group.id]?.appearance} size={15} />}>
            {group.notes.length ? group.notes.map(preview) : <p className="ws-note-group-empty">{tr.emptyFolder}</p>}
          </NoteGroup>) : <p className="ws-note-group-empty">{tr.emptyFolder}</p>}
        </NoteGroup>}
        {!shown.length && narrowed && empty}
      </>}
    </div>
  </aside>;
}
