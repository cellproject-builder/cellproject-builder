import { create } from 'zustand';
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware';
import { nanoid } from 'nanoid';
import type { ModelMessage } from 'ai';
import { workspaceRepository } from '@/data/workspaceRepository';
import { getCloudRuntime } from '@/cloud/runtime';
import { runAssistant, type ChatFinalAnswerError } from '@/ai/assistant';
import { estimateWorkspacePromptTokens } from '@/ai/agents/workspaceAgent';
import { classifyAIError } from '@/ai/service';
import { currentModelIds } from '@/ai/client';
import type { AssistantActionEvent } from '@/ai/workspaceTools';
import { currentLocale } from '@/i18n';
import { chatEn, chatPt } from './messages';
import { chatSubmissionText, chatReferenceHistoryContent, chatFileHistorySuffix } from './messageSources';
import { useWorkspaceStore, flushWorkspacePersistence } from '@/workspace/store';
import { planFileSchema, planFilesContext, type PlanFile } from '@/attachments/files';
import { addProjectFiles } from '@/attachments/projectFiles';
import { classifyPlanRequest, type PlanIntake } from '@/ai/planIntake';
import { chatReferenceError, resolveChatReferences, type ChatReferenceSnapshot, type ChatReferenceTarget } from './references';
import { normalizeChatSession, normalizeInactiveSessions, tombstoneConversation } from './sessionHistory';
import { ChatContextBudgetError, prepareChatContext, type ChatCompactionCheckpoint, type ChatContextUsage } from './contextBudget';
import { captureChatTurnContext, type ChatTurnContext } from './turnContext';
import { captureNoteEditBaseline } from '@/ai/noteEditBaseline';
import { capturePlannerEditBaseline } from '@/ai/plannerEditBaseline';

export interface ChatMessage { id: string; role: 'user' | 'assistant'; text: string; createdAt: number; actions?: AssistantActionEvent[]; interrupted?: boolean; references?: ChatReferenceSnapshot[]; referenceProjectId?: string | null; files?: PlanFile[]; intake?: PlanIntake; turnContext?: ChatTurnContext }
export interface ChatContextObservation { modelKey: string; inputTokens: number; historyMessageCount: number; fixedTokens?: number }
export interface ChatSession {
  sessionId: string; id?: string; title?: string; createdAt?: number; updatedAt?: number; archivedAt?: number | null; deletedAt?: number | null;
  messages: ChatMessage[]; modelHistory: ModelMessage[]; pendingHistory?: ModelMessage[] | null;
  compaction?: ChatCompactionCheckpoint | null; contextUsage?: ChatContextUsage | null;
  contextObservation?: ChatContextObservation | null;
}
interface ChatState extends ChatSession {
  archivedSessions: ChatSession[]; open: boolean; running: boolean; compacting: boolean; hydrated: boolean; error: string | null;
  saveFailed: boolean; loadFailed: boolean;
  pendingHistory: ModelMessage[] | null;
  rateLimits: Record<string, number>;
  setOpen: (open: boolean) => void; newConversation: () => void; selectConversation: (id: string) => void;
  renameConversation: (id: string, title: string) => void; archiveConversation: (id: string) => void;
  restoreConversation: (id: string) => void; deleteConversation: (id: string) => void;
}
type PersistedChat = ChatSession & Pick<ChatState, 'pendingHistory' | 'archivedSessions' | 'rateLimits'>;
const providerScope = () => { const model = currentModelIds(); return model ? `${model.provider}:${model.main}` : 'unconfigured'; };
export const chatCooldownUntil = () => useChatStore.getState().rateLimits[providerScope()] ?? 0;
let controller: AbortController | null = null;
let writes: Promise<void> = Promise.resolve();
let writeError: unknown = null;
let canWrite = false;
const storage: StateStorage = {
  getItem: async (key) => {
    canWrite = false;
    const result = await workspaceRepository.getItem(key);
    canWrite = true;
    return result;
  },
  setItem: (key, value) => {
    if (!canWrite) return Promise.resolve();
    const cloud = getCloudRuntime(); if (cloud) return cloud.write(key, value);
    const next = writes.then(() => workspaceRepository.setItem(key, value));
    writes = next.then(() => { writeError = null; }, (error: unknown) => { writeError = error; });
    void writes.then(() => {
      const saveFailed = !!writeError;
      if (useChatStore.getState().saveFailed !== saveFailed) useChatStore.setState({ saveFailed });
    });
    return writes;
  },
  removeItem: (key) => workspaceRepository.removeItem(key),
};
export async function flushChatPersistence() {
  // A status change can enqueue the latest payload while the first write settles.
  let pending: Promise<void>;
  do { pending = writes; await pending; } while (pending !== writes);
  if (writeError) throw writeError;
  await getCloudRuntime()?.flush();
}
export async function retryChatPersistence() {
  if (useChatStore.getState().loadFailed) await useChatStore.persist.rehydrate();
  else { useChatStore.setState({}); await flushChatPersistence().catch(() => {}); }
}
const session = (state: ChatSession): ChatSession => normalizeChatSession({ sessionId: state.sessionId, messages: state.messages, modelHistory: state.modelHistory,
  title: state.title, createdAt: state.createdAt, updatedAt: state.updatedAt, archivedAt: state.archivedAt, deletedAt: state.deletedAt,
  compaction: state.compaction ?? null, contextUsage: state.contextUsage ?? null, contextObservation: state.contextObservation ?? null, pendingHistory: state.pendingHistory ?? null });
