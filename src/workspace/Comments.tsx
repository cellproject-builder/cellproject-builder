import { useEffect, useId, useState } from 'react';
import { useLocaleStore, useT } from '@/i18n';
import { flushWorkspacePersistence, useWorkspaceStore } from './store';
import { attempt, Icon } from './ui';
import './Comments.css';

export function Comments({ taskId }: { taskId: string }) {
  const tr = useT().workspace;
  const locale = useLocaleStore((s) => s.locale);
  const comments = useWorkspaceStore((s) => s.comments);
  const headingId = useId();
  const [body, setBody] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState('');
  const [saveState, setSaveState] = useState<'saving' | 'saved' | 'error'>('saving');
  const thread = Object.values(comments).filter((comment) => comment.taskId === taskId).sort((a, b) => a.createdAt - b.createdAt);
  const dates = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });

  useEffect(() => {
    let current = true;
    setSaveState('saving');
    void flushWorkspacePersistence().then(() => { if (current) setSaveState('saved'); }).catch(() => { if (current) setSaveState('error'); });
    return () => { current = false; };
  }, [comments]);

  return <section className="ws-comments" aria-labelledby={headingId}>
    <header className="ws-comments-heading">
      <h3 id={headingId}>{tr.comments}<span className="ws-count">{thread.length}</span></h3>
      <span className={`ws-comments-save ${saveState === 'error' ? 'save-error' : ''}`} role="status">{saveState === 'saved' ? tr.saved : saveState === 'error' ? tr.saveFailed : tr.saving}</span>
      {saveState === 'error' && <button type="button" className="ws-icon-button" aria-label={tr.retrySave} title={tr.retrySave} onClick={() => attempt(() => useWorkspaceStore.setState({ comments: { ...useWorkspaceStore.getState().comments } }))}><Icon name="scrum" size={15} /></button>}
    </header>
    {thread.length ? <div className="ws-comments-list">{thread.map((comment) => <article className="ws-comment" key={comment.id}>
      <div className="ws-comment-heading">
        <span className={`ws-comment-author ${comment.author === 'assistant' ? 'assistant' : ''}`}>{comment.author === 'assistant' ? tr.commentAuthorAssistant : tr.commentAuthorUser}</span>
        <time dateTime={new Date(comment.createdAt).toISOString()}>{dates.format(comment.createdAt)}</time>
        {comment.updatedAt > comment.createdAt && <span className="ws-comment-edited" title={dates.format(comment.updatedAt)}>{tr.commentEdited}</span>}
        {editingId !== comment.id && <div className="ws-comment-actions">
          <button type="button" className="ws-icon-button" aria-label={tr.editComment} title={tr.editComment} onClick={() => { setEditingId(comment.id); setEditBody(comment.body); }}><Icon name="edit" size={14} /></button>
          <button type="button" className="ws-icon-button" aria-label={tr.deleteComment} title={tr.deleteComment} onClick={() => attempt(() => useWorkspaceStore.getState().deleteComment(comment.id))}><Icon name="trash" size={14} /></button>
        </div>}
      </div>
      {editingId === comment.id ? <form className="ws-form ws-comment-form" onSubmit={(event) => {
        event.preventDefault();
        attempt(() => { useWorkspaceStore.getState().updateComment(comment.id, editBody); setEditingId(null); });
      }}>
        <label>{tr.editComment}<textarea aria-label={tr.editComment} autoFocus rows={3} required value={editBody} onChange={(event) => setEditBody(event.target.value)} /></label>
        <div className="ws-comment-form-actions"><button type="button" className="ws-button small" onClick={() => setEditingId(null)}>{tr.cancel}</button><button type="submit" className="ws-button small primary" disabled={!editBody.trim()}>{tr.save}</button></div>
      </form> : <p className="ws-comment-body">{comment.body}</p>}
    </article>)}</div> : <p className="ws-comments-empty">{tr.noComments}</p>}
    <form className="ws-form ws-comment-form ws-comment-compose" onSubmit={(event) => {
      event.preventDefault();
      attempt(() => { useWorkspaceStore.getState().addComment(taskId, body); setBody(''); });
    }}>
      <label>{tr.addComment}<textarea aria-label={tr.addComment} rows={3} required value={body} placeholder={tr.commentPlaceholder} onChange={(event) => setBody(event.target.value)} /></label>
      <div className="ws-comment-form-actions"><button type="submit" className="ws-button small primary" disabled={!body.trim()}><Icon name="plus" size={15} />{tr.postComment}</button></div>
    </form>
  </section>;
}
