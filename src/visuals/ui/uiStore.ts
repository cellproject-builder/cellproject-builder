import { create } from 'zustand';
import { useGraphStore } from '@/store';
import type { MentionTarget, VisualPromptInput } from '../types';
import { useVisualSessionStore } from './sessionStore';

export type VisualPopupKind = 'search' | 'model';
export interface VisualToolActivity { state: 'idle' | 'running' | 'ready' | 'error'; label: string }
type PopupRequest = { id: number; projectId: string | null; action: 'open' | 'close' | 'minimize' | 'restore' | 'base' | 'inspect'; kind: VisualPopupKind; modelBase?: MentionTarget; inspectedArtifactId?: string; input?: VisualPromptInput };
let requestId = 0;
const request = (action: PopupRequest['action'], kind: VisualPopupKind, target: Pick<PopupRequest, 'modelBase' | 'inspectedArtifactId' | 'input'> = {}): PopupRequest => ({
  id: ++requestId, projectId: useGraphStore.getState().project?.id ?? useVisualSessionStore.getState().projectId, action, kind, ...target,
});
export const useVisualPopupStore = create<{
  request: PopupRequest | null;
  searchOpen: boolean;
  modelOpen: boolean;
  searchMinimized: boolean;
  modelMinimized: boolean;
  modelBase: MentionTarget | null;
  inspectedArtifactId: string | null;
  open: (kind: VisualPopupKind, input?: VisualPromptInput) => void;
  close: (kind: VisualPopupKind) => void;
  minimize: (kind: VisualPopupKind) => void;
  restore: (kind: VisualPopupKind) => void;
  useAsBase: (target: MentionTarget) => void;
  inspectArtifact: (id: string) => void;
}>((set) => ({
  request: null, searchOpen: false, modelOpen: false, searchMinimized: false, modelMinimized: false, modelBase: null, inspectedArtifactId: null,
  open: (kind, input) => set(state => ({ request: request('open', kind, input ? { input: { ...input, mentions: input.mentions.map(item => ({ ...item })), attachments: input.attachments.map(item => ({ ...item })) } } : {}), ...(kind === 'search' ? { searchOpen: true, searchMinimized: false }
    : { modelOpen: true, modelMinimized: false, ...(state.modelOpen && state.modelMinimized ? {} : { inspectedArtifactId: null }) }) })),
  close: (kind) => set({ request: request('close', kind), ...(kind === 'search' ? { searchOpen: false, searchMinimized: false } : { modelOpen: false, modelMinimized: false }) }),
  minimize: (kind) => set({ request: request('minimize', kind), ...(kind === 'search' ? { searchMinimized: true } : { modelMinimized: true }) }),
  restore: (kind) => set({ request: request('restore', kind), ...(kind === 'search' ? { searchOpen: true, searchMinimized: false } : { modelOpen: true, modelMinimized: false }) }),
  useAsBase: (target) => set({ request: request('base', 'model', { modelBase: { ...target } }), modelOpen: true, modelMinimized: false, modelBase: target, inspectedArtifactId: null }),
  inspectArtifact: (id) => set({ request: request('inspect', 'model', { inspectedArtifactId: id }), modelOpen: true, modelMinimized: false, modelBase: null, inspectedArtifactId: id }),
}));
