import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocaleStore } from '@/i18n';
import { getActiveConfig, useConfigStore } from '@/config/store';
import { useWorkspaceStore } from '@/workspace/store';
import { useGraphStore } from '@/store';
import { useIsMobile } from '@/hooks/useMediaQuery';
import { requestWorkspaceUI } from '@/workspace/uiRequests';
import { Icon } from '@/workspace/ui';
import { ExplanationContent } from '@/components/Markdown';
import { actionLabel, chatEn, chatPt } from './messages';
import { chatCooldownUntil, retryChatPersistence, sendChatMessage, stopChat, useChatStore } from './store';
import { useChatDockTarget } from './AssistantChatDock';
import './chat.css';
import { useVisualPopupStore } from '@/visuals/ui/uiStore';
import { ChatComposer } from './ChatComposer';
import { CHAT_REFERENCE_LIMIT, chatReferenceError, listChatReferences, resolveChatReferences, type ChatReferenceTarget } from './references';
import { consumeChatReferenceHandoff, useChatReferenceHandoff } from '@/references/chatHandoff';
import { addChatImageReference } from '@/visuals/controller';
import type { ImageReference, VisualPromptInput } from '@/visuals/types';
import { ChatImageCarousel } from './ChatImageCarousel';
import type { PlanFile } from '@/attachments/files';
import { intakeLabel } from '@/ai/planIntake';
import { ChatPlanChanges } from './ChatPlanChanges';
import { componentFitSchema } from '@/visuals/componentFit';
import { chatImageSearchRevision } from '@/visuals/projectSearchContext';
import type { ChatImageGroup } from './ChatImageCarousel';

function imageSearchResult(value: unknown) {
  if (!value || typeof value !== 'object') return null;
  const result = value as { projectId?: unknown; planId?: unknown; imageReferences?: unknown; input?: VisualPromptInput; contextRevision?: unknown; groups?: unknown; fits?: unknown; searchUncertainty?: unknown; contextPartial?: unknown };
  if (typeof result.projectId !== 'string' || !Array.isArray(result.imageReferences)) return null;
  if (!result.imageReferences.every(item => item && typeof item === 'object' && typeof item.id === 'string' && typeof item.title === 'string' && typeof item.imageUrl === 'string' && typeof item.sourcePageUrl === 'string')) return null;
  const images = result.imageReferences as ImageReference[];
  const groups = Array.isArray(result.groups) ? result.groups.slice(0, 8).filter((group): group is ChatImageGroup => group && typeof group.id === 'string' && typeof group.label === 'string' && group.label.length <= 200 && Array.isArray(group.imageIds) && group.imageIds.length <= 12 && group.imageIds.every((id: unknown) => typeof id === 'string' && images.some(image => image.id === id))) : [];
  const fits = Array.isArray(result.fits) ? result.fits.slice(0, 12).flatMap(value => { const parsed = componentFitSchema.safeParse(value); return parsed.success && images.some(image => image.id === parsed.data.imageId) ? [parsed.data] : []; }) : [];
  return { projectId: result.projectId, planId: typeof result.planId === 'string' ? result.planId : undefined, images, input: result.input, groups, fits, contextRevision: typeof result.contextRevision === 'string' ? result.contextRevision : undefined, searchUncertainty: typeof result.searchUncertainty === 'string' ? result.searchUncertainty.slice(0, 300) : '', contextPartial: result.contextPartial === true };
}

