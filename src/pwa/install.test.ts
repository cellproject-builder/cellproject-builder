import { afterEach, expect, it, vi } from 'vitest';
import { createInstallController, isIos } from './install';

const cleanup: (() => void)[] = [];
afterEach(() => { cleanup.splice(0).forEach(fn => fn()); });
it('offers installation only after the browser event and consumes each event once on a user action', async () => {
  const controller = createInstallController(window); cleanup.push(controller.destroy);
  const prompt = vi.fn(async () => ({ outcome: 'dismissed' as const }));
  const event = new Event('beforeinstallprompt', { cancelable: true }); Object.assign(event, { prompt });
  expect(controller.getSnapshot().available).toBe(false);
  window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true); expect(controller.getSnapshot().available).toBe(true); expect(prompt).not.toHaveBeenCalled();
  await controller.install(); await controller.install();
  expect(prompt).toHaveBeenCalledTimes(1); expect(controller.getSnapshot().available).toBe(false); expect(controller.getSnapshot().installed).toBe(false);
});
it('does not confuse accepting the prompt with a completed installation and clears the offer when installed', async () => {
  const controller = createInstallController(window); cleanup.push(controller.destroy);
  const event = new Event('beforeinstallprompt'); Object.assign(event, { prompt: async () => ({ outcome: 'accepted' as const }) }); window.dispatchEvent(event);
  await controller.install(); expect(controller.getSnapshot().installed).toBe(false);
  window.dispatchEvent(new Event('appinstalled')); expect(controller.getSnapshot().installed).toBe(true); expect(controller.getSnapshot().available).toBe(false);
});
it('recovers after a prompt error without automatic retry and reports offline only as connectivity', async () => {
  const controller = createInstallController(window); cleanup.push(controller.destroy);
  const prompt = vi.fn(async () => { throw new Error('denied'); }); const event = new Event('beforeinstallprompt'); Object.assign(event, { prompt }); window.dispatchEvent(event);
  await controller.install(); expect(controller.getSnapshot().error).toBe(true); expect(prompt).toHaveBeenCalledTimes(1);
  window.dispatchEvent(new Event('offline')); expect(controller.getSnapshot().offline).toBe(true);
  window.dispatchEvent(new Event('online')); expect(controller.getSnapshot().offline).toBe(false);
});
it('recognizes iPhone and desktop-mode iPad without classifying all Macs as iOS', () => {
  expect(isIos('iPhone', 0)).toBe(true); expect(isIos('Macintosh', 5)).toBe(true); expect(isIos('Macintosh', 0)).toBe(false);
});
