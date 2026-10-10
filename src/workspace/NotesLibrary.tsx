import { useContext, useEffect, useId, useState, type ReactNode } from 'react';
import { ChevronRightIcon } from '@radix-ui/react-icons';
import { useT } from '@/i18n';
import { useWorkspaceStore } from './store';
import type { Folder, Note } from './types';
import { Icon, shortDate } from './ui';
import { PageHeaderContext } from './PageHeader';
import './NotesLibrary.css';

export type NoteFilter = 'all' | 'pinned' | 'trash';

interface NotesLibraryProps {
  notes: Note[];
  folders: Folder[];
  selectedId: string | null;
  filter: NoteFilter;
  counts: Record<NoteFilter, number>;
  query: string;
  onQuery: (query: string) => void;
  onFilter: (filter: NoteFilter) => void;
  onSelect: (id: string) => void;
  onCreate: (folderId: string | null) => void;
  onNewFolder: () => void;
  onDeleteFolder: (id: string) => void;
}

function NoteGroup({ label, folderId, count, query, selectedId, selectedHere, onCreate, onDelete, children }: {
  label: string;
  folderId: string | null;
  count: number;
  query: string;
  selectedId: string | null;
  selectedHere: boolean;
  onCreate: () => void;
  onDelete?: () => void;
  children: ReactNode;
}) {
  const tr = useT().workspace;
  const [open, setOpen] = useState(true);
  const contentId = useId(), headingId = useId();
  useEffect(() => { if (query.trim()) setOpen(true); }, [query]);
  useEffect(() => { if (selectedHere) setOpen(true); }, [selectedId, selectedHere]);
  return <section className="ws-note-group" aria-labelledby={headingId}>
    <div className="ws-note-group-heading">
      <h3 id={headingId}><button type="button" className="ws-note-group-toggle" aria-label={label} title={label} aria-expanded={open} aria-controls={contentId} onClick={() => setOpen(!open)}>
        <ChevronRightIcon className={open ? 'is-expanded' : ''} />
        <Icon name={folderId ? 'folder' : 'notes'} size={15} />
        <span>{label}</span><small>{count}</small>
      </button></h3>
      <button type="button" className="ws-icon-button ws-note-group-add" aria-label={`${tr.newNote}: ${label}`} title={`${tr.newNote}: ${label}`} onClick={() => { setOpen(true); onCreate(); }}><Icon name="plus" size={14} /></button>
      {onDelete && <button type="button" className="ws-icon-button ws-note-group-delete" aria-label={`${tr.deleteFolder}: ${label}`} title={tr.deleteFolder} onClick={onDelete}><Icon name="close" size={13} /></button>}
    </div>
    <div id={contentId} className="ws-note-group-content" hidden={!open}>{children}</div>
  </section>;
}

export function NotesLibrary({ notes, folders, selectedId, filter, counts, query, onQuery, onFilter, onSelect, onCreate, onNewFolder, onDeleteFolder }: NotesLibraryProps) {
  const tr = useT().workspace;
  const shell = useContext(PageHeaderContext);
  const projects = useWorkspaceStore((s) => s.projects);
  const preview = (note: Note) => <button type="button" key={note.id} className={`ws-note-preview ${selectedId === note.id ? 'selected' : ''}`} aria-current={selectedId === note.id || undefined} onClick={() => onSelect(note.id)}>
    <div><strong>{note.title || tr.untitled}</strong>{note.pinned && <Icon name="pin" size={13} />}</div>
    <p><time>{shortDate(note.updatedAt)}</time><span>{note.blocks.find((b) => b.text.trim())?.text || tr.notePlaceholder}</span></p>
    {note.projectId && <small>{projects[note.projectId]?.name}</small>}
  </button>;
  const notesByFolder = new Map<string | null, Note[]>();
  for (const note of notes) {
    const group = notesByFolder.get(note.folderId);
    if (group) group.push(note); else notesByFolder.set(note.folderId, [note]);
  }
  const groups = [
    { id: null, name: tr.unfiledNotes },
    ...folders,
  ].map((folder) => ({ ...folder, notes: notesByFolder.get(folder.id) ?? [] }))
    .filter((group) => (!query.trim() && filter === 'all') || group.notes.length > 0);
  const empty = <div className="ws-notes-list-empty"><p>{query.trim() ? tr.noResults : filter === 'trash' ? tr.emptyTrash : tr.noNotes}</p>{filter !== 'trash' && <button type="button" className="ws-text-button" onClick={() => onCreate(null)}>{tr.newNote}</button>}</div>;
  return <aside className="ws-note-library" aria-label={tr.notes}>
    <div className="ws-note-library-heading">{shell?.navigation}<h2>{tr.notes}</h2>
      <button type="button" className="ws-icon-button" aria-label={tr.newFolder} title={tr.newFolder} onClick={onNewFolder}><Icon name="folder" size={17} /></button>
      <button type="button" className="ws-icon-button" aria-label={tr.newNote} title={tr.newNote} onClick={() => onCreate(null)}><Icon name="edit" size={17} /></button>
    </div>
    <label className="ws-search"><Icon name="search" size={15} /><input aria-label={tr.searchNotes} placeholder={tr.searchNotes} value={query} onChange={(e) => onQuery(e.target.value)} /></label>
    <div className="ws-note-library-filters" role="group" aria-label={tr.notes}>
      {([['all', tr.allNotes, 'notes'], ['pinned', tr.pinnedNotes, 'pin'], ['trash', tr.trash, 'trash']] as const).map(([value, label, icon]) => <button type="button" key={value} aria-label={label} title={label} aria-pressed={filter === value} onClick={() => onFilter(value)}><Icon name={icon} size={14} /><span>{label}</span><small>{counts[value]}</small></button>)}
    </div>
    <div className="ws-note-library-scroll">
      {filter === 'trash' ? notes.length ? notes.map(preview) : empty : <>
        {groups.map((group) => <NoteGroup key={group.id === null ? 'unfiled' : `folder:${group.id}`} label={group.name} folderId={group.id} count={group.notes.length} query={query} selectedId={selectedId} selectedHere={group.notes.some((note) => note.id === selectedId)} onCreate={() => onCreate(group.id)} onDelete={group.id ? () => onDeleteFolder(group.id!) : undefined}>
          {group.notes.length ? group.notes.map(preview) : <p className="ws-note-group-empty">{tr.emptyFolder}</p>}
        </NoteGroup>)}
        {!notes.length && (query.trim() || filter !== 'all') && empty}
      </>}
    </div>
  </aside>;
}
