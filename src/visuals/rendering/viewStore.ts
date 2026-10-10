import { create } from 'zustand';
interface VisualViewState {
  angles: Record<string, number>;
  pitches: Record<string, number>;
  zooms: Record<string, number>;
  explosions: Record<string, number>;
  selectedParts: Record<string, string | null>;
  orbit: (id: string, yaw: number, pitch: number) => void;
  zoomBy: (id: string, deltaPixels: number) => void;
  setExplosion: (id: string, amount: number) => void;
  selectPart: (id: string, partId: string | null) => void;
  reset: (id: string) => void;
}

/** Inspection changes the view only, without creating artifact revisions or undo entries. */
export const useVisualViewStore = create<VisualViewState>()((set) => ({
  angles: {}, pitches: {}, zooms: {}, explosions: {}, selectedParts: {},
  zoomBy: (id, deltaPixels) => { if (!Number.isFinite(deltaPixels)) return; set(state => ({ zooms: { ...state.zooms, [id]: Math.max(.4, Math.min(4, (state.zooms[id] ?? 1) * Math.exp(-deltaPixels * .002))) } })); },
  orbit: (id, yaw, pitch) => {
    if (!Number.isFinite(yaw) || !Number.isFinite(pitch)) return;
    set(state => ({
      angles: { ...state.angles, [id]: ((state.angles[id] ?? 0) + yaw) % (Math.PI * 2) },
      pitches: { ...state.pitches, [id]: Math.max(-Math.PI / 2, Math.min(Math.PI / 2, (state.pitches[id] ?? 0) + pitch)) },
    }));
  },
  setExplosion: (id, amount) => {
    if (!Number.isFinite(amount)) return;
    set(state => ({ explosions: { ...state.explosions, [id]: Math.max(0, Math.min(1, amount)) } }));
  },
  selectPart: (id, partId) => set(state => ({ selectedParts: { ...state.selectedParts, [id]: partId } })),
  reset: id => set(state => ({ angles: { ...state.angles, [id]: 0 }, pitches: { ...state.pitches, [id]: 0 }, zooms: { ...state.zooms, [id]: 1 } })),
}));
