import { beforeEach, describe, expect, it } from 'vitest';
import { useVisualViewStore } from './viewStore';

beforeEach(() => useVisualViewStore.setState({ angles: {}, pitches: {}, explosions: {}, selectedParts: {} }));

describe('temporary 3D inspection views', () => {
  it('zooms the inspection camera independently, clamps it and resets without changing assembly state', () => {
    useVisualViewStore.setState({ zooms: {} });
    const view = useVisualViewStore.getState();
    view.zoomBy('motor', -100);
    expect(useVisualViewStore.getState().zooms.motor).toBeGreaterThan(1);
    view.zoomBy('motor', 100);
    expect(useVisualViewStore.getState().zooms.motor).toBeCloseTo(1);
    view.zoomBy('motor', -100000); expect(useVisualViewStore.getState().zooms.motor).toBe(4);
    view.zoomBy('motor', 100000); expect(useVisualViewStore.getState().zooms.motor).toBe(.4);
    view.setExplosion('motor', .5); view.reset('motor');
    expect(useVisualViewStore.getState().zooms.motor).toBe(1);
    expect(useVisualViewStore.getState().explosions.motor).toBe(.5);
  });
  it('keeps each object independent and limits tilt while allowing repeated turns', () => {
    const view = useVisualViewStore.getState();
    view.orbit('arm', .4, .3);
    view.orbit('motor', Math.PI * 20 + .2, 100);
    expect(useVisualViewStore.getState().angles.arm).toBeCloseTo(.4);
    expect(useVisualViewStore.getState().pitches.arm).toBeCloseTo(.3);
    expect(useVisualViewStore.getState().angles.motor).toBeCloseTo(.2);
    expect(useVisualViewStore.getState().pitches.motor).toBeCloseTo(Math.PI / 2);
    view.orbit('motor', 0, -100);
    expect(useVisualViewStore.getState().pitches.motor).toBeCloseTo(-Math.PI / 2);
    view.reset('motor');
    expect(useVisualViewStore.getState().angles.motor).toBe(0);
    expect(useVisualViewStore.getState().pitches.motor).toBe(0);
    expect(useVisualViewStore.getState().angles.arm).toBeCloseTo(.4);
  });

  it('ignores invalid gesture coordinates instead of losing the model view', () => {
    const view = useVisualViewStore.getState();
    view.orbit('arm', .4, .3);
    view.orbit('arm', NaN, 2);
    view.orbit('arm', 2, Infinity);
    expect(useVisualViewStore.getState().angles.arm).toBeCloseTo(.4);
    expect(useVisualViewStore.getState().pitches.arm).toBeCloseTo(.3);
  });

  it('keeps reversible exploded inspection and selected parts independent of orbit and other objects', () => {
    const view = useVisualViewStore.getState();
    view.orbit('board', .4, .3);
    view.setExplosion('board', 2);
    view.selectPart('board', 'usb');
    view.setExplosion('motor', .5);
    expect(useVisualViewStore.getState().explosions).toEqual({ board: 1, motor: .5 });
    expect(useVisualViewStore.getState().selectedParts.board).toBe('usb');
    view.setExplosion('board', NaN);
    expect(useVisualViewStore.getState().explosions.board).toBe(1);
    view.setExplosion('board', -1);
    view.selectPart('board', null);
    expect(useVisualViewStore.getState().explosions.board).toBe(0);
    expect(useVisualViewStore.getState().selectedParts.board).toBeNull();
    expect(useVisualViewStore.getState().angles.board).toBeCloseTo(.4);
    expect(useVisualViewStore.getState().pitches.board).toBeCloseTo(.3);
    view.reset('motor');
    expect(useVisualViewStore.getState().explosions.motor).toBe(.5);
  });
});
