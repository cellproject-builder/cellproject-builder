import { beforeEach, describe, expect, it } from 'vitest';
import { useVisualPopupStore } from './uiStore';

beforeEach(() => useVisualPopupStore.setState({ searchOpen: false, modelOpen: false, searchMinimized: false, modelMinimized: false, modelBase: null, inspectedArtifactId: null }));

describe('shared 3D studio inspector', () => {
  it('restores the minimized inspector through the canvas entry point and keeps each tool independent', () => {
    const tools = useVisualPopupStore.getState();
    tools.inspectArtifact('arduino-3d'); tools.minimize('model'); tools.open('search'); tools.minimize('search');
    tools.open('model');
    expect(useVisualPopupStore.getState()).toMatchObject({ modelOpen: true, modelMinimized: false, inspectedArtifactId: 'arduino-3d', searchOpen: true, searchMinimized: true });
    tools.restore('search'); tools.close('model');
    expect(useVisualPopupStore.getState()).toMatchObject({ modelOpen: false, modelMinimized: false, searchOpen: true, searchMinimized: false });
  });
  it('inspects a model in the existing studio and returns to creation from its regular entry point', () => {
    useVisualPopupStore.getState().inspectArtifact('arduino-3d');
    expect(useVisualPopupStore.getState()).toMatchObject({ modelOpen: true, inspectedArtifactId: 'arduino-3d', modelBase: null });
    useVisualPopupStore.getState().open('search');
    expect(useVisualPopupStore.getState().inspectedArtifactId).toBe('arduino-3d');
    useVisualPopupStore.getState().open('model');
    expect(useVisualPopupStore.getState().inspectedArtifactId).toBeNull();
  });

  it('prepares a new image reference instead of retaining another inspected model', () => {
    useVisualPopupStore.getState().inspectArtifact('old-model');
    const target = { id: 'board-image', kind: 'image' as const, label: 'Arduino Uno R3', detail: 'Image', fingerprint: 'v1' };
    useVisualPopupStore.getState().useAsBase(target);
    expect(useVisualPopupStore.getState()).toMatchObject({ modelOpen: true, inspectedArtifactId: null, modelBase: target });
    useVisualPopupStore.getState().inspectArtifact('next-model');
    expect(useVisualPopupStore.getState().modelBase).toBeNull();
  });
});
