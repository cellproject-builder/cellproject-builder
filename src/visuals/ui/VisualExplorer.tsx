import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import type { ImageReference, MentionTarget, VisualArtifact, VisualAttachment, VisualPromptInput, VisualProposal, VisualSearchReview, VisualWorkspace } from '../types';
import { imageSearchQueries, type ImageSearchIntent } from '../searchIntent';
import { reconcileVisualImageReferences } from '../promptReferences';
import type { ModelRefinement, ModelRefinementRequest } from '../refinement';
import { FloatingPopup } from './FloatingPopup';
import { ImageGallery } from './ImageGallery';
import { PromptComposer } from './PromptComposer';
import { AssemblyPlanSummary } from './ModelAssemblyInspector';
import { useVisualStrings, visualError } from './strings';
import { useVisualPopupStore, type VisualPopupKind, type VisualToolActivity } from './uiStore';
import type { PopupFrame } from './FloatingPopup';
import type { VisualSearchDetails } from '../controller';
import './visuals.css';

const DecompositionPanel = lazy(() => import('./DecompositionPanel').then(module => ({ default: module.DecompositionPanel })));

export interface VisualExplorerProps {
  workspace: VisualWorkspace;
  projectId: string;
  listMentions: (query: string) => MentionTarget[];
  selectedNode?: MentionTarget;
  onDraft: (kind: 'search' | 'model', input: VisualPromptInput) => void;
  onAttach: (file: File, signal?: AbortSignal) => Promise<VisualAttachment>;
  onSearch: (input: VisualPromptInput, signal: AbortSignal, onDetails?: (details: VisualSearchDetails) => void) => Promise<ImageReference[]>;
  onAssess?: (reference: ImageReference, input: VisualPromptInput, signal: AbortSignal) => Promise<ImageReference['assessment']>;
  onCopyImage?: (reference: ImageReference) => Promise<void>;
  onDiscuss?: (references: MentionTarget[]) => void;
  onGenerate: (input: VisualPromptInput, signal: AbortSignal, onProgress?: (message: string) => void) => Promise<VisualProposal>;
  onRefine?: (input: VisualPromptInput, request: ModelRefinementRequest, signal: AbortSignal) => Promise<ModelRefinement>;
  isRefinementCurrent?: (input: VisualPromptInput, result: ModelRefinement) => boolean;
  onAdd: (reference: ImageReference, clientPoint?: { x: number; y: number }) => Promise<void | VisualArtifact>;
  onApply: (proposalId: string) => void;
  onReject: (proposalId: string) => void;
  onRemoveHistory?: (proposalId: string) => void;
  onMode: (mode: 'approval' | 'automatic') => void;
  onMedia: (id: string) => Promise<Blob | null>;
  externalSearch?: { id: string; projectId: string; input: VisualPromptInput; results: ImageReference[]; intent?: ImageSearchIntent; review?: VisualSearchReview } | null;
  session?: {
    id: string; kind: VisualPopupKind; windowId: string; minimized: boolean; frame?: PopupFrame; order: number; tabs?: ReactNode;
    inspectedArtifactId?: string | null; historyProposalIds: string[];
    onClose: () => void; onMinimize: () => void; onFocus: () => void; onFrame: (frame: PopupFrame) => void;
    onInspector: (id: string) => void; onActivity: (activity: VisualToolActivity) => void;
    onFindReferences: (input: VisualPromptInput) => void;
  };
}

function EmptyState({ kind, title, text }: { kind: VisualPopupKind; title: string; text: string }) {
  return <div className={`visual-empty visual-empty-${kind}`}><div className="visual-empty-art" aria-hidden="true">{kind === 'search' ? <><span /><span /><span /></> : <svg viewBox="0 0 100 100" fill="none"><path d="m50 12 33 19v38L50 88 17 69V31zM17 31l33 19 33-19M50 50v38" stroke="currentColor" strokeWidth="1.5"/><path d="M50 12v38L17 69m33-19 33 19" stroke="currentColor" strokeWidth=".7" strokeDasharray="3 4"/></svg>}</div><h3>{title}</h3><p>{text}</p></div>;
}

