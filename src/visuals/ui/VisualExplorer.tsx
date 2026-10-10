import { useEffect, useRef, useState } from 'react';
import type { ImageReference, MentionTarget, VisualArtifact, VisualAttachment, VisualPromptInput, VisualProposal, VisualSearchReview, VisualWorkspace } from '../types';
import { imageSearchQueries, type ImageSearchIntent } from '../searchIntent';
import { reconcileVisualImageReferences } from '../promptReferences';
import type { ModelRefinement, ModelRefinementRequest } from '../refinement';
import { FloatingPopup } from './FloatingPopup';
import { ImageGallery } from './ImageGallery';
import { PromptComposer } from './PromptComposer';
import { ModelPromptRefiner } from './ModelPromptRefiner';
import { DecompositionPanel } from './DecompositionPanel';
import { AssemblyPlanSummary } from './ModelAssemblyInspector';
import { useVisualStrings, visualError } from './strings';
import { useVisualPopupStore, type VisualPopupKind, type VisualToolActivity } from './uiStore';
import './visuals.css';

export interface VisualExplorerProps {
  workspace: VisualWorkspace;
  projectId: string;
  listMentions: (query: string) => MentionTarget[];
  selectedNode?: MentionTarget;
  onDraft: (kind: 'search' | 'model', input: VisualPromptInput) => void;
  onAttach: (file: File, signal?: AbortSignal) => Promise<VisualAttachment>;
  onSearch: (input: VisualPromptInput, signal: AbortSignal) => Promise<ImageReference[]>;
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
}

function EmptyState({ kind, title, text }: { kind: VisualPopupKind; title: string; text: string }) {
  return <div className={`visual-empty visual-empty-${kind}`}><div className="visual-empty-art" aria-hidden="true">{kind === 'search' ? <><span /><span /><span /></> : <svg viewBox="0 0 100 100" fill="none"><path d="m50 12 33 19v38L50 88 17 69V31zM17 31l33 19 33-19M50 50v38" stroke="currentColor" strokeWidth="1.5"/><path d="M50 12v38L17 69m33-19 33 19" stroke="currentColor" strokeWidth=".7" strokeDasharray="3 4"/></svg>}</div><h3>{title}</h3><p>{text}</p></div>;
}