function ChatIcon() { return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M20 15a3 3 0 0 1-3 3H9l-5 3V6a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3z" strokeLinejoin="round"/><path d="M8 8h8M8 12h5" strokeLinecap="round"/></svg>; }
export function AssistantChat({ suspended = false }: { suspended?: boolean }) {
  const english = useLocaleStore((s) => s.locale) === 'en', tr = english ? chatEn : chatPt;
  const state = useChatStore();
  const dockTarget = useChatDockTarget();
  const mobile = useIsMobile();
  const docked = !!dockTarget && !mobile;
  const ready = useConfigStore(() => Boolean(getActiveConfig()?.config.apiKey.trim()));
  const model = useConfigStore(() => getActiveConfig()?.config.mainModel ?? null);
  const projectId = useWorkspaceStore((s) => s.activeProjectId), projects = useWorkspaceStore((s) => s.projects);
  useWorkspaceStore(s => s.notes); useWorkspaceStore(s => s.tasks); // Re-evaluate documentary context when project records change.
  const planId = useGraphStore(state => state.project?.id);
  const [input, setInput] = useState('');
  const [references, setReferences] = useState<ChatReferenceTarget[]>([]);
  const [files, setFiles] = useState<PlanFile[]>([]), [filesBusy, setFilesBusy] = useState(false);
  const [referenceProjectId, setReferenceProjectId] = useState<string | null | undefined>(undefined);
  const [referenceError, setReferenceError] = useState('');
  const [choosingImage, setChoosingImage] = useState(false), imageChoiceRunning = useRef(false);
  const handoff = useChatReferenceHandoff(state => state.pending);
  const contextProjectId = (references.length || files.length) && referenceProjectId !== undefined ? referenceProjectId : projectId;
  const referenceDraft = useRef({ references, files, contextProjectId, sessionId: state.sessionId });
  referenceDraft.current = { references, files, contextProjectId, sessionId: state.sessionId };
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!handoff) return;
    try {
      const available = listChatReferences('', handoff.projectId);
      const added = handoff.references.map(reference => {
        const target = available.find(target => target.id === reference.id && target.kind === reference.kind);
        if (!target) throw new Error('chatReferenceMissing'); return target;
      });
      if (references.some(reference => reference.projectId !== null && reference.projectId !== handoff.projectId)) throw new Error('chatReferenceHandoffConflict');
      if (files.length && contextProjectId !== handoff.projectId) throw new Error('chatReferenceHandoffConflict');
      const merged = [...references, ...added.filter(target => !references.some(reference => reference.id === target.id && reference.kind === target.kind && reference.projectId === target.projectId))];
      if (merged.length > 20) throw new Error('chatReferenceLimit');
      setReferences(merged);
      setReferenceProjectId(handoff.projectId); setReferenceError('');
    } catch (reason) { setReferenceError(chatReferenceError(reason, english)); }
    consumeChatReferenceHandoff(handoff.id);
  }, [handoff, english, references, files, contextProjectId]);
  const previousSession = useRef(state.sessionId);
  useEffect(() => {
    if (previousSession.current === state.sessionId) return;
    previousSession.current = state.sessionId; setInput(''); setReferences([]); setFiles([]); setFilesBusy(false); setReferenceProjectId(undefined); setReferenceError('');
  }, [state.sessionId]);
  const [now, setNow] = useState(Date.now);
  const cooldownUntil = chatCooldownUntil();
  const cooldownSeconds = Math.max(0, Math.ceil((cooldownUntil - now) / 1000));
  useEffect(() => {
    setNow(Date.now());
    if (cooldownUntil <= Date.now()) return;
    const timer = setInterval(() => {
      const next = Date.now();
      setNow(next);
      if (next >= cooldownUntil) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldownUntil]);
  const titleId = useId(), inputRef = useRef<HTMLTextAreaElement>(null), bottomRef = useRef<HTMLDivElement>(null), triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (suspended) return;
    const otherModal = [...document.querySelectorAll('[aria-modal="true"]')].some((el) => el !== panelRef.current);
    if (!otherModal) {
      if (state.open) (inputRef.current?.disabled ? panelRef.current?.querySelector<HTMLButtonElement>('button:not([disabled])') : inputRef.current)?.focus();
      else if (wasOpen.current) triggerRef.current?.focus();
    }
    wasOpen.current = state.open;
  }, [state.open, dockTarget, mobile, titleId, suspended]);
  useEffect(() => { if (state.open && !suspended) bottomRef.current?.scrollIntoView({ block: 'nearest' }); }, [state.messages, state.open, dockTarget, mobile, suspended]);
  if (suspended) return null;
  const close = () => { state.setOpen(false); };
  const send = () => {
    if ((!input.trim() && !files.length) || filesBusy || state.running || imageChoiceRunning.current || !ready || !state.hydrated || cooldownUntil > Date.now()) return;
    try { resolveChatReferences(references, contextProjectId); }
    catch (reason) { setReferenceError(chatReferenceError(reason, english)); return; }
    const value = input; void sendChatMessage(value, { references, files, projectId: contextProjectId });
    setInput(''); setReferences([]); setFiles([]); setReferenceProjectId(undefined); setReferenceError('');
  };
  const chooseImage = async (image: ImageReference, sourceProjectId: string, options: { useAs3D: boolean }, linkedNodeId?: string, expectedPlanId?: string, searchContext?: { expectedContextRevision: string; searchInput: VisualPromptInput }) => {
    if (imageChoiceRunning.current) throw new Error('chatImageBusy');
    const sessionId = useChatStore.getState().sessionId;
    function validateDraft() {
      if (useWorkspaceStore.getState().activeProjectId !== sourceProjectId) throw new Error('visualProjectChanged');
      if (expectedPlanId && useGraphStore.getState().project?.id !== expectedPlanId) throw new Error('visualPlanChanged');
      const draft = referenceDraft.current;
      if (draft.files.length && draft.contextProjectId !== sourceProjectId) throw new Error('chatReferenceHandoffConflict');
      if (draft.references.some(reference => reference.projectId !== null && reference.projectId !== sourceProjectId)) throw new Error('chatReferenceHandoffConflict');
      if (draft.references.length >= CHAT_REFERENCE_LIMIT) throw new Error('chatReferenceLimit');
    }
    validateDraft();
    imageChoiceRunning.current = true; setChoosingImage(true);
    try {
      const artifact = await addChatImageReference(image, sourceProjectId, { ...options, linkedNodeId, ...(expectedPlanId ? { expectedPlanId } : {}), ...searchContext });
      if (!mounted.current || useChatStore.getState().sessionId !== sessionId) return;
      validateDraft();
      // Query by label so a long plan's first 100 notes cannot hide the chosen image.
      const target = listChatReferences(artifact.label, sourceProjectId).find(item => item.kind === 'image' && item.id === artifact.id);
      if (!target) throw new Error('chatReferenceMissing');
      const current = referenceDraft.current.references;
      setReferences(current.some(reference => reference.kind === 'image' && reference.id === target.id && reference.projectId === sourceProjectId) ? current : [...current, target]);
      setReferenceProjectId(sourceProjectId); setReferenceError('');
      if (options.useAs3D) useChatStore.getState().setOpen(false); else inputRef.current?.focus();
    } finally { imageChoiceRunning.current = false; if (mounted.current) setChoosingImage(false); }
  };
  const panel = state.open && <section ref={panelRef} id={`${titleId}-panel`} className={`dd-chat ${docked ? 'is-docked' : ''} ${mobile ? 'is-modal' : ''}`} role={docked ? 'complementary' : 'dialog'} aria-modal={mobile || undefined} aria-labelledby={titleId} onKeyDown={(e) => {
    if (e.defaultPrevented || e.nativeEvent.isComposing) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    if (mobile && e.key === 'Tab') {
      const items = [...e.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], select:not([disabled]), textarea:not([disabled])')];
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
    }
  }}>
      <header className="dd-chat-header"><div className="dd-chat-symbol"><ChatIcon /></div><div><h2 id={titleId}>{tr.title}</h2><p>{state.running ? tr.working : ready ? tr.ready : tr.noKey}</p></div><button className="ws-icon-button" disabled={state.running} aria-label={tr.newChat} title={tr.newChat} onClick={state.newConversation}><Icon name="plus" /></button><button className="ws-icon-button" aria-label={tr.close} onClick={close}><Icon name="close" /></button></header>
      <div className="dd-chat-context"><span>{tr.context}: {contextProjectId ? projects[contextProjectId]?.name ?? (english ? 'Removed project' : 'Projeto removido') : tr.personal}</span><button onClick={() => requestWorkspaceUI({ settings: true })}>{ready ? model : tr.settings}</button></div>
      {(state.loadFailed || state.saveFailed) && <div className="dd-chat-storage-error" role="alert"><span>{state.loadFailed ? tr.loadError : tr.saveError}</span><button onClick={() => void retryChatPersistence()}>{tr.retry}</button></div>}
      {state.archivedSessions.length > 0 && <select className="dd-chat-history" aria-label={tr.conversations} value={state.sessionId} disabled={state.running} onChange={(e) => state.selectConversation(e.target.value)}><option value={state.sessionId}>{tr.current}</option>{state.archivedSessions.map((s) => <option key={s.sessionId} value={s.sessionId}>{s.messages.find((m) => m.role === 'user')?.text.slice(0, 55) || tr.newChat}</option>)}</select>}
      <div className="dd-chat-messages" aria-busy={state.running}>
        {!state.hydrated ? <p className="dd-chat-empty">{tr.loading}</p> : !state.messages.length ? <div className="dd-chat-welcome"><div className="dd-chat-welcome-icon"><ChatIcon /></div><h3>{tr.greeting}</h3><p>{tr.hint}</p><div>{[tr.exampleProject, tr.exampleNote, tr.exampleReview].map((example) => <button key={example} onClick={() => { setInput(example); inputRef.current?.focus(); }}>{example}<Icon name="arrow" size={14} /></button>)}</div></div> : state.messages.map((message) => <article className={`dd-chat-message ${message.role}`} key={message.id}>
          {message.actions && message.actions.length > 0 && <details className="dd-chat-actions" open={state.running || message.actions.some((a) => a.status === 'error' || a.status === 'awaiting_approval')}><summary>{tr.actions}<span>{message.actions.filter((a) => a.status === 'done').length}/{message.actions.length}</span></summary><ul>{message.actions.map((action) => <li key={action.id} className={action.status}><span>{action.status === 'running' ? <i /> : <Icon name={action.status === 'error' ? 'close' : 'check'} size={13} />}</span><span>{actionLabel(action.action, english)}</span><small>{action.status === 'running' ? tr.working : action.status === 'done' ? tr.actionDone : action.status === 'awaiting_approval' ? (english ? 'Awaiting approval' : 'Aguardando aprovação') : tr.actionError}</small></li>)}</ul></details>}
          {message.text ? <ExplanationContent text={message.text} /> : state.running && <span className="dd-chat-thinking" role="status">{tr.working}<i /><i /><i /></span>}
          {!!message.references?.length && <div className="dd-chat-message-references" aria-label={english ? 'References sent' : 'Referências enviadas'}>{message.references.map(reference => <span key={`${reference.kind}:${reference.projectId}:${reference.id}`} title={english ? 'Snapshot at the time of sending' : 'Versão no momento do envio'}>@ {reference.label}</span>)}</div>}
          {!!message.files?.length && <div className="dd-chat-message-references" aria-label={english ? 'Files sent' : 'Anexos enviados'}>{message.files.map(file => <details key={file.id}><summary>{file.name}{file.truncated ? (english ? ' · excerpt' : ' · trecho') : ''}</summary><pre className="plan-attachment-preview">{file.text.slice(0, 8000)}</pre></details>)}</div>}
          {message.intake && <small className="dd-chat-intake" title={message.intake.status === 'classified' ? (english ? `Model confidence: ${Math.round(message.intake.classification.confidence * 100)}%. Advisory only.` : `Confiança do modelo: ${Math.round(message.intake.classification.confidence * 100)}%. Classificação orientativa.`) : (english ? 'The assistant continues without a TypeSafe classification.' : 'O assistente continua sem classificação do TypeSafe.')}>{intakeLabel(message.intake, english)}</small>}
          {message.actions?.filter(action => action.name === 'planner_structure' && (action.status === 'done' || action.status === 'error')).map(action => <ChatPlanChanges key={action.id} result={action.result} english={english} disabled={state.running} />)}
          {message.interrupted && <small className="dd-chat-interrupted">{tr.interrupted}</small>}
          {message.actions?.filter(action => action.name === 'visual_action' && action.action === 'search_images' && action.status === 'done').map(action => {
            const result = imageSearchResult(action.result);
            if (!result) return null;
            const exists = Boolean(projects[result.projectId]);
            let contextChanged = false;
            if (result.contextRevision && result.input && exists && projectId === result.projectId && (!result.planId || planId === result.planId)) {
              try { contextChanged = chatImageSearchRevision(result.projectId, result.input) !== result.contextRevision; } catch { contextChanged = true; }
            }
            const linkedNodeId = Array.isArray(result.input?.mentions) ? result.input.mentions.find(mention => mention?.kind === 'node' && typeof mention.id === 'string')?.id : undefined;
            return <ChatImageCarousel key={action.id} results={result.images} projectId={result.projectId} english={english} disabled={state.running || choosingImage || !state.hydrated}
              groups={result.groups} fits={result.fits} searchUncertainty={result.searchUncertainty} contextPartial={result.contextPartial}
              unavailable={!exists ? 'projectRemoved' : projectId !== result.projectId ? 'projectChanged' : result.planId && result.planId !== planId ? 'planChanged' : contextChanged ? 'contextChanged' : undefined}
              onChoose={(image, options) => chooseImage(image, result.projectId, options, linkedNodeId, result.planId, result.contextRevision && result.input ? { expectedContextRevision: result.contextRevision, searchInput: result.input } : undefined)}
              onOpenProject={exists ? () => requestWorkspaceUI({ surface: 'planner', projectId: result.projectId }) : undefined} />;
          })}
          {message.actions?.filter(action => action.name === 'visual_action' && (action.action === 'generate_model' || action.action === 'search_images' && !imageSearchResult(action.result)) && ['done', 'awaiting_approval'].includes(action.status)).slice(-1).map(action => {
            const result = action.result as { projectId?: string } | undefined;
            return result?.projectId && projects[result.projectId] ? <button key={action.id} className="ws-button" onClick={() => {
              requestWorkspaceUI({ surface: 'planner', projectId: result.projectId });
              useVisualPopupStore.getState().open(action.action === 'search_images' ? 'search' : 'model'); close();
            }}>{english ? 'Open on canvas' : 'Abrir no canvas'}</button> : null;
          })}
        </article>)}<div ref={bottomRef} />
      </div>
      {!ready && <button className="dd-chat-configure ws-button primary" onClick={() => requestWorkspaceUI({ settings: true })}>{tr.settings}<Icon name="arrow" size={16} /></button>}
      {cooldownSeconds > 0 && <p className="dd-chat-cooldown" role="status">{tr.cooldown(cooldownSeconds)}</p>}
      {referenceError && <p className="dd-chat-reference-error" role="alert">{referenceError}</p>}
      <ChatComposer text={input} onText={setInput} references={references} onReferences={next => { setReferences(next); setReferenceError(''); if (!next.length && !files.length) setReferenceProjectId(undefined); else if (!references.length && !files.length) setReferenceProjectId(contextProjectId); }} files={files} onFiles={next => { if (next.length && !files.length && !references.length) setReferenceProjectId(contextProjectId); else if (!next.length && !references.length) setReferenceProjectId(undefined); setFiles(next); }} onFilesBusy={setFilesBusy} scopeKey={`${state.sessionId}:${contextProjectId}`} projectId={contextProjectId} inputRef={inputRef} english={english} placeholder={tr.placeholder} sendLabel={tr.send} stopLabel={tr.stop} disabled={!state.hydrated} canSend={(!!input.trim() || !!files.length) && !filesBusy && ready && state.hydrated && !choosingImage && cooldownSeconds <= 0} running={state.running} onSubmit={send} onStop={stopChat} />
    </section>;
  return <>
    <button ref={triggerRef} className={`dd-chat-trigger ${state.running ? 'is-working' : ''} ${state.open && (docked || mobile) ? 'is-hidden' : ''}`} onClick={() => state.setOpen(!state.open)} aria-expanded={state.open} aria-controls={state.open ? `${titleId}-panel` : undefined} aria-label={tr.open} title={tr.open}><ChatIcon />{state.running && <i />}</button>
    {state.open && mobile && <div className="dd-chat-scrim" aria-hidden="true" onClick={close} />}
    {docked && dockTarget ? createPortal(panel, dockTarget) : panel}
  </>;
}
