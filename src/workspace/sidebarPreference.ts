import { create } from 'zustand';

const STORAGE_KEY = 'dynamic_diary-sidebar-collapsed';

function savedCollapsed() {
  try { return localStorage.getItem(STORAGE_KEY) === 'true'; }
  catch { return false; }
}

export const useSidebarStore = create<{ collapsed: boolean; setCollapsed: (collapsed: boolean) => void; toggleCollapsed: () => void }>((set, get) => ({
  collapsed: savedCollapsed(),
  setCollapsed: (collapsed) => {
    try { localStorage.setItem(STORAGE_KEY, String(collapsed)); }
    catch { /* The session preference still works when storage is blocked. */ }
    set({ collapsed });
  },
  toggleCollapsed: () => get().setCollapsed(!get().collapsed),
}));
