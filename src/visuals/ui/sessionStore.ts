import { create } from 'zustand';
import { nanoid } from 'nanoid';
import type { VisualPromptInput } from '../types';
import type { VisualSearchResult } from '../controller';
import type { VisualPopupKind, VisualToolActivity } from './uiStore';

export interface VisualTab {
  id: string;
  kind: VisualPopupKind;
  draft: VisualPromptInput;
  activity: VisualToolActivity;
  inspectedArtifactId?: string | null;
  externalSearch?: VisualSearchResult | null;
}
export interface VisualWindow {
  id: string;
  kind: VisualPopupKind;
  tabIds: string[];
  activeTabId: string;
  minimized: boolean;
  hidden: boolean;
  frame?: { x: number; y: number; width: number; height: number };
  order: number;
}
interface NewTabOptions {
  windowId?: string;
  input?: VisualPromptInput;
  inspectedArtifactId?: string;
  externalSearch?: VisualSearchResult;
}
interface VisualDeliveries {
  requestId: number;
  search: string[];
  model: string[];
}
export interface VisualSessionState {
  projectId: string | null;
  tabs: Record<string, VisualTab>;
  windows: VisualWindow[];
  /** Delivery receipts survive layout resets when the canvas unmounts. */
  deliveries: Record<string, VisualDeliveries>;
  consumeRequest: (projectId: string, id: number) => boolean;
  consumePublication: (projectId: string, kind: VisualPopupKind, id: string) => boolean;
  initialize: (projectId: string | null, drafts: Record<VisualPopupKind, VisualPromptInput>, openKinds: string[]) => void;
  newTab: (kind: VisualPopupKind, options?: NewTabOptions) => string;
  activate: (tabId: string) => void;
  updateDraft: (tabId: string, input: VisualPromptInput) => void;
  setActivity: (tabId: string, activity: VisualToolActivity) => void;
  setInspector: (tabId: string, id: string | null) => void;
  detach: (tabId: string, point?: { x: number; y: number }) => void;
  move: (tabId: string, targetWindowId: string, beforeTabId?: string) => void;
  closeTab: (tabId: string) => void;
  minimizeWindow: (id: string) => void;
  restoreWindow: (id: string) => void;
  hideWindow: (id: string) => void;
  setFrame: (id: string, frame: NonNullable<VisualWindow['frame']>) => void;
  focusWindow: (id: string) => void;
  reset: () => void;
}

const blank = (): VisualPromptInput => ({ text: '', mentions: [], attachments: [] });
const copyDraft = (input: VisualPromptInput): VisualPromptInput => ({
  ...input,
  mentions: input.mentions.map(mention => ({ ...mention })),
  attachments: input.attachments.map(attachment => ({ ...attachment })),
});
const nextOrder = (windows: VisualWindow[]) => windows.reduce((order, window) => Math.max(order, window.order), 0) + 1;
const newWindow = (kind: VisualPopupKind, tabId: string, order: number): VisualWindow => ({
  id: nanoid(10), kind, tabIds: [tabId], activeTabId: tabId, minimized: false, hidden: false, order,
  frame: kind === 'search' ? { x: 20, y: 110, width: 460, height: 520 } : {
    x: (typeof window === 'undefined' ? 1024 : window.innerWidth) - 444, y: 150, width: 420, height: 620,
  },
});
function withoutTab(window: VisualWindow, tabId: string): VisualWindow | null {
  const index = window.tabIds.indexOf(tabId);
  if (index < 0) return window;
  const tabIds = window.tabIds.filter(id => id !== tabId);
  if (!tabIds.length) return null;
  return { ...window, tabIds, activeTabId: window.activeTabId === tabId ? tabIds[Math.min(index, tabIds.length - 1)] : window.activeTabId };
}
const owningWindow = (windows: VisualWindow[], tabId: string) => windows.find(window => window.tabIds.includes(tabId));

/** Ephemeral layout only. Controllers remain in keyed session components, so a
 * tab can move between windows without restarting generation or losing input. */