const restoredSession = (state: ChatSession): ChatSession & { pendingHistory: null } => {
  const restored = session(state), pending = restored.pendingHistory, last = restored.messages.at(-1);
  if (pending != null && !Array.isArray(pending)) throw new Error('Invalid pending conversation');
  const interrupted = pending != null;
  return { ...restored, pendingHistory: null,
    modelHistory: interrupted ? [...pending, { role: 'assistant', content: `Request interrupted by reload. Actions may already have applied; read current records before repeating any mutation. Partial reply: ${last?.text ?? ''}\nAction audit: ${JSON.stringify(last?.actions ?? [])}` }] : restored.modelHistory,
    messages: restored.messages.map(message => message.actions?.some(action => action.status === 'running') || interrupted && message === last && message.role === 'assistant'
      ? { ...message, interrupted: true, actions: message.actions?.map(action => action.status === 'running' ? { ...action, status: 'error' as const, detail: 'Interrupted' } : action) }
      : message),
  };
};
const emptySession = (): ChatSession & { pendingHistory: null } => {
  const id = nanoid(10), now = Date.now();
  return { id, sessionId: id, title: undefined, createdAt: now, updatedAt: now, archivedAt: null, deletedAt: null, messages: [], modelHistory: [], pendingHistory: null, compaction: null, contextUsage: null, contextObservation: null };
};
const historyMutable = (state: ChatState) => !state.running && state.hydrated && !state.loadFailed;
const keepSession = (state: ChatSession) => state.messages.length > 0 || !!state.title || state.archivedAt != null || state.deletedAt != null;
export const useChatStore = create<ChatState>()(persist<ChatState, [], [], PersistedChat>((set, get) => ({
  ...emptySession(), rateLimits: {}, archivedSessions: [], open: false, running: false, compacting: false, hydrated: false, error: null, saveFailed: false, loadFailed: false,
  setOpen: (open) => set({ open }),
  newConversation: () => {
    const state = get(); if (!historyMutable(state)) return;
    set({ ...emptySession(), error: null, archivedSessions: normalizeInactiveSessions([...state.archivedSessions, ...(keepSession(state) ? [session(state)] : [])]) });
  },
  selectConversation: (id) => {
    const state = get(), target = state.archivedSessions.find((s) => s.sessionId === id);
    if (!historyMutable(state) || !target || target.deletedAt != null) return;
    set({ ...restoredSession(target), error: null, archivedSessions: normalizeInactiveSessions([...state.archivedSessions.filter((s) => s.sessionId !== id), ...(keepSession(state) ? [session(state)] : [])], id) });
  },
  renameConversation: (id, value) => {
    const state = get(), title = value.trim().replace(/\s+/g, ' ').slice(0, 160);
    if (!historyMutable(state) || !title) return;
    if (state.sessionId === id) { if (state.deletedAt == null) set({ title, updatedAt: Date.now() }); return; }
    set({ archivedSessions: state.archivedSessions.map(item => item.sessionId === id && item.deletedAt == null ? session({ ...item, title, updatedAt: Date.now() }) : item) });
  },
  archiveConversation: (id) => {
    const state = get(); if (!historyMutable(state)) return;
    const now = Date.now();
    if (state.sessionId === id) {
      if (state.deletedAt != null) return;
      set({ ...emptySession(), error: null, archivedSessions: normalizeInactiveSessions([...state.archivedSessions, session({ ...state, archivedAt: now, updatedAt: now })]) });
    } else set({ archivedSessions: state.archivedSessions.map(item => item.sessionId === id && item.deletedAt == null ? session({ ...item, archivedAt: now, updatedAt: now }) : item) });
  },
  restoreConversation: (id) => {
    const state = get(); if (!historyMutable(state)) return;
    if (state.sessionId === id) { if (state.deletedAt == null) set({ archivedAt: null, updatedAt: Date.now() }); return; }
    set({ archivedSessions: state.archivedSessions.map(item => item.sessionId === id && item.deletedAt == null ? session({ ...item, archivedAt: null, updatedAt: Date.now() }) : item) });
  },
  deleteConversation: (id) => {
    const state = get(); if (!historyMutable(state)) return;
    const target = state.sessionId === id ? state : state.archivedSessions.find(item => item.sessionId === id);
    if (!target || target.deletedAt != null) return;
    const deleted = tombstoneConversation(session(target), Date.now());
    const archivedSessions = normalizeInactiveSessions([...state.archivedSessions.filter(item => item.sessionId !== id), deleted]);
    set({ ...(state.sessionId === id ? { ...emptySession(), error: null } : {}), archivedSessions });
  },
}), {
  name: 'dynamic_diary-chat', version: 1, storage: createJSONStorage(() => storage),
  partialize: (state) => ({ ...session(state), pendingHistory: state.pendingHistory, archivedSessions: state.archivedSessions, rateLimits: state.rateLimits }),
  onRehydrateStorage: () => (_state, error) => {
    // JSON/schema failures occur after getItem succeeds. Closing the adapter
    // before presenting that error protects the unreadable original document.
    if (error) canWrite = false;
    useChatStore.setState({ hydrated: !error, loadFailed: !!error });
  },
  merge: (saved, current) => {
    const data = saved as Partial<ChatState> | undefined;
    const inactive = normalizeInactiveSessions(data?.archivedSessions ?? []);
    const deletedActive = inactive.find(item => item.sessionId === data?.sessionId && item.deletedAt != null);
    const restored = data?.sessionId && !deletedActive ? restoredSession({ ...data, sessionId: data.sessionId, messages: data.messages ?? [], modelHistory: data.modelHistory ?? [] }) : emptySession();
    return { ...current, ...restored, archivedSessions: normalizeInactiveSessions(inactive, restored.sessionId), open: current.open, running: false, compacting: false, error: null, hydrated: current.hydrated, saveFailed: current.saveFailed, loadFailed: current.loadFailed,
      pendingHistory: null,
      rateLimits: data?.rateLimits ?? {},
      messages: restored.messages,
    };
  },
}));

