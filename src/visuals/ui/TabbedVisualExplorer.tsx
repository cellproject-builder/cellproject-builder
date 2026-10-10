import { useEffect, useRef } from 'react';
import { useLocaleStore } from '@/i18n';
import { VisualExplorer, type VisualExplorerProps } from './VisualExplorer';
import { PopupTabs } from './PopupTabs';
import { useVisualSessionStore, type VisualTab } from './sessionStore';
import { useVisualPopupStore } from './uiStore';
import { useVisualStrings } from './strings';
import { useVisualGenerationStore, useVisualSearchStore, type VisualSearchResult } from '../controller';

let mountedCanvas: { owner: symbol } | null = null;

/** Sessions are keyed in one flat list. Moving a tab changes only its frame:
 * React never reparents its composer/refiner or restarts a provider request. */
export function TabbedVisualExplorer(props: VisualExplorerProps) {
  const sessions = useVisualSessionStore();
  const s = useVisualStrings();
  const en = useLocaleStore(state => state.locale) === 'en';
  const latest = useRef(props); latest.current = props;
  const history = useRef(new Map<string, string[]>());
  const owner = useRef(Symbol('visual-canvas'));

  useEffect(() => {
    // StrictMode replays effects for the same owner. Delay disposal one microtask
    // so that replay retains tabs, while an actual replacement starts fresh.
    if (mountedCanvas && mountedCanvas.owner !== owner.current) useVisualSessionStore.getState().reset();
    const lease = { owner: owner.current }; mountedCanvas = lease;
    return () => queueMicrotask(() => {
      if (mountedCanvas !== lease) return;
      mountedCanvas = null;
      useVisualSessionStore.getState().reset();
    });
  }, []);

  useEffect(() => {
    const state = useVisualSessionStore.getState(), tools = useVisualPopupStore.getState();
    const changed = state.projectId !== props.projectId;
    const request = tools.request;
    const scoped = !request?.projectId || request.projectId === props.projectId;
    const pending = request && scoped && request.id > (state.deliveries[props.projectId]?.requestId ?? 0);
    // A pending handoff creates its own tab below; do not prepend a blank tab.
    const modelHandoff = pending && (request.action === 'base' || request.action === 'inspect');
    state.initialize(props.projectId, latest.current.workspace.drafts, [scoped && tools.searchOpen ? 'search' : '', scoped && tools.modelOpen && !modelHandoff ? 'model' : '']);
    if (changed) {
      history.current.clear();
      const initialized = useVisualSessionStore.getState();
      for (const tab of Object.values(initialized.tabs)) {
        history.current.set(tab.id, tab.kind === 'model' ? latest.current.workspace.proposals.map(p => p.id) : []);
        const window = initialized.windows.find(item => item.tabIds.includes(tab.id));
        if (window && (tab.kind === 'search' ? tools.searchMinimized : tools.modelMinimized)) initialized.minimizeWindow(window.id);
      }
    }
  }, [props.projectId]);
  useEffect(() => {
    function handleRequest() {
      const request = useVisualPopupStore.getState().request;
      const state = useVisualSessionStore.getState();
      if (!request || state.projectId !== props.projectId || request.projectId && request.projectId !== props.projectId) return;
      if (!state.consumeRequest(props.projectId, request.id)) return;
      const windows = state.windows.filter(window => window.kind === request.kind).sort((a, b) => b.order - a.order);
      if (request.action === 'base' && request.modelBase) {
        // A reference handoff starts a new request instead of editing a running tab.
        const input = { text: '', mentions: [{ ...request.modelBase }], attachments: [] };
        state.newTab('model', { input });
        latest.current.onDraft('model', input);
        useVisualPopupStore.setState({ modelBase: null });
      } else if (request.action === 'inspect' && request.inspectedArtifactId) {
        const tab = Object.values(state.tabs).find(tab => tab.inspectedArtifactId === request.inspectedArtifactId);
        if (tab) state.activate(tab.id);
        else state.newTab('model', { inspectedArtifactId: request.inspectedArtifactId });
      } else if (request.action === 'close' || request.action === 'minimize') {
        for (const window of windows) request.action === 'close' ? state.hideWindow(window.id) : state.minimizeWindow(window.id);
      } else if (windows.length) {
        const window = windows[0];
        const active = state.tabs[window.activeTabId];
        if (request.action === 'open' && active?.inspectedArtifactId && !window.minimized) {
          const draft = window.tabIds.map(id => state.tabs[id]).reverse().find(tab => !tab.inspectedArtifactId);
          if (draft) state.activate(draft.id); else state.newTab(request.kind, { windowId: window.id });
        } else state.restoreWindow(window.id);
      } else {
        const id = state.newTab(request.kind, { input: latest.current.workspace.drafts[request.kind] });
        history.current.set(id, request.kind === 'model' ? latest.current.workspace.proposals.map(p => p.id) : []);
      }
    }
    // Commands may arrive together (for example close one tool, open another).
    // Subscribe to each command rather than losing all but the last to batching.
    const unsubscribe = useVisualPopupStore.subscribe(handleRequest);
    handleRequest();
    return unsubscribe;
  }, [props.projectId]);

  const receiveSearch = (result: VisualSearchResult | null | undefined) => {
    if (!result || result.projectId !== props.projectId) return;
    const state = useVisualSessionStore.getState();
    if (state.projectId !== props.projectId || !state.consumePublication(props.projectId, 'search', result.id)) return;
    const window = state.windows.filter(w => w.kind === 'search').sort((a, b) => b.order - a.order)[0];
    const keepMinimized = window?.minimized;
    const id = state.newTab('search', { windowId: window?.id, input: result.input, externalSearch: result });
    if (keepMinimized) {
      const owner = useVisualSessionStore.getState().windows.find(w => w.tabIds.includes(id));
      if (owner) state.minimizeWindow(owner.id);
    }
  };
  const searchReceiver = useRef(receiveSearch); searchReceiver.current = receiveSearch;
  useEffect(() => {
    // Consume each publication, including several results in one React batch.
    const receive = () => searchReceiver.current(useVisualSearchStore.getState().search);
    const unsubscribe = useVisualSearchStore.subscribe(receive);
    receive();
    return unsubscribe;
  }, [props.projectId]);
  useEffect(() => { searchReceiver.current(props.externalSearch); }, [props.externalSearch, props.projectId]);

  useEffect(() => {
    function receiveGeneration() {
      const generation = useVisualGenerationStore.getState().generation;
      if (!generation || generation.proposal.projectId !== props.projectId) return;
      const state = useVisualSessionStore.getState();
      if (state.projectId !== props.projectId || !state.consumePublication(props.projectId, 'model', generation.id)) return;
      const window = state.windows.filter(w => w.kind === 'model').sort((a, b) => b.order - a.order)[0];
      const keepMinimized = window?.minimized;
      const id = state.newTab('model', { windowId: window?.id, input: generation.proposal.input });
      history.current.set(id, [generation.proposal.id]);
      if (keepMinimized) {
        const owner = useVisualSessionStore.getState().windows.find(w => w.tabIds.includes(id));
        if (owner) state.minimizeWindow(owner.id);
      }
    }
    const unsubscribe = useVisualGenerationStore.subscribe(receiveGeneration);
    receiveGeneration();
    return unsubscribe;
  }, [props.projectId]);

  useEffect(() => {
    if (sessions.projectId !== props.projectId) return;
    const search = sessions.windows.filter(w => w.kind === 'search' && !w.hidden);
    const model = sessions.windows.filter(w => w.kind === 'model' && !w.hidden);
    useVisualPopupStore.setState({
      searchOpen: search.length > 0, modelOpen: model.length > 0,
      searchMinimized: search.length > 0 && search.every(w => w.minimized),
      modelMinimized: model.length > 0 && model.every(w => w.minimized),
    });
  }, [sessions.windows, sessions.projectId, props.projectId]);

  if (sessions.projectId !== props.projectId) return null;
  const ordered = [...sessions.windows].sort((a, b) => a.order - b.order);
  const title = (tab: VisualTab) => tab.inspectedArtifactId
    ? props.workspace.artifacts.find(a => a.id === tab.inspectedArtifactId)?.label ?? (en ? 'Components' : 'Componentes')
    : tab.draft.text.trim().replace(/\s+/g, ' ').slice(0, 48) || tab.draft.mentions[0]?.label || (tab.kind === 'search' ? en ? 'New search' : 'Nova busca' : tab.draft.artifactKind === 'diagram' ? en ? 'New diagram' : 'Novo diagrama' : en ? 'New model' : 'Novo modelo');
  return <>
    {Object.values(sessions.tabs).map(tab => {
      const window = sessions.windows.find(w => w.tabIds.includes(tab.id));
      if (!window) return null;
      const active = window.activeTabId === tab.id;
      const workspace = { ...props.workspace, drafts: { ...props.workspace.drafts, [tab.kind]: tab.draft } };
      return <VisualExplorer key={`${props.projectId}:${tab.id}`} {...props} workspace={workspace} externalSearch={tab.externalSearch}
        onDraft={(kind, input) => {
          if (kind === tab.kind) sessions.updateDraft(tab.id, input);
          props.onDraft(kind, input);
        }}
        session={{ id: tab.id, kind: tab.kind, windowId: window.id,
          minimized: !active || window.minimized || window.hidden, frame: window.frame, order: ordered.indexOf(window),
          inspectedArtifactId: tab.inspectedArtifactId, historyProposalIds: history.current.get(tab.id) ?? [],
          onClose: () => sessions.hideWindow(window.id), onMinimize: () => sessions.minimizeWindow(window.id),
          onFocus: () => sessions.focusWindow(window.id), onFrame: frame => sessions.setFrame(window.id, frame),
          onInspector: id => sessions.setInspector(tab.id, id), onActivity: activity => sessions.setActivity(tab.id, activity),
          onFindReferences: input => { sessions.newTab('search', { input }); },
          tabs: active ? <PopupTabs windowId={window.id} tabs={window.tabIds.map(id => ({ ...sessions.tabs[id], label: title(sessions.tabs[id]), artifactKind: sessions.tabs[id].draft.artifactKind }))}
            activeTabId={window.activeTabId} onSelect={sessions.activate} onNew={() => { sessions.newTab(tab.kind, { windowId: window.id }); }}
            onClose={sessions.closeTab} onDetach={sessions.detach} onMove={sessions.move} /> : undefined,
        }} />;
    })}
    {sessions.windows.some(w => w.minimized && !w.hidden) && <div className="visual-minimized-tools nodrag nopan nowheel" data-visual-minimized role="group" aria-label={s.backgroundTools}>
      {sessions.windows.filter(w => w.minimized && !w.hidden).map(window => {
        const tabs = window.tabIds.map(id => sessions.tabs[id]);
        const running = tabs.find(tab => tab.activity.state === 'running');
        const failed = tabs.some(tab => tab.activity.state === 'error');
        const ready = tabs.filter(tab => tab.activity.state === 'ready').length;
        const label = running?.activity.label || (failed ? s.backgroundError : ready ? `${s.backgroundReady}${ready > 1 ? ` · ${ready}` : ''}` : s.backgroundResume);
        return <button key={window.id} type="button" className="visual-minimized-tool liquid-glass" aria-label={window.kind === 'search' ? s.restoreSearch : s.restoreModel} onClick={() => sessions.restoreWindow(window.id)}>
          <span className={`visual-minimized-indicator${running ? ' visual-spinner' : failed ? ' is-error' : ready ? ' is-ready' : ''}`} aria-hidden="true">{running ? '' : failed ? '!' : ready ? '✓' : '◇'}</span>
          <span><strong>{window.kind === 'search' ? s.imageTitle : s.modelTitle}{tabs.length > 1 ? ` · ${tabs.length}` : ''}</strong><small role="status">{label}</small></span>
          <span aria-hidden="true">↗</span>
        </button>;
      })}
    </div>}
  </>;
}
