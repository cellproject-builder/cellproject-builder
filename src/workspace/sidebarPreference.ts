import { create } from 'zustand';
import { readPreference, writePreference } from '@/cloud/storage';

const STORAGE_KEY = 'dynamic_diary-sidebar-collapsed';

function savedCollapsed() {
  try { return readPreference(STORAGE_KEY) === 'true'; }
  catch { return false; }
}

export const useSidebarStore = create<{ collapsed: boolean; setCollapsed: (collapsed: boolean) => void; toggleCollapsed: () => void }>((set, get) => ({
  collapsed: savedCollapsed(),
  setCollapsed: (collapsed) => {
    try { writePreference(STORAGE_KEY, String(collapsed)); }
    catch { /* The session preference still works when storage is blocked. */ }
    set({ collapsed });
  },
  toggleCollapsed: () => get().setCollapsed(!get().collapsed),
}));
