type InstallOutcome = { outcome: 'accepted' | 'dismissed' };
type InstallEvent = Event & { prompt: () => Promise<InstallOutcome | void>; userChoice?: Promise<InstallOutcome> };
export type InstallState = { available: boolean; installed: boolean; prompting: boolean; error: boolean; offline: boolean; updateReady: boolean };
export const isIos = (userAgent: string, touchPoints: number) => /iPad|iPhone|iPod/i.test(userAgent) || /Macintosh/i.test(userAgent) && touchPoints > 1;

export function createInstallController(target: Window) {
  const media = target.matchMedia('(display-mode: standalone)');
  let state: InstallState = { available: false, installed: media.matches || (target.navigator as Navigator & { standalone?: boolean }).standalone === true, prompting: false, error: false, offline: target.navigator.onLine === false, updateReady: false };
  let deferred: InstallEvent | null = null;
  const listeners = new Set<() => void>();
  const change = (patch: Partial<InstallState>) => { state = { ...state, ...patch }; listeners.forEach(fn => fn()); };
  const beforeInstall = (event: Event) => {
    if (state.installed || typeof (event as InstallEvent).prompt !== 'function') return;
    event.preventDefault(); deferred = event as InstallEvent; change({ available: true, error: false });
  };
  const installed = () => { deferred = null; change({ installed: true, available: false, prompting: false }); };
  const displayChange = () => { if (media.matches) installed(); };
  const offline = () => change({ offline: true }); const online = () => change({ offline: false });
  target.addEventListener('beforeinstallprompt', beforeInstall); target.addEventListener('appinstalled', installed);
  target.addEventListener('offline', offline); target.addEventListener('online', online); media.addEventListener?.('change', displayChange);
  return {
    getSnapshot: () => state,
    subscribe: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
    async install() {
      if (!deferred || state.prompting || state.installed) return;
      const event = deferred; deferred = null; change({ available: false, prompting: true, error: false });
      try { await event.prompt(); if (event.userChoice) await event.userChoice; }
      catch { change({ error: true }); }
      finally { change({ prompting: false }); }
    },
    setUpdateReady: (ready: boolean) => change({ updateReady: ready }),
    destroy() {
      target.removeEventListener('beforeinstallprompt', beforeInstall); target.removeEventListener('appinstalled', installed);
      target.removeEventListener('offline', offline); target.removeEventListener('online', online); media.removeEventListener?.('change', displayChange); listeners.clear(); deferred = null;
    },
  };
}

export const installController = createInstallController(window);
let waitingWorker: ServiceWorker | null = null;
/** Development has HMR and a key-seeding bundle; never cache it through a service worker. */
export async function registerPwa(production: boolean) {
  if (!production || !window.isSecureContext || !('serviceWorker' in navigator)) return;
  try {
    const registration = await navigator.serviceWorker.register('/service-worker.js', { scope: '/', updateViaCache: 'none' });
    const waiting = () => { if (registration.waiting && navigator.serviceWorker.controller) { waitingWorker = registration.waiting; installController.setUpdateReady(true); } };
    waiting();
    registration.addEventListener('updatefound', () => {
      const worker = registration.installing;
      worker?.addEventListener('statechange', () => { if (worker.state === 'installed') waiting(); });
    });
  } catch { /* Installation is optional; a failed worker must not prevent opening local projects. */ }
}
/** Only an explicit click restarts this tab; no controllerchange reload during editing. */
export function applyPwaUpdate() {
  if (!waitingWorker) return;
  navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload(), { once: true });
  waitingWorker.postMessage({ type: 'ACTIVATE_UPDATE' }); waitingWorker = null; installController.setUpdateReady(false);
}
