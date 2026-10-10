import { act, Component, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { ProjectIcon } from './projectIcons';

const chunk = vi.hoisted(() => ({ reject: null as null | ((reason: Error) => void) }));
vi.mock('./RadixProjectIcon', () => new Promise((_resolve, reject) => {
  chunk.reject = reject;
}));

// Observe errors escaping the icon without making an uncaught React exception
// the test failure. The application itself has no enclosing error boundary.
class WorkspaceProbe extends Component<{ children: ReactNode; onError(error: Error): void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error) { this.props.onError(error); }
  render() { return this.state.failed ? <p>Workspace crashed</p> : this.props.children; }
}

it('keeps the workspace and saved appearance intact when the extended icon chunk fails', async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host), escapedError = vi.fn();
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  const appearance = { icon: 'AlignBaselineIcon', color: '#a78bfa' };
  try {
    await act(async () => root.render(<WorkspaceProbe onError={escapedError}>
      <p>Project workspace</p><ProjectIcon appearance={appearance} size={22} decorated />
    </WorkspaceProbe>));
    await vi.waitFor(() => expect(chunk.reject).not.toBeNull());
    await act(async () => {
      chunk.reject!(new Error('Synthetic unavailable icon chunk'));
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    expect(escapedError).not.toHaveBeenCalled();
    expect(host.textContent).toContain('Project workspace');
    const glyph = host.querySelector<HTMLElement>('[data-project-icon="AlignBaselineIcon"]');
    expect(glyph?.querySelector('svg')).not.toBeNull();
    expect(glyph?.getAttribute('aria-hidden')).toBe('true');
    expect(glyph?.style.color).toBe('rgb(167, 139, 250)');
    expect(appearance).toEqual({ icon: 'AlignBaselineIcon', color: '#a78bfa' });
  } finally {
    act(() => root.unmount());
    host.remove();
    consoleError.mockRestore();
  }
});
