import { describe, expect, it } from 'vitest';
import { calculateInkViewport, InkPointerRouter, type InkPointerSample } from './pointerGestures';

const pointer = (pointerId: number, pointerType = 'touch', x = 0, y = 0): InkPointerSample => ({ pointerId, pointerType, clientX: x, clientY: y, button: 0 });
const kinds = (result: ReturnType<InkPointerRouter['down']>) => result.actions.map(action => action.kind);

describe('ink pointer ownership', () => {
  it('draws with pen and mouse while touch navigates by default', () => {
    for (const type of ['pen', 'mouse']) {
      const router = new InkPointerRouter();
      expect(kinds(router.down(pointer(1, type)))).toEqual(['draw-start']);
      expect(kinds(router.move(pointer(1, type, 10, 20)))).toEqual(['draw-move']);
      expect(kinds(router.up(pointer(1, type, 10, 20)))).toEqual(['draw-end']);
    }
    const router = new InkPointerRouter();
    expect(kinds(router.down(pointer(1)))).toEqual(['navigate-start']);
    expect(kinds(router.move(pointer(1, 'touch', 20, 30)))).toEqual(['navigate-move']);
    expect(kinds(router.up(pointer(1)))).toEqual(['navigate-end']);
  });

  it('keeps palm contacts from moving the viewport or cancelling a pen stroke', () => {
    const router = new InkPointerRouter(); router.down(pointer(1, 'pen'));
    expect(router.down(pointer(2))).toEqual({ handled: true, actions: [] });
    expect(router.move(pointer(2, 'touch', 100, 100))).toEqual({ handled: true, actions: [] });
    expect(kinds(router.move(pointer(1, 'pen', 20, 30)))).toEqual(['draw-move']);
    expect(kinds(router.up(pointer(1, 'pen')))).toEqual(['draw-end']);
    expect(kinds(router.move(pointer(2, 'touch', 200, 200)))).toEqual([]);
    router.up(pointer(2));
    expect(kinds(router.down(pointer(3)))).toEqual(['navigate-start']);
  });

  it('lets a pen preempt a held touch navigation and suppresses the remaining palm', () => {
    const router = new InkPointerRouter(); router.down(pointer(2));
    const result = router.down(pointer(1, 'pen'));
    expect(kinds(result)).toEqual(['navigate-end', 'draw-start']);
    expect(result.actions[0]).toMatchObject({ cancelled: true });
    router.up(pointer(1, 'pen'));
    expect(router.move(pointer(2, 'touch', 40, 40)).actions).toEqual([]);
  });

  it('cancels finger ink when a second finger starts pinch and does not restart it until all lift', () => {
    const router = new InkPointerRouter(() => true);
    expect(kinds(router.down(pointer(1)))).toEqual(['draw-start']);
    expect(kinds(router.down(pointer(2, 'touch', 30, 0)))).toEqual(['draw-cancel', 'navigate-start']);
    expect(kinds(router.move(pointer(2, 'touch', 50, 0)))).toEqual(['navigate-move']);
    expect(kinds(router.up(pointer(2)))).toEqual(['navigate-start']);
    expect(kinds(router.move(pointer(1, 'touch', 10, 10)))).toEqual(['navigate-move']);
    expect(kinds(router.up(pointer(1)))).toEqual(['navigate-end']);
    expect(kinds(router.down(pointer(3)))).toEqual(['draw-start']);
  });

  it('rebases navigation as contacts join or leave, without depending on isPrimary', () => {
    const router = new InkPointerRouter(); router.down(pointer(1));
    const second = { ...pointer(2, 'touch', 50, 0), isPrimary: false };
    expect(kinds(router.down(second))).toEqual(['navigate-start']);
    expect(router.move({ ...second, clientX: 60 }).actions[0]).toMatchObject({ kind: 'navigate-move', points: [{ pointerId: 1 }, { pointerId: 2, x: 60 }] });
    router.down(pointer(3, 'touch', 100, 0));
    expect(router.up(pointer(1)).actions[0]).toMatchObject({ kind: 'navigate-start', points: [{ pointerId: 2 }, { pointerId: 3 }] });
  });
  it('starts pinch from the latest finger ink position instead of its original pointer down', () => {
    const router = new InkPointerRouter(() => true);
    router.down(pointer(1)); router.move(pointer(1, 'touch', 100, 0));
    expect(router.down(pointer(2, 'touch', 200, 0)).actions[1]).toMatchObject({ kind: 'navigate-start', points: [{ pointerId: 1, x: 100, y: 0 }, { pointerId: 2, x: 200, y: 0 }] });
  });

  it('cancels only the owned ink pointer and suppresses incomplete touch navigation after cancellation', () => {
    const router = new InkPointerRouter(); router.down(pointer(1, 'pen'));
    expect(router.up(pointer(2, 'pen'), true)).toEqual({ handled: false, actions: [] });
    expect(kinds(router.up(pointer(1, 'pen'), true))).toEqual(['draw-cancel']);
    router.down(pointer(2)); router.down(pointer(3));
    expect(router.up(pointer(2), true).actions).toEqual([{ kind: 'navigate-end', cancelled: true }]);
    expect(router.move(pointer(3, 'touch', 40, 40)).actions).toEqual([]);
    router.up(pointer(3));
    expect(kinds(router.down(pointer(4)))).toEqual(['navigate-start']);
  });

  it('resets drawing/navigation once on mode changes, blur, or document navigation', () => {
    const router = new InkPointerRouter(); router.down(pointer(1, 'pen'));
    expect(kinds(router.reset())).toEqual(['draw-cancel']); expect(router.reset().actions).toEqual([]);
    router.down(pointer(2));
    expect(router.reset().actions).toEqual([{ kind: 'navigate-end', cancelled: true }]);
    expect(router.move(pointer(2)).handled).toBe(false);
  });

  it('rejects malformed coordinates, duplicate down, extra drawing pointers and non-left mouse buttons', () => {
    const router = new InkPointerRouter();
    expect(router.down({ ...pointer(1, 'mouse'), button: 2 }).handled).toBe(false);
    expect(router.down({ ...pointer(1), clientX: NaN }).handled).toBe(false);
    router.down(pointer(1, 'mouse'));
    expect(router.down(pointer(1, 'mouse')).actions).toEqual([]);
    expect(router.down(pointer(2, 'mouse')).actions).toEqual([]);
    expect(router.move(pointer(2, 'mouse')).actions).toEqual([]);
    expect(kinds(router.up(pointer(1, 'mouse')))).toEqual(['draw-end']);
  });
});

