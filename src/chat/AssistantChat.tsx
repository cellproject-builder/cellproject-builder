import { memo, useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocaleStore } from '@/i18n';
import { getActiveConfig, useConfigStore } from '@/config/store';
import { useWorkspaceStore } from '@/workspace/store';
import { useGraphStore } from '@/store';
import { useIsMobile } from '@/hooks/useMediaQuery';
import { requestWorkspaceUI } from '@/workspace/uiRequests';
import { Icon } from '@/workspace/ui';
import { ChatBubbleIcon, EnterFullScreenIcon, ExitFullScreenIcon, HistoryIcon } from '@/components/ui/SoftIcons';
import { ExplanationContent } from '@/components/Markdown';
import { actionLabel, chatEn, chatPt } from './messages';
import { chatCooldownUntil, retryChatPersistence, sendChatMessage, stopChat, useChatStore } from './store';
import { useChatDockTarget, useFullChatDockTarget, useCanvasChatDockTarget, useCanvasChatMaximized } from './AssistantChatDock';
import { CanvasChatEntry } from './CanvasChatEntry';
import { useChatPresentation } from './presentation';
import { ChatHistory } from './ChatHistory';
import { captureChatTurnContext, useChatFocusStore } from './turnContext';
import './chat.css';
import { ChatComposer } from './ChatComposer';
import { CHAT_REFERENCE_LIMIT, chatReferenceError, listChatReferences, resolveChatReferenceTarget, resolveChatReferences, type ChatReferenceTarget } from './references';
import { consumeChatReferenceHandoff, useChatReferenceHandoff } from '@/references/chatHandoff';
import { addChatImageReference } from '@/visuals/controller';
import type { ImageReference, VisualPromptInput } from '@/visuals/types';
import type { PlanFile } from '@/attachments/files';
import { intakeLabel } from '@/ai/planIntake';
import { ChatPlanChanges } from './ChatPlanChanges';
import { ChatVisualActions } from './ChatVisualActions';

