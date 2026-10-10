import { create } from 'zustand';
import type { MentionTarget } from '../types';

export type VisualPopupKind = 'search' | 'model';
export interface VisualToolActivity { state: 'idle' | 'running' | 'ready' | 'error'; label: string }
export const useVisualPopupStore = create<{
  searchOpen: boolean;
  modelOpen: boolean;
  searchMinimized: boolean;
  modelMinimized: boolean;
  modelBase: MentionTarget | null;
  inspectedArtifactId: string | null;
  open: (kind: VisualPopupKind) => void;
  close: (kind: VisualPopupKind) => void;
  minimize: (kind: VisualPopupKind) => void;
  restore: (kind: VisualPopupKind) => void;
  useAsBase: (target: MentionTarget) => void;
  inspectArtifact: (id: string) => void;
}>((set) => ({
  searchOpen: false, modelOpen: false, searchMinimized: false, modelMinimized: false, modelBase: null, inspectedArtifactId: null,
  open: (kind) => set(state => kind === 'search' ? { searchOpen: true, searchMinimized: false }
    : { modelOpen: true, modelMinimized: false, ...(state.modelOpen && state.modelMinimized ? {} : { inspectedArtifactId: null }) }),
  close: (kind) => set(kind === 'search' ? { searchOpen: false, searchMinimized: false } : { modelOpen: false, modelMinimized: false }),
  minimize: (kind) => set(kind === 'search' ? { searchMinimized: true } : { modelMinimized: true }),
  restore: (kind) => set(kind === 'search' ? { searchOpen: true, searchMinimized: false } : { modelOpen: true, modelMinimized: false }),
  useAsBase: (target) => set({ modelOpen: true, modelMinimized: false, modelBase: target, inspectedArtifactId: null }),
  inspectArtifact: (id) => set({ modelOpen: true, modelMinimized: false, modelBase: null, inspectedArtifactId: id }),
}));