export function VisualExplorer(props: VisualExplorerProps) {
  const s = useVisualStrings();
  const { searchOpen, modelOpen, searchMinimized, modelMinimized, modelBase, inspectedArtifactId, close, minimize, restore } = useVisualPopupStore();
  const [drafts, setDrafts] = useState(props.workspace.drafts);
  const draftRef = useRef(drafts);
  const latest = useRef(props); latest.current = props;
  const project = useRef(props.projectId);
  const controllers = useRef<Partial<Record<VisualPopupKind, AbortController>>>({});
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
  const [proposalNotice, setProposalNotice] = useState('');
  const [refineOpen, setRefineOpen] = useState(false);
  const [refinedReady, setRefinedReady] = useState(false);
  const [removedHistory, setRemovedHistory] = useState<string[]>([]);
  const externalId = useRef<string | null>(null);

  useEffect(() => {
    const previousProject = project.current;
    if (previousProject !== props.projectId) {
      Object.values(controllers.current).forEach((controller) => controller?.abort()); controllers.current = {};
      project.current = props.projectId;
      setBusy({ search: false, model: false }); setErrors({ search: '', model: '' }); setResults(null); setSearchIntent(null); setSearchReview(null); setGenerated(null);
      setCompleted({ search: false, model: false });
      setModelActivity({ state: 'idle', label: '' });
      setRefineOpen(false); setRefinedReady(false);
      setProposalNotice('');
      setRemovedHistory([]);
      setRemovedImages({ search: [], model: [] });
      useVisualPopupStore.setState({ modelBase: null, inspectedArtifactId: null, searchMinimized: false, modelMinimized: false });
    }
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
  useEffect(() => () => Object.values(controllers.current).forEach((controller) => controller?.abort()), []);
  useEffect(() => {
    if (!inspectedArtifactId) return;
    controllers.current.model?.abort(); delete controllers.current.model;
    setBusy(state => ({ ...state, model: false })); setRefineOpen(false);
  }, [inspectedArtifactId]);

  useEffect(() => {
    const external = props.externalSearch;
    if (!external || external.projectId !== props.projectId || external.id === externalId.current) return;
    externalId.current = external.id;
    controllers.current.search?.abort(); delete controllers.current.search;
    setBusy((state) => ({ ...state, search: false })); setErrors((state) => ({ ...state, search: '' }));
    updateDraft('search', external.input); setResultsInput(external.input); setResults(external.results); setSearchIntent(external.intent ?? null); setSearchReview(external.review ?? null);
    const tools = useVisualPopupStore.getState(); if (!tools.searchMinimized) tools.open('search');
    setCompleted(state => ({ ...state, search: true }));
  }, [props.externalSearch, props.projectId]);

  function updateDraft(kind: VisualPopupKind, input: VisualPromptInput) {
    try {
      if (input.text.length > 12000 || input.mentions.length > 20 || input.attachments.length > 8) throw new Error('visualInputLimit');
      latest.current.onDraft(kind, input);
      if (kind === 'model') setRefinedReady(false);
      draftRef.current = { ...draftRef.current, [kind]: input }; setDrafts(draftRef.current);
    } catch (reason) { setErrors((state) => ({ ...state, [kind]: visualError(reason, s) })); }
  }
  useEffect(() => {
    if (!modelBase || modelBase.kind !== 'image') return;
    const input = draftRef.current.model;
    if (!input.mentions.some((target) => target.id === modelBase.id && target.kind === 'image')) updateDraft('model', { ...input, mentions: [...input.mentions, modelBase] });
    useVisualPopupStore.setState({ modelBase: null });
  }, [modelBase]);

  function cancel(kind: VisualPopupKind) {
    controllers.current[kind]?.abort(); delete controllers.current[kind]; setBusy((state) => ({ ...state, [kind]: false }));
  }
  function hide(kind: VisualPopupKind) { cancel(kind); if (kind === 'model') setRefineOpen(false); close(kind); }
  async function submit(kind: VisualPopupKind) {
    const input = draftRef.current[kind];
    if (!input.text.trim() && !input.mentions.length && !input.attachments.length) return;
    controllers.current[kind]?.abort();
    const controller = new AbortController(); controllers.current[kind] = controller;
    const projectId = props.projectId;
    setBusy((state) => ({ ...state, [kind]: true })); setErrors((state) => ({ ...state, [kind]: '' }));
    setCompleted(state => ({ ...state, [kind]: false }));
    if (kind === 'search') { setSearchIntent(null); setSearchReview(null); }
    else { setProposalNotice(''); setGenerationProgress(''); }
    const current = () => !controller.signal.aborted && controllers.current[kind] === controller && project.current === projectId;
    try {
      if (kind === 'search') {
        const images = await props.onSearch(input, controller.signal); if (current()) { setResultsInput(input); setResults(images); }
      } else {
        const proposal = input.generationMode === 'advanced'
          ? await props.onGenerate(input, controller.signal, message => { if (current()) setGenerationProgress(message); })
          : await props.onGenerate(input, controller.signal);
        if (current()) { setGenerated(proposal); if (proposal?.assembly && proposal.status === 'applied') useVisualPopupStore.getState().inspectArtifact(`model-${proposal.id}`); }
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
    try { props.onApply(id); setErrors((state) => ({ ...state, model: '' })); setProposalNotice(''); if (proposals.find(item => item.id === id)?.assembly) useVisualPopupStore.getState().inspectArtifact(`model-${id}`); }
    catch (reason) { setErrors((state) => ({ ...state, model: visualError(reason, s) })); }
  }
  function reject(id: string) {
    try {
      props.onReject(id);
      setGenerated(current => current?.id === id ? null : current);
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
    try { props.onRemoveHistory?.(id); setRemovedHistory(ids => [...ids, id]); setGenerated(current => current?.id === id ? null : current); }
    catch (reason) { setErrors(state => ({ ...state, model: visualError(reason, s) })); }
  }
  const proposals = [...props.workspace.proposals];
  if (generated && !proposals.some((item) => item.id === generated.id)) proposals.push(generated);
  const currentProposals = proposals.filter((item) => item.projectId === props.projectId && item.status !== 'rejected' && !removedHistory.includes(item.id)).slice(-6).reverse();
  const composer = (kind: VisualPopupKind) => <PromptComposer key={`${props.projectId}:${kind}`} kind={kind} value={drafts[kind]} onChange={(input) => updateDraft(kind, input)} listMentions={props.listMentions} onAttach={props.onAttach} busy={busy[kind]} onSubmit={() => void submit(kind)} onCancel={() => cancel(kind)} />;
  const status = (kind: VisualPopupKind) => <>{removedImages[kind].length > 0 && <p className="visual-local-hint" role="status">{s.removedImageReferences} {removedImages[kind].map(image => image.label).join(', ')}.</p>}{busy[kind] && <div className="visual-progress" role="status"><span className="visual-spinner" aria-hidden="true" />{kind === 'search' ? s.searching : generationProgress || s.generating}</div>}{errors[kind] && <p className="visual-error" role="alert">{errors[kind]}</p>}</>;
  return <>
    {searchOpen && <FloatingPopup kind="search" onClose={() => hide('search')} onMinimize={() => minimize('search')} minimized={searchMinimized}>
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
    {modelOpen && <FloatingPopup kind="model" onClose={() => hide('model')} onMinimize={() => minimize('model')} minimized={modelMinimized}>
      <div className="visual-mode"><label htmlFor="visual-apply-mode">{s.mode}</label><select id="visual-apply-mode" value={props.workspace.mode} onChange={(e) => props.onMode(e.target.value as 'approval' | 'automatic')}><option value="approval">{s.review}</option><option value="automatic">{s.automatic}</option></select><p>{props.workspace.mode === 'approval' ? s.approvalHint : s.automaticHint}</p></div>
      {inspectedArtifactId ? <DecompositionPanel key={`${props.projectId}:${inspectedArtifactId}`} artifactId={inspectedArtifactId} onActivity={setModelActivity} /> : <>
      <div className="visual-construction-mode"><span>{s.generationMode}</span><div className="visual-segmented" role="group" aria-label={s.generationMode}>{(['standard', 'advanced'] as const).map(mode => <button key={mode} type="button" disabled={busy.model || modelActivity.state === 'running'} aria-pressed={(drafts.model.generationMode ?? 'standard') === mode} onClick={() => {
        const input = draftRef.current.model;
        const mentions = mode === 'advanced' && props.selectedNode && !input.mentions.some(item => item.kind === 'node' || item.kind === 'image') && input.mentions.length < 20 ? [...input.mentions, props.selectedNode] : input.mentions;
        updateDraft('model', { ...input, generationMode: mode, mentions });
      }}>{mode === 'standard' ? s.standardMode : s.advancedMode}</button>)}</div>{drafts.model.generationMode === 'advanced' && <p>{s.advancedHint}</p>}</div>
      {refineOpen && props.onRefine ? <ModelPromptRefiner key={props.projectId} input={drafts.model} workspace={props.workspace} listMentions={props.listMentions} onAttach={props.onAttach} onMedia={props.onMedia} onActivity={setModelActivity}
        onChange={input => updateDraft('model', input)} onRefine={props.onRefine} isCurrent={props.isRefinementCurrent}
        onUse={input => { updateDraft('model', input); setRefineOpen(false); setRefinedReady(false); void submit('model'); }}
        onFindReferences={input => { updateDraft('search', input); useVisualPopupStore.getState().open('search'); }}
        onClose={() => setRefineOpen(false)} /> : <>
        {composer('model')}
        {props.onRefine && <button type="button" className="visual-refinement-trigger" aria-label={s.refineWithAI} disabled={busy.model} onClick={() => { setRefineOpen(true); setRefinedReady(false); }}><span aria-hidden="true">✧</span>{s.refineWithAI}<span aria-hidden="true">↗</span></button>}
        {refinedReady && <p className="visual-refinement-ready" role="status">{s.refinedReady}</p>}
      </>}{status('model')}
      {props.onDiscuss && <div className="visual-chat-handoff"><button type="button" className="visual-button" disabled={!drafts.model.mentions.length || busy.model} onClick={discuss}>{s.discussReferences}</button><p>{s.discussReferencesHint}</p></div>}
      {proposalNotice && <p className="visual-local-hint" role="status">{proposalNotice}</p>}
      {currentProposals.length > 0 ? <div className="visual-proposals"><h3>{s.proposals}</h3>{currentProposals.map((proposal) => <article className="visual-proposal" key={proposal.id}>
        <div className="visual-proposal-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2"><path d="m12 2 9 5v10l-9 5-9-5V7zM3 7l9 5 9-5M12 12v10"/></svg></div>
        <div className="visual-proposal-text"><strong>{proposal.label}</strong><small>{proposal.scene.objects.length} {s.objects}{proposal.assembly ? ` · ${proposal.assembly.groups.length} ${s.modules}` : ''}</small>{proposal.assembly && <><span className="visual-modular-ready">{s.modularReady}</span><AssemblyPlanSummary assembly={proposal.assembly} /></>}{proposal.status === 'stale' && <span className="visual-stale">{s.stale}</span>}</div>
        <div className="visual-proposal-actions">
          {proposal.status === 'ready' && <button type="button" className="visual-button visual-apply" onClick={() => apply(proposal.id)}>{s.apply}</button>}
          {proposal.status === 'ready' || proposal.status === 'stale' ? <button type="button" className="visual-button visual-reject" aria-label={`${s.rejectProposal}: ${proposal.label}`} onClick={() => reject(proposal.id)}>{s.reject}</button> : proposal.status === 'applied' ? <span className="visual-applied">✓ {s.applied}</span> : null}
          {proposal.status === 'applied' && props.onRemoveHistory && <button type="button" className="visual-button visual-proposal-history-remove" onClick={() => removeHistory(proposal.id)} aria-label={`${s.generate === 'Generate model' ? 'Remove from history' : 'Remover do histórico'}: ${proposal.label}`}>{s.generate === 'Generate model' ? 'Remove from history' : 'Remover do histórico'}</button>}
        </div>
      </article>)}</div> : !busy.model && <EmptyState kind="model" title={s.modelEmptyTitle} text={s.modelEmptyText} />}
      <p className="visual-model-note">{drafts.model.analyzeImages ? s.modelVisionHint : s.modelReferenceHint}</p>
      </>}
    </FloatingPopup>}
    {(searchOpen && searchMinimized || modelOpen && modelMinimized) && <div className="visual-minimized-tools nodrag nopan nowheel" data-visual-minimized role="group" aria-label={s.backgroundTools}>
      {(['search', 'model'] as const).filter(kind => kind === 'search' ? searchOpen && searchMinimized : modelOpen && modelMinimized).map(kind => {
        const running = busy[kind] || kind === 'model' && modelActivity.state === 'running';
        const error = !!errors[kind] || kind === 'model' && modelActivity.state === 'error';
        const ready = completed[kind] || kind === 'model' && modelActivity.state === 'ready';
        const progress = kind === 'model' && modelActivity.state === 'running' ? modelActivity.label : kind === 'search' ? s.searching : generationProgress || s.generating;
        return <button key={kind} type="button" className="visual-minimized-tool liquid-glass" onClick={() => restore(kind)}
        aria-label={kind === 'search' ? s.restoreSearch : s.restoreModel}>
        <span className={`visual-minimized-indicator${running ? ' visual-spinner' : error ? ' is-error' : ready ? ' is-ready' : ''}`} aria-hidden="true">{running ? '' : error ? '!' : ready ? '✓' : kind === 'search' ? '▧' : '◇'}</span>
        <span><strong>{kind === 'search' ? s.imageTitle : s.modelTitle}</strong><small role="status">{running ? progress : error ? s.backgroundError : ready ? s.backgroundReady : s.backgroundResume}</small></span>
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true"><path d="M4 10V4h6M4 4l8 8" /></svg>
      </button>; })}
    </div>}
  </>;
}

export default VisualExplorer;
