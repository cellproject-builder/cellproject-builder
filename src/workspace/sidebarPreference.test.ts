import { beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => { localStorage.clear(); vi.resetModules(); vi.restoreAllMocks(); });

describe('sidebar preference', () => {
  it('restores the collapsed rail after reload and can expand it again', async () => {
    const { useSidebarStore } = await import('./sidebarPreference');
    expect(useSidebarStore.getState().collapsed).toBe(false);
    useSidebarStore.getState().toggleCollapsed();
    vi.resetModules();
    const restored = await import('./sidebarPreference');
    expect(restored.useSidebarStore.getState().collapsed).toBe(true);
    restored.useSidebarStore.getState().toggleCollapsed();
    expect(localStorage.getItem('dynamic_diary-sidebar-collapsed')).toBe('false');
  });

  it('keeps navigation usable when local storage is blocked', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('Blocked', 'SecurityError'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Blocked', 'SecurityError'); });
    const { useSidebarStore } = await import('./sidebarPreference');
    expect(useSidebarStore.getState().collapsed).toBe(false);
    expect(() => useSidebarStore.getState().toggleCollapsed()).not.toThrow();
    expect(useSidebarStore.getState().collapsed).toBe(true);
  });
});