export const useVisualSessionStore = create<VisualSessionState>((set, get) => ({
  projectId: null, tabs: {}, windows: [], deliveries: {},
  consumeRequest: (projectId, id) => {
    const receipt = get().deliveries[projectId] ?? { requestId: 0, search: [], model: [] };
    if (id <= receipt.requestId) return false;
    set(state => ({ deliveries: { ...state.deliveries, [projectId]: { ...receipt, requestId: id } } }));
    return true;
  },
  consumePublication: (projectId, kind, id) => {
    const receipt = get().deliveries[projectId] ?? { requestId: 0, search: [], model: [] };
    if (receipt[kind].includes(id)) return false;
    set(state => ({ deliveries: { ...state.deliveries, [projectId]: { ...receipt, [kind]: [...receipt[kind], id] } } }));
    return true;
  },
  initialize: (projectId, drafts, openKinds) => set(state => {
    const changedProject = state.projectId !== projectId;
    let tabs = changedProject ? {} : state.tabs;
    let windows = changedProject ? [] : state.windows;
    for (const kind of openKinds) {
      if ((kind !== 'search' && kind !== 'model') || windows.some(window => window.kind === kind)) continue;
      const tab: VisualTab = { id: nanoid(10), kind, draft: copyDraft(drafts[kind]), activity: { state: 'idle', label: '' } };
      tabs = { ...tabs, [tab.id]: tab };
      windows = [...windows, newWindow(kind, tab.id, nextOrder(windows))];
    }
    return changedProject || tabs !== state.tabs ? { projectId, tabs, windows } : state;
  }),
  newTab: (kind, options = {}) => {
    const id = nanoid(10);
    const tab: VisualTab = {
      id, kind, draft: copyDraft(options.input ?? blank()), activity: { state: 'idle', label: '' },
      ...(options.inspectedArtifactId !== undefined ? { inspectedArtifactId: options.inspectedArtifactId } : {}),
      ...(options.externalSearch ? { externalSearch: options.externalSearch } : {}),
    };
    set(state => {
      const matching = state.windows.filter(window => window.kind === kind);
      const target = matching.find(window => window.id === options.windowId) ?? matching.reduce<VisualWindow | undefined>((last, window) => !last || window.order > last.order ? window : last, undefined);
      const order = nextOrder(state.windows);
      return {
        tabs: { ...state.tabs, [id]: tab },
        windows: target ? state.windows.map(window => window.id === target.id ? {
          ...window, tabIds: [...window.tabIds, id], activeTabId: id, minimized: false, hidden: false, order,
        } : window) : [...state.windows, newWindow(kind, id, order)],
      };
    });
    return id;
  },
  activate: tabId => set(state => {
    const owner = owningWindow(state.windows, tabId);
    if (!owner) return state;
    const order = nextOrder(state.windows);
    return { windows: state.windows.map(window => window.id === owner.id ? { ...window, activeTabId: tabId, minimized: false, hidden: false, order } : window) };
  }),
  updateDraft: (tabId, input) => set(state => state.tabs[tabId] ? { tabs: { ...state.tabs, [tabId]: { ...state.tabs[tabId], draft: copyDraft(input) } } } : state),
  setActivity: (tabId, activity) => set(state => {
    const tab = state.tabs[tabId];
    return tab && (tab.activity.state !== activity.state || tab.activity.label !== activity.label)
      ? { tabs: { ...state.tabs, [tabId]: { ...tab, activity: { ...activity } } } } : state;
  }),
  setInspector: (tabId, id) => set(state => {
    const tab = state.tabs[tabId];
    return tab && tab.inspectedArtifactId !== id ? { tabs: { ...state.tabs, [tabId]: { ...tab, inspectedArtifactId: id } } } : state;
  }),
  detach: (tabId, point) => set(state => {
    const tab = state.tabs[tabId], owner = owningWindow(state.windows, tabId);
    if (!tab || !owner) return state;
    const frame = owner.frame;
    const detached = newWindow(tab.kind, tabId, nextOrder(state.windows));
    detached.frame = {
      x: point?.x ?? (frame?.x ?? 24) + 28,
      y: point?.y ?? (frame?.y ?? 24) + 28,
      width: frame?.width ?? 520,
      height: frame?.height ?? 620,
    };
    return { windows: [...state.windows.flatMap(window => {
      if (window.id !== owner.id) return [window];
      const remaining = withoutTab(window, tabId);
      return remaining ? [remaining] : [];
    }), detached] };
  }),
  move: (tabId, targetWindowId, beforeTabId) => set(state => {
    const tab = state.tabs[tabId], owner = owningWindow(state.windows, tabId);
    const target = state.windows.find(window => window.id === targetWindowId);
    if (!tab || !owner || !target || target.kind !== tab.kind || beforeTabId === tabId) return state;
    const tabIds = target.tabIds.filter(id => id !== tabId);
    const index = beforeTabId ? tabIds.indexOf(beforeTabId) : -1;
    tabIds.splice(index < 0 ? tabIds.length : index, 0, tabId);
    const order = nextOrder(state.windows);
    return { windows: state.windows.flatMap(window => {
      if (window.id === target.id) return [{ ...window, tabIds, activeTabId: tabId, minimized: false, hidden: false, order }];
      if (window.id !== owner.id) return [window];
      const remaining = withoutTab(window, tabId);
      return remaining ? [remaining] : [];
    }) };
  }),
  closeTab: tabId => {
    const state = get(), tab = state.tabs[tabId], owner = owningWindow(state.windows, tabId);
    if (!tab || !owner) return;
    if (tab.activity.state === 'running') { get().minimizeWindow(owner.id); return; }
    set(current => {
      const tabs = { ...current.tabs }; delete tabs[tabId];
      return { tabs, windows: current.windows.flatMap(window => {
        const remaining = withoutTab(window, tabId);
        return remaining ? [remaining] : [];
      }) };
    });
  },
  minimizeWindow: id => set(state => ({ windows: state.windows.map(window => window.id === id ? { ...window, minimized: true, hidden: false } : window) })),
  restoreWindow: id => set(state => {
    const order = nextOrder(state.windows);
    return { windows: state.windows.map(window => window.id === id ? { ...window, minimized: false, hidden: false, order } : window) };
  }),
  hideWindow: id => set(state => ({ windows: state.windows.map(window => {
    if (window.id !== id) return window;
    const running = window.tabIds.some(tabId => state.tabs[tabId]?.activity.state === 'running');
    return { ...window, minimized: running, hidden: !running };
  }) })),
  setFrame: (id, frame) => set(state => {
    const current = state.windows.find(window => window.id === id);
    if (!current || current.frame && current.frame.x === frame.x && current.frame.y === frame.y && current.frame.width === frame.width && current.frame.height === frame.height) return state;
    return { windows: state.windows.map(window => window.id === id ? { ...window, frame: { ...frame } } : window) };
  }),
  focusWindow: id => set(state => {
    const target = state.windows.find(window => window.id === id);
    if (!target || !state.windows.some(window => window.order > target.order)) return state;
    const order = nextOrder(state.windows);
    return { windows: state.windows.map(window => window.id === id ? { ...window, order } : window) };
  }),
  reset: () => set({ projectId: null, tabs: {}, windows: [] }),
}));