function ChatIcon() { return <ChatBubbleIcon size={20} />; }
const ChatMarkdown = memo(ExplanationContent);
export function AssistantChat({ suspended = false }: { suspended?: boolean }) {
  const english = useLocaleStore((s) => s.locale) === 'en', tr = english ? chatEn : chatPt;
  const state = useChatStore();
  const expanded = useChatPresentation(s => s.expanded);
  const setExpanded = useChatPresentation(s => s.setExpanded);
  const fullTarget = useFullChatDockTarget();
  const dockTarget = useChatDockTarget();
  const canvasTarget = useCanvasChatDockTarget();
  const canvasMaximized = useCanvasChatMaximized();
  const mobile = useIsMobile();
  const canvas = !!canvasTarget && !expanded;
  const docked = !!dockTarget && !canvas && !mobile && !expanded;
  const modal = mobile && !canvas && !expanded;
  const ready = useConfigStore(() => Boolean(getActiveConfig()?.config.apiKey.trim()));
  const model = useConfigStore(() => getActiveConfig()?.config.mainModel ?? null);
  useWorkspaceStore((s) => s.activeProjectId); useWorkspaceStore((s) => s.projects);
  useWorkspaceStore(s => s.notes); useWorkspaceStore(s => s.tasks); // Re-evaluate documentary context when project records change.
  useWorkspaceStore(s => s.surface); useWorkspaceStore(s => s.activeBoardId); useWorkspaceStore(s => s.boards);
  useChatFocusStore();
  useGraphStore(s => s.selectedNodeId); useGraphStore(s => s.viewMode); useGraphStore(s => s.lens);
  const turnContext = captureChatTurnContext();
  useGraphStore(state => state.project?.id);
  const [input, setInput] = useState('');
  const [references, setReferences] = useState<ChatReferenceTarget[]>([]);
  const [files, setFiles] = useState<PlanFile[]>([]), [filesBusy, setFilesBusy] = useState(false);
  const [referenceError, setReferenceError] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [visibleMessages, setVisibleMessages] = useState(60);
  const [choosingImage, setChoosingImage] = useState(false), imageChoiceRunning = useRef(false);
  const handoff = useChatReferenceHandoff(state => state.pending);
  const contextProjectId = turnContext.projectId;
  const referenceDraft = useRef({ references, files, contextProjectId, sessionId: state.sessionId });
  referenceDraft.current = { references, files, contextProjectId, sessionId: state.sessionId };
  const mounted = useRef(true);
  useEffect(() => { if (!state.open && expanded) setExpanded(false); }, [state.open, expanded, setExpanded]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const previousSession = useRef(state.sessionId);
  useEffect(() => {
    if (previousSession.current === state.sessionId) return;
    previousSession.current = state.sessionId; setInput(''); setReferences([]); setFiles([]); setFilesBusy(false); setReferenceError(''); setVisibleMessages(60);
  }, [state.sessionId]);
  useEffect(() => {
    if (!handoff) return;
    const request = consumeChatReferenceHandoff(handoff.id);
    if (!request) return;
    try {
      const chat = useChatStore.getState();
      if (!chat.hydrated || chat.loadFailed || chat.archivedAt != null || chat.deletedAt != null || chat.sessionId !== request.sessionId) throw new Error('chatReadOnly');
      const added = request.references.map(reference => resolveChatReferenceTarget({ ...reference, projectId: request.projectId }));
      const merged = [...references];
      for (const target of added) {
        const index = merged.findIndex(reference => reference.id === target.id && reference.kind === target.kind && reference.projectId === target.projectId && reference.planId === target.planId);
        const currentSelection = merged[index]?.noteSelection, selection = target.noteSelection;
        if (currentSelection && selection && (currentSelection.blockId !== selection.blockId || currentSelection.start !== selection.start || currentSelection.end !== selection.end || currentSelection.original !== selection.original)) throw new Error('chatReferenceSelectionConflict');
        if (index < 0) merged.push(target); else merged[index] = currentSelection && !selection ? { ...target, noteSelection: currentSelection } : target;
      }
      if (merged.length > CHAT_REFERENCE_LIMIT) throw new Error('chatReferenceLimit');
      setReferences(merged);
      const composerText = request.composerText;
      if (composerText?.trim()) setInput(current => current ? `${current}\n\n${composerText}` : composerText);
      setReferenceError('');
    } catch (reason) { setReferenceError(reason instanceof Error && reason.message === 'chatReadOnly' ? (english ? 'This conversation cannot accept the request. Choose an active conversation and try again.' : 'Esta conversa não pode receber o pedido. Escolha uma conversa ativa e tente novamente.') : chatReferenceError(reason, english)); }
  }, [handoff, english, references]);
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
  // Keyboard entry matches the reference without opening over a pen merely passing by.
  useEffect(() => {
    if (!canvasTarget || expanded) return;
    const shortcut = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.altKey || !(event.ctrlKey || event.metaKey) || !event.shiftKey || event.code !== 'Space' && event.key !== ' ') return;
      if (document.querySelector('[aria-modal="true"]')) return;
      event.preventDefault(); useChatStore.getState().setOpen(!useChatStore.getState().open);
    };
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, [canvasTarget, expanded]);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (suspended && !expanded && !canvas) return;
    const otherModal = [...document.querySelectorAll('[aria-modal="true"]')].some((el) => el !== panelRef.current);
    if (!otherModal) {
      if (state.open) (inputRef.current?.disabled ? panelRef.current?.querySelector<HTMLButtonElement>('button:not([disabled])') : inputRef.current)?.focus();
      else if (wasOpen.current) triggerRef.current?.focus();
    }
    wasOpen.current = state.open;
  }, [state.open, dockTarget, fullTarget, canvasTarget, canvas, expanded, mobile, titleId, suspended]);
  useEffect(() => { if (state.open && (!suspended || expanded || canvas)) bottomRef.current?.scrollIntoView({ block: 'nearest' }); }, [state.messages, state.open, dockTarget, fullTarget, canvas, expanded, mobile, suspended]);
  const close = useCallback(() => { setExpanded(false); state.setOpen(false); }, [setExpanded, state.setOpen]);
  const send = () => {
    if ((!input.trim() && !files.length) || historyOpen && (mobile || !expanded) || filesBusy || state.running || state.archivedAt || imageChoiceRunning.current || !ready || !state.hydrated || cooldownUntil > Date.now()) return;
    try { resolveChatReferences(references, contextProjectId); }
    catch (reason) { setReferenceError(chatReferenceError(reason, english)); return; }
    const value = input; void sendChatMessage(value, { references, files, turnContext: captureChatTurnContext() });
    setInput(''); setReferences([]); setFiles([]); setReferenceError('');
  };
  const chooseImage = useCallback(async (image: ImageReference, sourceProjectId: string, options: { useAs3D: boolean }, linkedNodeId?: string, expectedPlanId?: string, searchContext?: { expectedContextRevision: string; searchInput: VisualPromptInput }) => {
    if (imageChoiceRunning.current) throw new Error('chatImageBusy');
    const sessionId = useChatStore.getState().sessionId;
    function validateDraft() {
      const chat = useChatStore.getState();
      if (!chat.hydrated || chat.loadFailed || chat.archivedAt || chat.deletedAt) throw new Error('chatReadOnly');
      if (useWorkspaceStore.getState().activeProjectId !== sourceProjectId) throw new Error('visualProjectChanged');
      if (expectedPlanId && useGraphStore.getState().project?.id !== expectedPlanId) throw new Error('visualPlanChanged');
      const draft = referenceDraft.current;
      if (draft.files.length && draft.contextProjectId !== sourceProjectId) throw new Error('chatReferenceHandoffConflict');
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
      setReferenceError('');
      if (options.useAs3D) useChatStore.getState().setOpen(false); else inputRef.current?.focus();
    } finally { imageChoiceRunning.current = false; if (mounted.current) setChoosingImage(false); }
  }, []);
  if (suspended && !expanded && !canvas) return null;
  const screenLabels = english ? { projects: 'Projects', overview: 'Overview', kanban: 'Tasks', scrum: 'Sprints', notes: 'Notes', planner: 'Plan builder', boards: 'Dynamic Board' } : { projects: 'Projetos', overview: 'Visão geral', kanban: 'Tarefas', scrum: 'Sprints', notes: 'Notas', planner: 'Construtor de planos', boards: 'Dynamic Board' };
  const focusLabel = turnContext.nodeName || turnContext.noteTitle || turnContext.boardTitle;
  const contextLabel = [screenLabels[turnContext.surface], turnContext.projectName, focusLabel].filter(Boolean).join(' · ');
  const noteContext = turnContext.surface === 'notes' && !!turnContext.noteId;
  const composerPlaceholder = noteContext ? (english ? 'Research, create a diagram or revise this note…' : 'Pesquise, crie um diagrama ou revise esta nota…') : tr.placeholder;
  const greeting = noteContext ? (english ? 'Explore this note with AI' : 'Explore esta nota com IA') : tr.greeting;
  const greetingHint = noteContext ? (english ? 'Research references, create a diagram or adjust a passage using this note’s context.' : 'Pesquise referências, crie um diagrama ou ajuste um trecho usando o contexto desta nota.') : tr.hint;
  const examples = noteContext ? (english ? ['Research references for this note', 'Create a diagram to explain this note', 'Revise the text of this note'] : ['Pesquise referências para esta nota', 'Crie um diagrama para explicar esta nota', 'Revise o texto desta nota']) : [tr.exampleProject, tr.exampleNote, tr.exampleReview];
  const actionsDisabled = state.running || !state.hydrated || state.loadFailed || !!state.archivedAt || !!state.deletedAt;
  const budgetHint = state.contextUsage && [english ? 'Estimated context usage. Automatic compaction at 60%; full messages remain in history.' : 'Uso estimado do contexto. Compactação automática aos 60%; as mensagens completas continuam no histórico.', state.contextUsage.contextWindowSource === 'fallback' ? (english ? `Conservative application budget: ${state.contextUsage.contextWindowTokens.toLocaleString('en')} tokens; actual model window is unknown.` : `Orçamento conservador da aplicação: ${state.contextUsage.contextWindowTokens.toLocaleString('pt-BR')} tokens; a janela real do modelo é desconhecida.`) : ''].filter(Boolean).join(' ');
  const panel = state.open && <section ref={panelRef} id={`${titleId}-panel`} className={`dd-chat ${canvas ? 'is-canvas' : ''} ${!state.messages.length && !historyOpen ? 'is-empty' : ''} ${historyOpen ? 'has-history' : ''} ${docked ? 'is-docked' : ''} ${modal ? 'is-modal' : ''} ${expanded ? 'is-expanded' : ''}`} role={docked || canvas || expanded ? 'complementary' : 'dialog'} aria-modal={modal || undefined} aria-labelledby={titleId} onKeyDown={(e) => {
    if (e.defaultPrevented || e.nativeEvent.isComposing) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    if (modal && e.key === 'Tab') {
      const items = [...e.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled])')].filter(item => !item.closest('[hidden]'));
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
    }
  }}>
      <header className="dd-chat-header"><div className="dd-chat-symbol"><ChatIcon /></div><div><h2 id={titleId}>{tr.title}{expanded && <> <small>{english ? 'Expanded' : 'Expandido'}</small></>}</h2><p>{state.compacting ? (english ? 'Organizing context…' : 'Organizando contexto…') : state.running ? tr.working : ready ? tr.ready : tr.noKey}</p></div><button className="ws-icon-button" aria-label={english ? 'Conversation history' : 'Histórico de conversas'} title={tr.conversations} aria-expanded={historyOpen} onClick={() => setHistoryOpen(!historyOpen)}><HistoryIcon size={18}/></button><button className="ws-icon-button" disabled={state.running || !state.hydrated || state.loadFailed} aria-label={tr.newChat} title={tr.newChat} onClick={state.newConversation}><Icon name="plus" /></button><button className="ws-icon-button" aria-label={expanded ? (english ? 'Collapse chat' : 'Recolher chat') : (english ? 'Expand chat' : 'Expandir chat')} title={expanded ? (english ? 'Return to popup' : 'Voltar ao pop-up') : (english ? 'Expand chat' : 'Expandir chat')} onClick={() => setExpanded(!expanded)}>{expanded ? <ExitFullScreenIcon size={18}/> : <EnterFullScreenIcon size={18}/>}</button><button className="ws-icon-button" aria-label={tr.close} onClick={close}><Icon name="close" /></button></header>
      <div className="dd-chat-context"><span title={`${english && expanded ? 'Source screen' : expanded ? 'Tela de origem' : tr.context}: ${contextLabel}`}>{expanded ? (english ? 'In focus' : 'Em foco') : tr.context}: {contextLabel}</span>{state.contextUsage && <small className="dd-chat-budget" title={budgetHint || undefined}>~{Math.round(state.contextUsage.percent)}%{state.compaction ? ' ↻' : ''}</small>}<button onClick={() => requestWorkspaceUI({ settings: true })}>{ready ? model : tr.settings}</button></div>
      {(state.loadFailed || state.saveFailed) && <div className="dd-chat-storage-error" role="alert"><span>{state.loadFailed ? tr.loadError : tr.saveError}</span><button onClick={() => void retryChatPersistence()}>{tr.retry}</button></div>}
      <div className={`dd-chat-layout ${historyOpen ? 'has-history' : ''}`}>
      {historyOpen && <ChatHistory english={english} onSelect={() => { if (mobile || !expanded) setHistoryOpen(false); }}/>}<div className="dd-chat-conversation" hidden={historyOpen && (mobile || !expanded)}>
      {!!state.archivedAt && <div className="dd-chat-archived-notice"><span>{english ? 'Archived conversation' : 'Conversa arquivada'}</span><button disabled={state.running} onClick={() => state.restoreConversation(state.sessionId)}>{english ? 'Restore' : 'Restaurar'}</button></div>}
      <div className="dd-chat-messages" aria-busy={state.running}>
        {state.messages.length > visibleMessages && <button className="dd-chat-older" onClick={() => setVisibleMessages(visibleMessages + 60)}>{english ? 'Load earlier messages' : 'Carregar mensagens anteriores'}</button>}
        {!state.hydrated ? <p className="dd-chat-empty">{tr.loading}</p> : !state.messages.length ? <div className="dd-chat-welcome"><div className="dd-chat-welcome-icon"><ChatIcon /></div><h3>{greeting}</h3><p>{greetingHint}</p><div>{examples.map((example) => <button key={example} onClick={() => { setInput(example); inputRef.current?.focus(); }}>{example}<Icon name="arrow" size={14} /></button>)}</div></div> : state.messages.slice(-visibleMessages).map((message) => <article className={`dd-chat-message ${message.role}`} key={message.id}>
          {message.actions && message.actions.length > 0 && <details className="dd-chat-actions" open={state.running || message.actions.some((a) => a.status === 'error' || a.status === 'awaiting_approval')}><summary>{tr.actions}<span>{message.actions.filter((a) => a.status === 'done').length}/{message.actions.length}</span></summary><ul>{message.actions.map((action) => <li key={action.id} className={action.status}><span>{action.status === 'running' ? <i /> : <Icon name={action.status === 'error' ? 'close' : 'check'} size={13} />}</span><span>{actionLabel(action.action, english)}</span><small>{action.status === 'running' ? tr.working : action.status === 'done' ? tr.actionDone : action.status === 'awaiting_approval' ? (english ? 'Awaiting approval' : 'Aguardando aprovação') : tr.actionError}</small></li>)}</ul></details>}
          {message.text ? <ChatMarkdown text={message.text} /> : state.running && <span className="dd-chat-thinking" role="status">{tr.working}<i /><i /><i /></span>}
          {message.role === 'user' && message.turnContext && <small className="dd-chat-message-context">{[screenLabels[message.turnContext.surface], message.turnContext.projectName, message.turnContext.nodeName || message.turnContext.noteTitle || message.turnContext.boardTitle].filter(Boolean).join(' · ')}</small>}
          {!!message.references?.length && <div className="dd-chat-message-references" aria-label={english ? 'References sent' : 'Referências enviadas'}>{message.references.map(reference => <span key={`${reference.kind}:${reference.projectId}:${reference.id}`} title={english ? 'Snapshot at the time of sending' : 'Versão no momento do envio'}>@ {reference.label}</span>)}</div>}
          {!!message.files?.length && <div className="dd-chat-message-references" aria-label={english ? 'Files sent' : 'Anexos enviados'}>{message.files.map(file => <details key={file.id}><summary>{file.name}{file.truncated ? (english ? ' · excerpt' : ' · trecho') : ''}</summary><pre className="plan-attachment-preview">{file.text.slice(0, 8000)}</pre></details>)}</div>}
          {message.intake && <small className="dd-chat-intake" title={message.intake.status === 'classified' ? (english ? `Model confidence: ${Math.round(message.intake.classification.confidence * 100)}%. Advisory only.` : `Confiança do modelo: ${Math.round(message.intake.classification.confidence * 100)}%. Classificação orientativa.`) : (english ? 'The assistant continues without a TypeSafe classification.' : 'O assistente continua sem classificação do TypeSafe.')}>{intakeLabel(message.intake, english)}</small>}
          {message.actions?.filter(action => action.name === 'planner_structure' && (action.status === 'done' || action.status === 'error')).map(action => <ChatPlanChanges key={action.id} result={action.result} english={english} disabled={actionsDisabled} />)}
          {message.interrupted && <small className="dd-chat-interrupted">{tr.interrupted}</small>}
          <ChatVisualActions actions={message.actions} english={english} disabled={actionsDisabled || choosingImage} onChoose={chooseImage} onClose={close} />
        </article>)}<div ref={bottomRef} />
      </div>
      {!ready && <button className="dd-chat-configure ws-button primary" onClick={() => requestWorkspaceUI({ settings: true })}>{tr.settings}<Icon name="arrow" size={16} /></button>}
      {cooldownSeconds > 0 && <p className="dd-chat-cooldown" role="status">{tr.cooldown(cooldownSeconds)}</p>}
      {referenceError && <p className="dd-chat-reference-error" role="alert">{referenceError}</p>}
      <ChatComposer text={input} onText={setInput} references={references} onReferences={next => { setReferences(next); setReferenceError(''); }} files={files} onFiles={setFiles} onFilesBusy={setFilesBusy} scopeKey={`${state.sessionId}:${contextProjectId}`} projectId={contextProjectId} inputRef={inputRef} english={english} placeholder={composerPlaceholder} sendLabel={tr.send} stopLabel={tr.stop} disabled={!state.hydrated || !!state.archivedAt} canSend={(!!input.trim() || !!files.length) && !filesBusy && ready && state.hydrated && !state.archivedAt && !choosingImage && cooldownSeconds <= 0} running={state.running} onSubmit={send} onStop={stopChat} />
      </div></div>
    </section>;
  const trigger = canvas && canvasTarget ? <CanvasChatEntry ref={triggerRef} host={canvasTarget} maximized={canvasMaximized} hidden={state.open} working={state.running} label={tr.open} text={input.trim() || references.length || files.length ? (english ? 'Continue' : 'Continuar') : (english ? 'Chat' : 'Conversar')} title={`${english ? 'Drag to the edge to dock' : 'Arraste até a borda para encaixar'} · Ctrl/⌘ + Shift + Space`} open={state.open} controls={state.open ? `${titleId}-panel` : undefined} onActivate={() => state.setOpen(!state.open)}><ChatIcon /></CanvasChatEntry> : <button ref={triggerRef} className={`dd-chat-trigger ${state.running ? 'is-working' : ''} ${state.open && (docked || mobile || expanded) ? 'is-hidden' : ''}`} onClick={() => state.setOpen(!state.open)} aria-expanded={state.open} aria-controls={state.open ? `${titleId}-panel` : undefined} aria-label={tr.open} title={tr.open}><ChatIcon />{state.running && <i />}</button>;
  return <>
    {canvasTarget && !expanded ? createPortal(<>{trigger}{panel}</>, canvasTarget) : trigger}
    {state.open && modal && <div className="dd-chat-scrim" aria-hidden="true" onClick={close} />}
    {canvas ? null : expanded && fullTarget ? createPortal(panel, fullTarget) : docked && dockTarget ? createPortal(panel, dockTarget) : panel}
  </>;
}
