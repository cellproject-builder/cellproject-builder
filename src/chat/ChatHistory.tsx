import { memo, useMemo, useState } from 'react';
import { ArchiveIcon, OptionsIcon as DotsHorizontalIcon, Pencil1Icon, LoopIcon as ReloadIcon, TrashIcon, SearchIcon as MagnifyingGlassIcon } from '@/components/ui/SoftIcons';
import { useChatStore } from './store';

export const ChatHistory = memo(function ChatHistory({ english, onSelect }: { english: boolean; onSelect?: () => void }) {
  const sessions = useChatStore(s => s.archivedSessions);
  const currentId = useChatStore(s => s.sessionId);
  const currentTitle = useChatStore(s => s.title);
  const firstText = useChatStore(s => s.messages.find(m => m.role === 'user')?.text ?? '');
  const currentDate = useChatStore(s => s.updatedAt);
  const archivedAt = useChatStore(s => s.archivedAt);
  const running = useChatStore(s => s.running);
  const hydrated = useChatStore(s => s.hydrated);
  const loadFailed = useChatStore(s => s.loadFailed);
  const [query, setQuery] = useState(''), [archive, setArchive] = useState(false), [limit, setLimit] = useState(40);
  const [options, setOptions] = useState<string | null>(null), [renaming, setRenaming] = useState<string | null>(null);
  const [title, setTitle] = useState(''), [deleting, setDeleting] = useState<string | null>(null);
  const fallback = english ? 'New conversation' : 'Nova conversa';
  const disabled = running || !hydrated || loadFailed;
  const rows = useMemo(() => {
    const all = [{ sessionId: currentId, title: currentTitle || firstText.slice(0, 80) || fallback, updatedAt: currentDate, archivedAt }, ...sessions];
    const needle = query.trim().toLocaleLowerCase();
    return all.filter(row => !('deletedAt' in row && row.deletedAt) && Boolean(row.archivedAt) === archive)
      .filter(row => !needle || (row.title || ('messages' in row ? row.messages.find(m => m.role === 'user')?.text : '') || fallback).toLocaleLowerCase().includes(needle))
      .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  }, [sessions, currentId, currentTitle, firstText, currentDate, archivedAt, fallback, query, archive]);
  return <aside className="dd-chat-history-panel" aria-label={english ? 'Conversation history' : 'Histórico de conversas'}>
    <label className="dd-chat-history-search"><MagnifyingGlassIcon size={15}/><input autoFocus type="search" placeholder={english ? 'Search conversations' : 'Buscar conversas'} aria-label={english ? 'Search conversations' : 'Buscar conversas'} value={query} onChange={event => { setQuery(event.target.value); setLimit(40); }}/></label>
    <div className="dd-chat-history-tabs">
      <button aria-pressed={!archive} onClick={() => { setArchive(false); setLimit(40); }}>{english ? 'Recent' : 'Recentes'}</button>
      <button aria-label={english ? 'Archived conversations' : 'Conversas arquivadas'} aria-pressed={archive} onClick={() => { setArchive(true); setLimit(40); }}><ArchiveIcon size={13}/>{english ? 'Archived' : 'Arquivadas'}</button>
    </div>
    <div className="dd-chat-history-list">{rows.slice(0, limit).map(row => {
      const label = row.title || ('messages' in row ? row.messages.find(m => m.role === 'user')?.text.slice(0, 80) : '') || fallback;
      return <div key={row.sessionId} className={`dd-chat-history-row ${row.sessionId === currentId ? 'is-current' : ''}`}>
        {renaming === row.sessionId ? <form className="dd-chat-history-rename" onSubmit={event => { event.preventDefault(); if (title.trim()) { useChatStore.getState().renameConversation(row.sessionId, title); setRenaming(null); } }}>
          <input autoFocus aria-label={english ? 'Conversation title' : 'Título da conversa'} maxLength={100} value={title} disabled={disabled} onChange={event => setTitle(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setRenaming(null); } }}/>
          <button disabled={disabled || !title.trim()}>{english ? 'Save' : 'Salvar'}</button><button type="button" onClick={() => setRenaming(null)}>{english ? 'Cancel' : 'Cancelar'}</button>
        </form> : <><button className="dd-chat-history-select" disabled={disabled} aria-current={row.sessionId === currentId ? 'true' : undefined} title={label} onClick={() => { if (row.sessionId !== currentId) useChatStore.getState().selectConversation(row.sessionId); onSelect?.(); }}><span>{label}</span>{!!row.updatedAt && <small>{new Date(row.updatedAt).toLocaleDateString(english ? 'en' : 'pt-BR', { month: 'short', day: 'numeric' })}</small>}</button>
          <button className="dd-chat-history-more" disabled={disabled} aria-label={`${english ? 'Options for' : 'Opções de'} ${label}`} aria-expanded={options === row.sessionId} onClick={() => { setOptions(options === row.sessionId ? null : row.sessionId); setDeleting(null); }}><DotsHorizontalIcon size={16}/></button></>}
        {options === row.sessionId && renaming !== row.sessionId && <div className="dd-chat-history-actions">
          <button disabled={disabled} aria-label={`${english ? 'Rename' : 'Renomear'} ${label}`} onClick={() => { setTitle(label); setRenaming(row.sessionId); }}><Pencil1Icon size={14}/>{english ? 'Rename' : 'Renomear'}</button>
          <button disabled={disabled} onClick={() => { const state = useChatStore.getState(); if (row.archivedAt) state.restoreConversation(row.sessionId); else state.archiveConversation(row.sessionId); setOptions(null); }}><span>{row.archivedAt ? <ReloadIcon size={14}/> : <ArchiveIcon size={14}/>}</span>{row.archivedAt ? (english ? 'Restore' : 'Restaurar') : (english ? 'Archive' : 'Arquivar')}</button>
          <button disabled={disabled} aria-label={`${english ? 'Delete' : 'Excluir'} ${label}`} onClick={() => setDeleting(row.sessionId)}><TrashIcon size={14}/>{english ? 'Delete' : 'Excluir'}</button>
        </div>}
        {deleting === row.sessionId && <div className="dd-chat-history-confirm" role="alert"><strong>{english ? 'Delete this conversation?' : 'Excluir esta conversa?'}</strong><p>{english ? 'Its messages will be removed from your history.' : 'As mensagens serão removidas do seu histórico.'}</p><div><button disabled={disabled} aria-label={english ? 'Cancel deletion' : 'Cancelar exclusão'} onClick={() => setDeleting(null)}>{english ? 'Cancel' : 'Cancelar'}</button><button className="is-destructive" disabled={disabled} aria-label={english ? 'Confirm deletion' : 'Confirmar exclusão'} onClick={() => { useChatStore.getState().deleteConversation(row.sessionId); setDeleting(null); setOptions(null); }}>{english ? 'Delete' : 'Excluir'}</button></div></div>}
      </div>;
    })}{!rows.length && <p className="dd-chat-history-empty">{english ? 'No conversations here.' : 'Nenhuma conversa aqui.'}</p>}{rows.length > limit && <button className="dd-chat-history-load" onClick={() => setLimit(limit + 40)}>{english ? 'Show more' : 'Mostrar mais'}</button>}</div>
  </aside>;
});