export async function sendChatMessage(value: string, options?: { references?: ChatReferenceTarget[]; projectId?: string | null; files?: PlanFile[]; turnContext?: ChatTurnContext }) {
  const text = chatSubmissionText(value, !!options?.files?.length, !!options?.references?.length, currentLocale() === 'en'), initial = useChatStore.getState();
  if (!text || initial.running || !initial.hydrated || initial.loadFailed || initial.archivedAt != null || initial.deletedAt != null) return;
  if (chatCooldownUntil() > Date.now()) return;
  const requestScope = providerScope();
  const copy = currentLocale() === 'en' ? chatEn : chatPt;
  const captured = options?.turnContext ?? captureChatTurnContext();
  const projectId = options?.projectId !== undefined ? options.projectId : captured.projectId;
  const turnContext = options?.projectId !== undefined && projectId !== captured.projectId ? Object.freeze({ ...captured, projectId }) : captured;
  const noteEditBaseline = captureNoteEditBaseline(turnContext);
  const plannerEditBaseline = capturePlannerEditBaseline(turnContext, projectId);
  let references: ChatReferenceSnapshot[];
  let files: PlanFile[];
  try { references = resolveChatReferences(options?.references ?? [], projectId); files = zFiles(options?.files ?? []); }
  catch (reason) { useChatStore.setState({ error: chatReferenceError(reason, currentLocale() === 'en') }); return; }
  const user: ChatMessage = { id: nanoid(10), role: 'user', text, createdAt: Date.now(), turnContext, ...(references.length ? { references, referenceProjectId: projectId } : {}), ...(files.length ? { files, referenceProjectId: projectId } : {}) };
  const assistant: ChatMessage = { id: nanoid(10), role: 'assistant', text: '', createdAt: Date.now(), actions: [] };
  const content = chatReferenceHistoryContent(text, projectId, references);
  let history: ModelMessage[] = [...initial.modelHistory, { role: 'user', content }];
  const active = new AbortController(); controller = active;
  const ownsTurn = (state = useChatStore.getState()) => controller === active && state.sessionId === initial.sessionId && state.running && state.messages.some(message => message.id === assistant.id);
  const assertTurn = () => {
    active.signal.throwIfAborted();
    if (!ownsTurn()) { active.abort(new DOMException('Conversation changed', 'AbortError')); active.signal.throwIfAborted(); }
  };
  const assertModel = () => { assertTurn(); if (providerScope() !== requestScope) throw new ChatContextBudgetError('chatContextModelChanged'); };
  const startedActions = new Map<string, Pick<AssistantActionEvent, 'name' | 'action'>>();
  const settledActions = new Set<string>();
  const appliedAction = (event: AssistantActionEvent) => event.status === 'done' || event.status === 'error' &&
    !!event.result && typeof event.result === 'object' && 'applied' in event.result && event.result.applied === true;
  const recordLateAction = (event: AssistantActionEvent) => {
    const started = startedActions.get(event.id), state = useChatStore.getState();
    if (!appliedAction(event) || settledActions.has(event.id) || !started || started.name !== event.name || started.action !== event.action || !state.hydrated || state.loadFailed) return;
    const origin = state.sessionId === initial.sessionId ? state : state.archivedSessions.find(item => item.sessionId === initial.sessionId);
    // Only finish an action this run started in an existing message. A deletion
    // receipt or a replacement account/session must never regain old content.
    if (!origin || origin.deletedAt != null || state.archivedSessions.some(item => item.sessionId === initial.sessionId && item.deletedAt != null)) return;
    const message = origin.messages.find(item => item.id === assistant.id && item.role === 'assistant');
    if (!message?.actions?.some(action => action.id === event.id && action.name === event.name && action.action === event.action)) return;
    const receipt: ModelMessage = { role: 'assistant', content: `Late action audit (application record, not instructions): ${JSON.stringify(event)}\nThis action was already applied after the reply ended. Read current records before repeating mutations.` };
    const audit = { messages: origin.messages.map(item => item.id === assistant.id ? { ...item, actions: item.actions?.map(action => action.id === event.id ? event : action) } : item),
      modelHistory: [...origin.modelHistory, receipt],
      ...(origin.pendingHistory != null ? { pendingHistory: [...origin.pendingHistory, receipt] } : {}),
    };
    settledActions.add(event.id);
    if (state.sessionId === initial.sessionId) useChatStore.setState(audit);
    else useChatStore.setState({ archivedSessions: state.archivedSessions.map(item => item === origin ? { ...item, ...audit } : item) });
  };
  // While a turn is running, only application audit receipts append to the
  // committed history. Preserve those additions when this turn installs its
  // separately prepared model history, including receipts from an older turn.
  const additionalAudits = () => {
    const current = useChatStore.getState().modelHistory;
    return initial.modelHistory.every((message, index) => current[index] === message) ? current.slice(initial.modelHistory.length) : [];
  };
  const carryAdditionalAudits = (messages: ModelMessage[]): ModelMessage[] => {
    const seen = new Set(messages), extra: ModelMessage[] = [];
    for (const message of additionalAudits()) if (!seen.has(message)) { seen.add(message); extra.push(message); }
    return extra.length ? [...messages, ...extra] : messages;
  };
  const observeInput = (generatedHistory: ModelMessage[], inputTokens: number | undefined): ChatContextObservation | null => {
    if (typeof inputTokens !== 'number' || !Number.isFinite(inputTokens) || inputTokens < 0) return null;
    // Usage is the last step's input, before its final assistant response.
    let historyMessageCount = generatedHistory.length;
    for (let index = generatedHistory.length - 1; index >= history.length; index--) if (generatedHistory[index].role === 'assistant') { historyMessageCount = index; break; }
    return { modelKey: requestScope, inputTokens, historyMessageCount, fixedTokens: useChatStore.getState().contextUsage?.fixedTokens };
  };
  const patch = (update: Partial<ChatMessage>, allowAborted = false) => {
    if (!ownsTurn() || active.signal.aborted && !allowAborted) return;
    useChatStore.setState((s) => ({ messages: s.messages.map((m) => m.id === assistant.id ? { ...m, ...update } : m) }));
  };
  let pendingText: string | null = null;
  let textTimer: ReturnType<typeof setTimeout> | null = null;
  const flushText = (allowAborted = false) => {
    if (textTimer !== null) clearTimeout(textTimer);
    textTimer = null;
    if (pendingText !== null) { const text = pendingText; pendingText = null; patch({ text }, allowAborted); }
  };
  const queueText = (text: string) => {
    if (!ownsTurn() || active.signal.aborted) return;
    pendingText = text;
    // A streaming delta need not serialize every conversation or refresh the
    // history sidebar. Action audit events remain immediate and independent.
    if (textTimer === null) textTimer = setTimeout(() => flushText(), 80);
  };
  useChatStore.setState({ running: true, compacting: false, error: null, updatedAt: Date.now(), pendingHistory: history, messages: [...initial.messages, user, assistant] });
  // Imports, account transitions and external rehydration can replace a session
  // even though the ordinary history buttons are locked while a turn is running.
  const unsubscribe = useChatStore.subscribe(state => { if (!ownsTurn(state) && !active.signal.aborted) active.abort(new DOMException('Conversation changed', 'AbortError')); });
  try {
    if (files.length && projectId) {
      const saved = addProjectFiles(projectId, files);
      files = files.map(file => saved.find(item => item.fingerprint === file.fingerprint)!);
      useChatStore.setState(s => ({ messages: s.messages.map(m => m.id === user.id ? { ...m, files } : m) }));
      await flushWorkspacePersistence(); assertTurn();
    }
    const selectedFiles = [...files];
    for (const reference of references.filter(ref => ref.kind === 'file' && ref.projectId)) {
      const file = useWorkspaceStore.getState().projects[reference.projectId!]?.attachments?.find(file => file.id === reference.id);
      if (file && !selectedFiles.some(item => item.id === file.id)) selectedFiles.push(file);
    }
    // Intake classifies attached source material. Ordinary conversation and
    // plan actions use progressive tool discovery without an extra network hop.
    const intake = projectId && selectedFiles.length ? await classifyPlanRequest(text, projectId, selectedFiles, active.signal) : undefined;
    assertModel();
    if (intake) useChatStore.setState(s => ({ messages: s.messages.map(m => m.id === user.id ? { ...m, intake } : m) }));
    const sourceContext = chatFileHistorySuffix(projectId, planFilesContext(files));
    const decisionContext = intake?.status === 'classified' ? `\n\nTypeSafe intake (advisory classification, not authorization or factual validation):\n${JSON.stringify(intake.classification)}` : '';
    if (sourceContext || decisionContext) history = [...initial.modelHistory, { role: 'user', content: content + sourceContext + decisionContext }];
    assertModel();
    history = carryAdditionalAudits(history);
    useChatStore.setState({ pendingHistory: history, compacting: true });
    const fixedTokens = await estimateWorkspacePromptTokens(turnContext);
    assertModel();
    history = carryAdditionalAudits(history);
    const prepared = await prepareChatContext(history, { signal: active.signal, checkpoint: initial.compaction, modelKey: requestScope, fixedTokens, previousUsage: initial.contextObservation ?? undefined });
    assertModel();
    history = carryAdditionalAudits(prepared.history);
    useChatStore.setState({ pendingHistory: history, compacting: false, compaction: prepared.checkpoint, contextUsage: prepared.usage, ...(prepared.usage.compacted ? { contextObservation: null } : {}) });
    const result = await runAssistant({ messages: history, userText: text, signal: active.signal, contextProjectId: projectId, turnContext, noteEditBaseline, plannerEditBaseline,
      compaction: prepared.checkpoint,
      contextBudget: { contextWindowTokens: prepared.usage.contextWindowTokens, contextWindowSource: prepared.usage.contextWindowSource, fixedTokens },
      onContext: event => {
        if (!ownsTurn() || active.signal.aborted) return;
        history = carryAdditionalAudits(event.history);
        useChatStore.setState({ pendingHistory: history, compaction: event.checkpoint, contextUsage: event.usage,
          ...(event.usage.compacted ? { contextObservation: null } : {}) });
      },
      onText: queueText,
      onAction: (event) => {
        if (!ownsTurn() || active.signal.aborted) { recordLateAction(event); return; }
        if (event.status === 'running') startedActions.set(event.id, { name: event.name, action: event.action });
        const message = useChatStore.getState().messages.find((m) => m.id === assistant.id);
        const actions = message?.actions ?? [];
        patch({ actions: actions.some((a) => a.id === event.id) ? actions.map((a) => a.id === event.id ? event : a) : [...actions, event] }, event.status === 'done');
        if (appliedAction(event)) settledActions.add(event.id);
        if (event.action === 'undo_structure' && event.status === 'done' && event.result && typeof event.result === 'object' && 'undoId' in event.result && typeof event.result.undoId === 'string') markChatStructureUndone(event.result.undoId);
      },
    });
    assertTurn();
    flushText();
    const missingReply = !result.text.trim();
    patch({ text: missingReply ? copy.missingReply : result.text });
    const generatedHistory = result.contextMessages ?? [...history, ...result.messages];
    const modelHistory = carryAdditionalAudits(missingReply ? [...generatedHistory, { role: 'assistant', content: `${copy.missingReply}\nRead current records before repeating mutations.` }] : generatedHistory);
    useChatStore.setState({ pendingHistory: null, modelHistory, updatedAt: Date.now(), error: missingReply ? copy.missingReply : null,
      contextObservation: observeInput(generatedHistory, result.usage?.inputTokens) });
  } catch (error) {
    if (!ownsTurn()) return;
    flushText(true);
    const interrupted = active.signal.aborted;
    const finalAnswerError = error instanceof Error && error.name === 'ChatFinalAnswerError' && error.message === 'chatFinalAnswerMissing' ? error as ChatFinalAnswerError : null;
    const completedHistory = finalAnswerError?.contextMessages ?? (finalAnswerError ? [...history, ...finalAnswerError.messages] : history);
    const details = classifyAIError(error);
    if (!interrupted && details.kind === 'rate') {
      const retryAt = Date.now() + Math.max(1000, details.retryAfterMs ?? 60_000);
      useChatStore.setState((s) => ({ rateLimits: { ...s.rateLimits, [requestScope]: Math.max(s.rateLimits[requestScope] ?? 0, retryAt) } }));
    }
    const budgetMessage = error instanceof ChatContextBudgetError
      ? error.message === 'chatContextModelChanged'
        ? currentLocale() === 'en' ? 'The model changed while this turn was being prepared. Your message is preserved; send it again with the selected model.' : 'O modelo mudou durante a preparação desta conversa. Sua mensagem foi preservada; envie novamente com o modelo selecionado.'
        : ['chatContextCurrentStepTooLarge', 'chatContextSourcesTooLarge', 'chatCompactionInputTooLarge'].includes(error.message)
          ? currentLocale() === 'en' ? 'A source in this request exceeds the available context. Use a smaller excerpt or read it in parts. Your message and completed actions are preserved.' : 'Uma fonte deste pedido excedeu o espaço disponível. Use um trecho menor ou consulte por partes. Sua mensagem e as ações concluídas foram preservadas.'
          : error.message === 'chatContextToolsTooLarge'
            ? currentLocale() === 'en' ? 'These tool families exceed the available context. Split the requested work into smaller steps. Your message and completed actions are preserved.' : 'As ferramentas desta etapa excederam o espaço disponível. Divida o trabalho em etapas menores. Sua mensagem e as ações concluídas foram preservadas.'
            : currentLocale() === 'en' ? 'The conversation memory could not be prepared safely. Try again; your messages, references and completed actions are preserved.' : 'Não foi possível preparar a memória da conversa com segurança. Tente novamente; suas mensagens, referências e ações concluídas foram preservadas.'
      : null;
    const errorText = interrupted ? copy.interrupted : finalAnswerError ? copy.missingReply : budgetMessage ?? (details.kind === 'rate' ? copy.rateLimited : `${details.title}. ${details.hint}`);
    const message = useChatStore.getState().messages.find((m) => m.id === assistant.id);
    patch({ text: message?.text ? `${message.text}\n\n${errorText}` : errorText, interrupted,
      actions: message?.actions?.map((a) => a.status === 'running' ? { ...a, status: 'error', detail: errorText } : a),
    }, true);
    useChatStore.setState({ pendingHistory: null, updatedAt: Date.now(), error: interrupted ? null : errorText,
      ...(finalAnswerError ? { contextObservation: observeInput(completedHistory, finalAnswerError.usage?.inputTokens) } : {}),
      modelHistory: carryAdditionalAudits([...completedHistory, { role: 'assistant', content: `${errorText}\nAction audit: ${JSON.stringify(message?.actions ?? [])}. Read current records before repeating mutations.` }]) });
  } finally {
    unsubscribe();
    if (textTimer !== null) clearTimeout(textTimer);
    pendingText = null;
    if (ownsTurn()) useChatStore.setState({ running: false, compacting: false });
    if (controller === active) controller = null;
  }
}
export function stopChat() { controller?.abort(); }
function zFiles(files: PlanFile[]) { if (files.length > 12) throw new Error('attachmentLimit'); return files.map(file => planFileSchema.parse(file)); }
export function markChatStructureUndone(undoId: string) {
  useChatStore.setState(state => ({ messages: state.messages.map(message => ({ ...message, actions: message.actions?.map(action => {
    const original = action.result;
    const wrapped = original && typeof original === 'object' && 'applied' in original && original.applied === true && 'saved' in original && typeof original.saved === 'boolean' && 'result' in original;
    const result = wrapped ? original.result : original;
    if (action.name !== 'planner_structure' || !result || typeof result !== 'object' || !('undoId' in result) || result.undoId !== undoId) return action;
    return { ...action, result: wrapped ? { ...original, result: { ...result, undone: true } } : { ...result, undone: true } };
  }) })), modelHistory: [...state.modelHistory, { role: 'assistant', content: `Structure batch ${undoId} was undone through the application. Read the current plan before any further change.` }] }));
}