export function VisualExplorer(props: VisualExplorerProps) {
  const s = useVisualStrings();
  const popup = useVisualPopupStore();
  const { close, minimize, restore } = popup;
  const { session } = props;
  const searchOpen = session ? session.kind === 'search' : popup.searchOpen;
  const modelOpen = session ? session.kind === 'model' : popup.modelOpen;
  const searchMinimized = session ? session.minimized : popup.searchMinimized;
  const modelMinimized = session ? session.minimized : popup.modelMinimized;
  const modelBase = session ? null : popup.modelBase;
  const inspectedArtifactId = session ? session.inspectedArtifactId : popup.inspectedArtifactId;
  const [drafts, setDrafts] = useState(props.workspace.drafts);
  const draftRef = useRef(drafts);
  const latest = useRef(props); latest.current = props;
  const project = useRef(props.projectId);
  const controllers = useRef<Partial<Record<VisualPopupKind, AbortController>>>({});
  const refinement = useRef<{ controller: AbortController; signature: string } | null>(null);
  const [refining, setRefining] = useState(false);
  const [busy, setBusy] = useState({ search: false, model: false });
  const [completed, setCompleted] = useState({ search: false, model: false });
  const [modelActivity, setModelActivity] = useState<VisualToolActivity>({ state: 'idle', label: '' });
  const [generationProgress, setGenerationProgress] = useState('');
  const [errors, setErrors] = useState({ search: '', model: '' });
  const [removedImages, setRemovedImages] = useState<Record<VisualPopupKind, MentionTarget[]>>({ search: [], model: [] });
  const [results, setResults] = useState<ImageReference[] | null>(null);
  const [searchIntent, setSearchIntent] = useState<ImageSearchIntent | null>(null);
  const [searchReview, setSearchReview] = useState<VisualSearchReview | null>(null);
  const [resultsInput, setResultsInput] = useState<VisualPromptInput>(props.workspace.drafts.search);
  const [generated, setGenerated] = useState<VisualProposal | null>(null);
  const [ownProposals, setOwnProposals] = useState<VisualProposal[]>([]);
  const [proposalNotice, setProposalNotice] = useState('');
  const [removedHistory, setRemovedHistory] = useState<string[]>([]);
  const isDiagram = drafts.model.artifactKind === 'diagram';
  const generatingLabel = isDiagram ? s.diagramGenerating : s.generating;
  const externalId = useRef<string | null>(null);

  useEffect(() => {
    const previousProject = project.current;
    if (previousProject !== props.projectId) {
      Object.values(controllers.current).forEach((controller) => controller?.abort()); controllers.current = {};
      cancelRefinement();
      project.current = props.projectId;
      setBusy({ search: false, model: false }); setErrors({ search: '', model: '' }); setResults(null); setSearchIntent(null); setSearchReview(null); setGenerated(null);
      setOwnProposals([]);
      setCompleted({ search: false, model: false });
      setModelActivity({ state: 'idle', label: '' });
      setProposalNotice('');
      setRemovedHistory([]);
      setRemovedImages({ search: [], model: [] });
      if (!session) useVisualPopupStore.setState({ modelBase: null, inspectedArtifactId: null, searchMinimized: false, modelMinimized: false });
    }
    if (refinement.current && refinement.current.signature !== JSON.stringify(props.workspace.drafts.model)) cancelRefinement();
    draftRef.current = props.workspace.drafts; setDrafts(props.workspace.drafts);
    // Older drafts can retain chips for images that no longer exist on the canvas.
    // Recover only those references; a missing note/node still needs explicit review.
    for (const kind of ['search', 'model'] as const) {
      const recovered = reconcileVisualImageReferences(props.workspace.drafts[kind], props.workspace);
      if (recovered.removed.length) {
        updateDraft(kind, recovered.input);
        setRemovedImages(state => ({ ...state, [kind]: recovered.removed }));
        setErrors(state => ({ ...state, [kind]: '' }));
      }
    }
  }, [props.projectId, props.workspace.drafts, props.workspace.artifacts]);
  useEffect(() => () => {
    Object.values(controllers.current).forEach((controller) => controller?.abort());
    refinement.current?.controller.abort(); refinement.current = null;
  }, []);
  useEffect(() => { if (!modelOpen) cancelRefinement(); }, [modelOpen]);
  useEffect(() => {
    if (!inspectedArtifactId) return;
    controllers.current.model?.abort(); delete controllers.current.model;
    setBusy(state => ({ ...state, model: false })); cancelRefinement();
  }, [inspectedArtifactId]);

  useEffect(() => {
    const external = props.externalSearch;
    if (!external || external.projectId !== props.projectId || external.id === externalId.current) return;
    externalId.current = external.id;
    controllers.current.search?.abort(); delete controllers.current.search;
    setBusy((state) => ({ ...state, search: false })); setErrors((state) => ({ ...state, search: '' }));
    updateDraft('search', external.input); setResultsInput(external.input); setResults(external.results); setSearchIntent(external.intent ?? null); setSearchReview(external.review ?? null);
    if (!session) { const tools = useVisualPopupStore.getState(); if (!tools.searchMinimized) tools.open('search'); }
    setCompleted(state => ({ ...state, search: true }));
  }, [props.externalSearch, props.projectId]);

  function updateDraft(kind: VisualPopupKind, input: VisualPromptInput) {
    try {
      if (input.text.length > 12000 || input.mentions.length > 20 || input.attachments.length > 8) throw new Error('visualInputLimit');
      if (kind === 'model' && refinement.current && refinement.current.signature !== JSON.stringify(input)) cancelRefinement();
      latest.current.onDraft(kind, input);
      draftRef.current = { ...draftRef.current, [kind]: input }; setDrafts(draftRef.current);
      return true;
    } catch (reason) { setErrors((state) => ({ ...state, [kind]: visualError(reason, s) })); return false; }
  }
  useEffect(() => {
    if (!modelBase || modelBase.kind !== 'image') return;
    const input = draftRef.current.model;
    if (!input.mentions.some((target) => target.id === modelBase.id && target.kind === 'image')) updateDraft('model', { ...input, mentions: [...input.mentions, modelBase] });
    useVisualPopupStore.setState({ modelBase: null });
  }, [modelBase]);

  function cancelRefinement() {
    if (!refinement.current) return;
    refinement.current.controller.abort(); refinement.current = null;
    setRefining(false); setModelActivity({ state: 'idle', label: '' });
  }
  async function refine() {
    const input = draftRef.current.model;
    const onRefine = latest.current.onRefine;
    if (!onRefine || !input.text.trim() || busy.model || refinement.current || modelActivity.state === 'running') return;
    const operation = { controller: new AbortController(), signature: JSON.stringify(input) };
    refinement.current = operation;
    const projectId = project.current;
    const current = () => refinement.current === operation && !operation.controller.signal.aborted
      && project.current === projectId && latest.current.projectId === projectId
      && JSON.stringify(draftRef.current.model) === operation.signature;
    setRefining(true); setErrors(state => ({ ...state, model: '' }));
    setModelActivity({ state: 'running', label: s.refining });
    try {
      const result = await onRefine(input, { kind: 'existing', feedback: '', mode: 'inline' }, operation.controller.signal);
      if (!current()) return;
      if (latest.current.isRefinementCurrent && !latest.current.isRefinementCurrent(input, result)) throw new Error('refinementOutdated');
      if (!result.suggestedPrompt?.trim() || result.suggestedPrompt.length > 12000) throw new Error('refinementInvalid');
      refinement.current = null; setRefining(false);
      const applied = updateDraft('model', { ...input, text: result.suggestedPrompt });
      setModelActivity({ state: applied ? 'ready' : 'error', label: '' });
    } catch (reason) {
      if (current()) {
        setErrors(state => ({ ...state, model: visualError(reason, s) }));
        setModelActivity({ state: 'error', label: '' });
      }
    } finally {
      if (refinement.current === operation) { refinement.current = null; setRefining(false); }
    }
  }
  function cancel(kind: VisualPopupKind) {
    if (kind === 'model') cancelRefinement();
    controllers.current[kind]?.abort(); delete controllers.current[kind]; setBusy((state) => ({ ...state, [kind]: false }));
  }
  function hide(kind: VisualPopupKind) {
    if (kind === 'model') cancelRefinement();
    if (session) { if (kind === session.kind) session.onClose(); return; }
    cancel(kind); close(kind);
  }
  function inspect(id: string) { if (session) session.onInspector(id); else useVisualPopupStore.getState().inspectArtifact(id); }
  async function submit(kind: VisualPopupKind) {
    if (kind === 'model' && refinement.current) return;
    const input = draftRef.current[kind];
    if (!input.text.trim() && !input.mentions.length && !input.attachments.length) return;
    controllers.current[kind]?.abort();
    const controller = new AbortController(); controllers.current[kind] = controller;
    const projectId = props.projectId;
    setBusy((state) => ({ ...state, [kind]: true })); setErrors((state) => ({ ...state, [kind]: '' }));
    session?.onActivity({ state: 'running', label: kind === 'search' ? s.searching : generatingLabel });
    setCompleted(state => ({ ...state, [kind]: false }));
    if (kind === 'search') { setSearchIntent(null); setSearchReview(null); }
    else { setProposalNotice(''); setGenerationProgress(''); }
    const current = () => !controller.signal.aborted && controllers.current[kind] === controller && project.current === projectId;
    try {
      if (kind === 'search') {
        const images = session ? await props.onSearch(input, controller.signal, details => {
          if (current()) { setSearchIntent(details.intent ?? null); setSearchReview(details.review ?? null); }
        }) : await props.onSearch(input, controller.signal);
        if (current()) { setResultsInput(input); setResults(images); }
      } else {
        const proposal = input.generationMode === 'advanced'
          ? await props.onGenerate(input, controller.signal, message => { if (current()) setGenerationProgress(message); })
          : await props.onGenerate(input, controller.signal);
        if (current()) { setGenerated(proposal); if (proposal) setOwnProposals(items => [...items.filter(item => item.id !== proposal.id), proposal].slice(-40)); if (proposal?.assembly && proposal.status === 'applied') inspect(`model-${proposal.id}`); }
      }
      if (current()) setCompleted(state => ({ ...state, [kind]: true }));
    } catch (reason) { if (current()) setErrors((state) => ({ ...state, [kind]: visualError(reason, s) })); }
    finally { if (current()) { delete controllers.current[kind]; setBusy((state) => ({ ...state, [kind]: false })); } }
  }
  async function add(reference: ImageReference) {
    const existing = latest.current.workspace.artifacts.find((artifact) => artifact.kind === 'image' && artifact.source?.id === reference.id && artifact.source.sourcePageUrl === reference.sourcePageUrl);
    return existing ?? await latest.current.onAdd(reference);
  }
  async function useBase(reference: ImageReference) {
    const projectId = project.current;
    const artifact = await add(reference);
    if (project.current !== projectId) return;
    const target = latest.current.listMentions('').find((item) => item.kind === 'image' && (artifact ? item.id === artifact.id : item.label === reference.title));
    if (target) useVisualPopupStore.getState().useAsBase(target);
    else { useVisualPopupStore.getState().open('model'); throw new Error(s.baseFailed); }
  }
  function apply(id: string) {
    try { props.onApply(id); setErrors((state) => ({ ...state, model: '' })); setProposalNotice(''); if (proposals.find(item => item.id === id)?.assembly) inspect(`model-${id}`); }
    catch (reason) { setErrors((state) => ({ ...state, model: visualError(reason, s) })); }
  }
  function reject(id: string) {
    try {
      props.onReject(id);
      setGenerated(current => current?.id === id ? null : current);
      setOwnProposals(items => items.filter(item => item.id !== id));
      setErrors(state => ({ ...state, model: '' }));
      setProposalNotice(s.proposalRejected);
    } catch (reason) { setErrors(state => ({ ...state, model: visualError(reason, s) })); }
  }
  function discuss() {
    const mentions = draftRef.current.model.mentions;
    if (!mentions.length || busy.model || !props.onDiscuss) return;
    try {
      props.onDiscuss(mentions.map((reference) => ({ ...reference })));
      hide('search');
      hide('model');
    } catch (reason) { setErrors((state) => ({ ...state, model: visualError(reason, s) })); }
  }
  function removeHistory(id: string) {
    try { props.onRemoveHistory?.(id); setRemovedHistory(ids => [...ids, id]); setGenerated(current => current?.id === id ? null : current); setOwnProposals(items => items.filter(item => item.id !== id)); }
    catch (reason) { setErrors(state => ({ ...state, model: visualError(reason, s) })); }
  }
  const proposals = [...props.workspace.proposals];
  if (session) for (const proposal of ownProposals) if (!proposals.some(item => item.id === proposal.id)) proposals.push(proposal);
  if (generated && !proposals.some((item) => item.id === generated.id)) proposals.push(generated);
  const currentProposals = proposals.filter((item) => item.projectId === props.projectId && item.status !== 'rejected' && !removedHistory.includes(item.id)
    && (!session || ownProposals.some(own => own.id === item.id) || item.id === generated?.id || session.historyProposalIds.includes(item.id))).slice(-6).reverse();
  const sessionKind = session?.kind ?? 'model';
  const running = busy[sessionKind] || sessionKind === 'model' && modelActivity.state === 'running';
  const activityState: VisualToolActivity['state'] = running ? 'running' : errors[sessionKind] || sessionKind === 'model' && modelActivity.state === 'error' ? 'error' : completed[sessionKind] || sessionKind === 'model' && (modelActivity.state === 'ready' || currentProposals.length > 0) ? 'ready' : 'idle';
  const activityLabel = running ? sessionKind === 'model' && modelActivity.state === 'running' ? modelActivity.label : sessionKind === 'search' ? s.searching : generationProgress || generatingLabel : '';
  useEffect(() => { latest.current.session?.onActivity({ state: activityState, label: activityLabel }); }, [activityState, activityLabel]);
  const popupProps = session ? { frame: session.frame, onFrameChange: session.onFrame, zIndex: 71 + session.order, onFocus: session.onFocus, tabs: session.tabs, windowId: session.windowId, tabId: session.id } : {};
  const composer = (kind: VisualPopupKind) => <PromptComposer audioScope={`visual:${props.projectId}:${session?.id ?? kind}:${kind}`} key={`${props.projectId}:${kind}`} kind={kind} value={drafts[kind]} onChange={(input) => updateDraft(kind, input)} listMentions={props.listMentions} onAttach={props.onAttach} busy={busy[kind]} canSubmit={kind === 'model' && refining ? false : undefined} onSubmit={() => void submit(kind)} onCancel={() => cancel(kind)} {...(kind === 'model' && isDiagram ? { inputLabel: s.diagramTitle, placeholder: s.diagramPlaceholder, submitLabel: s.diagramGenerate } : {})} />;
  const status = (kind: VisualPopupKind) => <>{removedImages[kind].length > 0 && <p className="visual-local-hint" role="status">{s.removedImageReferences} {removedImages[kind].map(image => image.label).join(', ')}.</p>}{busy[kind] && <div className="visual-progress" role="status"><span className="visual-spinner" aria-hidden="true" />{kind === 'search' ? s.searching : generationProgress || generatingLabel}</div>}{errors[kind] && <p className="visual-error" role="alert">{errors[kind]}</p>}</>;
  return <>
    {searchOpen && <FloatingPopup kind="search" {...popupProps} onClose={() => hide('search')} onMinimize={() => session ? session.onMinimize() : minimize('search')} minimized={searchMinimized}>
      {composer('search')}{status('search')}
      {searchIntent && <div className="visual-search-intent">
        <p role="status">{s.searchIntent}: <strong>{searchIntent.label}</strong></p>
        {searchIntent.uncertainty && <p className="visual-search-uncertainty">{searchIntent.uncertainty}</p>}
        <details><summary>{s.searchQuery}</summary>{imageSearchQueries(searchIntent).map(query => <p key={query}>{query}</p>)}</details>
      </div>}
      {searchReview && searchReview.status !== 'not-configured' && (searchReview.status !== 'ranked' || searchReview.assessed > 0) && <p className="visual-search-review" role="status">
        {searchReview.status === 'ranked' ? s.typeSafeRanked : s.typeSafeUnavailable}
        {searchReview.removed > 0 && <span> · {searchReview.removed} {searchReview.removed === 1 ? s.discardedReference : s.discardedReferences}</span>}
      </p>}
      {results?.length ? <ImageGallery key={props.projectId} references={results} projectId={props.projectId} onAdd={add} onBase={useBase} onCopyImage={props.onCopyImage} onAssess={props.onAssess ? (reference, signal) => props.onAssess!(reference, resultsInput, signal) : undefined} /> : !busy.search && <EmptyState kind="search" title={results ? s.noResults : s.emptyTitle} text={results ? '' : s.emptyText} />}
    </FloatingPopup>}
    {modelOpen && <FloatingPopup kind="model" {...popupProps} title={isDiagram ? s.diagramTitle : undefined} subtitle={isDiagram ? s.diagramSubtitle : undefined} onClose={() => hide('model')} onMinimize={() => session ? session.onMinimize() : minimize('model')} minimized={modelMinimized}>
      <div className="visual-mode"><label htmlFor={`visual-apply-mode${session ? `-${session.id}` : ''}`}>{s.mode}</label><select id={`visual-apply-mode${session ? `-${session.id}` : ''}`} value={props.workspace.mode} onChange={(e) => props.onMode(e.target.value as 'approval' | 'automatic')}><option value="approval">{s.review}</option><option value="automatic">{s.automatic}</option></select><p>{props.workspace.mode === 'approval' ? s.approvalHint : s.automaticHint}</p></div>
      {inspectedArtifactId ? <Suspense fallback={<span role="status" aria-busy="true">…</span>}><DecompositionPanel key={`${props.projectId}:${inspectedArtifactId}`} artifactId={inspectedArtifactId} onActivity={setModelActivity} /></Suspense> : <>
      <div className="visual-construction-mode"><span>{s.artifactType}</span><div className="visual-segmented" role="group" aria-label={s.artifactType}>{(['model', 'diagram'] as const).map(kind => <button key={kind} type="button" disabled={busy.model || modelActivity.state === 'running'} aria-pressed={(drafts.model.artifactKind ?? 'model') === kind} onClick={() => {
        const input = draftRef.current.model;
        const mentions = kind === 'diagram' && props.selectedNode && !input.mentions.some(item => item.kind === 'node' && item.id === props.selectedNode!.id) && input.mentions.length < 20 ? [...input.mentions, props.selectedNode] : input.mentions;
        updateDraft('model', { ...input, artifactKind: kind, generationMode: 'standard', mentions });
      }}>{kind === 'model' ? '3D' : s.diagramMode}</button>)}</div></div>
      {!isDiagram && <div className="visual-construction-mode"><span>{s.generationMode}</span><div className="visual-segmented" role="group" aria-label={s.generationMode}>{(['standard', 'advanced'] as const).map(mode => <button key={mode} type="button" disabled={busy.model || modelActivity.state === 'running'} aria-pressed={(drafts.model.generationMode ?? 'standard') === mode} onClick={() => {
        const input = draftRef.current.model;
        const mentions = mode === 'advanced' && props.selectedNode && !input.mentions.some(item => item.kind === 'node' || item.kind === 'image') && input.mentions.length < 20 ? [...input.mentions, props.selectedNode] : input.mentions;
        updateDraft('model', { ...input, generationMode: mode, mentions });
      }}>{mode === 'standard' ? s.standardMode : s.advancedMode}</button>)}</div>{drafts.model.generationMode === 'advanced' && <p>{s.advancedHint}</p>}</div>}
      {composer('model')}
      {!isDiagram && props.onRefine && <button type="button" className="visual-refinement-trigger" aria-label={s.refineWithAI} aria-busy={refining} disabled={busy.model || refining || !drafts.model.text.trim()} onClick={() => void refine()}><span aria-hidden="true" className={refining ? 'visual-spinner' : undefined}>{refining ? '' : '✧'}</span>{s.refineWithAI}<span aria-hidden="true">↗</span></button>}
      {status('model')}
      {props.onDiscuss && <div className="visual-chat-handoff"><button type="button" className="visual-button" disabled={!drafts.model.mentions.length || busy.model} onClick={discuss}>{s.discussReferences}</button><p>{s.discussReferencesHint}</p></div>}
      {proposalNotice && <p className="visual-local-hint" role="status">{proposalNotice}</p>}
      {currentProposals.length > 0 ? <div className="visual-proposals"><h3>{s.proposals}</h3>{currentProposals.map((proposal) => <article className="visual-proposal" key={proposal.id}>
        <div className="visual-proposal-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2"><path d="m12 2 9 5v10l-9 5-9-5V7zM3 7l9 5 9-5M12 12v10"/></svg></div>
        <div className="visual-proposal-text"><strong>{proposal.label}</strong><small>{proposal.kind === 'diagram' ? `${proposal.diagram.elements.length} ${s.diagramElements}` : `${proposal.scene.objects.length} ${s.objects}`}{proposal.assembly ? ` · ${proposal.assembly.groups.length} ${s.modules}` : ''}</small>{proposal.assembly && <><span className="visual-modular-ready">{s.modularReady}</span><AssemblyPlanSummary assembly={proposal.assembly} /></>}{proposal.status === 'stale' && <span className="visual-stale">{s.stale}</span>}</div>
        <div className="visual-proposal-actions">
          {proposal.status === 'ready' && <button type="button" className="visual-button visual-apply" onClick={() => apply(proposal.id)}>{s.apply}</button>}
          {proposal.status === 'ready' || proposal.status === 'stale' ? <button type="button" className="visual-button visual-reject" aria-label={`${s.rejectProposal}: ${proposal.label}`} onClick={() => reject(proposal.id)}>{s.reject}</button> : proposal.status === 'applied' ? <span className="visual-applied">✓ {s.applied}</span> : null}
          {proposal.status === 'applied' && props.onRemoveHistory && <button type="button" className="visual-button visual-proposal-history-remove" onClick={() => removeHistory(proposal.id)} aria-label={`${s.generate === 'Generate model' ? 'Remove from history' : 'Remover do histórico'}: ${proposal.label}`}>{s.generate === 'Generate model' ? 'Remove from history' : 'Remover do histórico'}</button>}
        </div>
      </article>)}</div> : !busy.model && <EmptyState kind="model" title={isDiagram ? s.diagramEmpty : s.modelEmptyTitle} text={isDiagram ? s.diagramEmptyHint : s.modelEmptyText} />}
      <p className="visual-model-note">{isDiagram ? s.diagramNote : drafts.model.analyzeImages ? s.modelVisionHint : s.modelReferenceHint}</p>
      </>}
    </FloatingPopup>}
    {!session && (searchOpen && searchMinimized || modelOpen && modelMinimized) && <div className="visual-minimized-tools nodrag nopan nowheel" data-visual-minimized role="group" aria-label={s.backgroundTools}>
      {(['search', 'model'] as const).filter(kind => kind === 'search' ? searchOpen && searchMinimized : modelOpen && modelMinimized).map(kind => {
        const running = busy[kind] || kind === 'model' && modelActivity.state === 'running';
        const error = !!errors[kind] || kind === 'model' && modelActivity.state === 'error';
        const ready = completed[kind] || kind === 'model' && modelActivity.state === 'ready';
        const progress = kind === 'model' && modelActivity.state === 'running' ? modelActivity.label : kind === 'search' ? s.searching : generationProgress || generatingLabel;
        return <button key={kind} type="button" className="visual-minimized-tool liquid-glass" onClick={() => restore(kind)}
        aria-label={kind === 'search' ? s.restoreSearch : s.restoreModel}>
        <span className={`visual-minimized-indicator${running ? ' visual-spinner' : error ? ' is-error' : ready ? ' is-ready' : ''}`} aria-hidden="true">{running ? '' : error ? '!' : ready ? '✓' : kind === 'search' ? '▧' : '◇'}</span>
        <span><strong>{kind === 'search' ? s.imageTitle : isDiagram ? s.diagramTitle : s.modelTitle}</strong><small role="status">{running ? progress : error ? s.backgroundError : ready ? s.backgroundReady : s.backgroundResume}</small></span>
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true"><path d="M4 10V4h6M4 4l8 8" /></svg>
      </button>; })}
    </div>}
  </>;
}

export default VisualExplorer;
