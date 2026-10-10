import { beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  vi.resetModules();
});

describe('appearance preference', () => {
  it('opens in OLED when no preference has been saved', async () => {
    const { initializeTheme, useThemeStore } = await import('./theme');
    initializeTheme();
    expect(useThemeStore.getState().theme).toBe('oled');
    expect(document.documentElement.dataset.theme).toBe('oled');
  });

  it.each(['light', 'dark', 'oled'] as const)('applies %s immediately and restores it after reload', async (theme) => {
    const { initializeTheme, useThemeStore } = await import('./theme');
    initializeTheme();
    useThemeStore.getState().setTheme(theme);
    expect(document.documentElement.dataset.theme).toBe(theme);
    vi.resetModules();
    const reloaded = await import('./theme');
    reloaded.initializeTheme();
    expect(reloaded.useThemeStore.getState().theme).toBe(theme);
    expect(document.documentElement.dataset.theme).toBe(theme);
  });

  it('falls back to OLED when the saved preference is no longer valid', async () => {
    localStorage.setItem('dynamic_diary-theme', 'unknown');
    const { initializeTheme, useThemeStore } = await import('./theme');
    initializeTheme();
    expect(useThemeStore.getState().theme).toBe('oled');
    expect(document.documentElement.dataset.theme).toBe('oled');
  });
});
