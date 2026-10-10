import { create } from 'zustand';

export type Theme = 'oled' | 'dark' | 'light';
const STORAGE_KEY = 'dynamic_diary-theme';

function savedTheme(): Theme {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (value === 'oled' || value === 'dark' || value === 'light') return value;
  } catch { /* A blocked storage must not prevent the app from opening. */ }
  return 'oled';
}

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  const color = theme === 'light' ? '#F5F5F7' : theme === 'dark' ? '#1C1C1E' : '#000000';
  document.documentElement.style.backgroundColor = color;
  const chrome = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (chrome) chrome.content = color;
}

export const useThemeStore = create<{ theme: Theme; setTheme: (theme: Theme) => void }>((set) => ({
  theme: savedTheme(),
  setTheme: (theme) => {
    set({ theme });
    applyTheme(theme);
    try { localStorage.setItem(STORAGE_KEY, theme); } catch { /* Session preference still works. */ }
  },
}));

export function initializeTheme() { applyTheme(useThemeStore.getState().theme); }