describe('ink viewport navigation', () => {
  const bounds = { left: 100, top: 200 }, limits = { minZoom: .05, maxZoom: 4 };
  it('pans without altering zoom or treating document coordinates as screen coordinates', () => {
    expect(calculateInkViewport({ x: 20, y: 30, zoom: 2 }, [{ pointerId: 1, x: 150, y: 240 }], [{ pointerId: 1, x: 180, y: 220 }], bounds, limits)).toEqual({ x: 50, y: 10, zoom: 2 });
  });
  it('preserves the pinched world point while scaling and moving the centroid', () => {
    const result = calculateInkViewport({ x: 20, y: 30, zoom: 2 }, [{ pointerId: 1, x: 150, y: 240 }, { pointerId: 2, x: 250, y: 240 }], [{ pointerId: 1, x: 120, y: 270 }, { pointerId: 2, x: 320, y: 270 }], bounds, limits);
    expect(result).toEqual({ x: -40, y: 50, zoom: 4 });
    expect((220 - bounds.left - result.x) / result.zoom).toBe((200 - bounds.left - 20) / 2);
  });
  it('clamps zoom around the same focus and never emits NaN for coincident contacts', () => {
    const start = [{ pointerId: 1, x: 0, y: 0 }, { pointerId: 2, x: 10, y: 0 }];
    const result = calculateInkViewport({ x: 0, y: 0, zoom: 2 }, start, [{ ...start[0], x: -100 }, { ...start[1], x: 100 }], { left: 0, top: 0 }, { minZoom: .5, maxZoom: 3 });
    expect(result.zoom).toBe(3); expect(result.x).toBe(-7.5);
    const coincident = calculateInkViewport({ x: 0, y: 0, zoom: 1 }, [start[0], { ...start[1], x: 0 }], start, bounds, limits);
    expect(Object.values(coincident).every(Number.isFinite)).toBe(true); expect(coincident.zoom).toBe(1);
  });
});
