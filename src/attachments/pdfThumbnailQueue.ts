// A zoomed-out board can expose many covers at once. Hold a slot through
// rendering and worker destruction so thumbnail parsing stays bounded.
const MAX_THUMBNAIL_WORKERS = 2;
type WaitingThumbnail = { signal: AbortSignal; start(): void; abort(): void };
const waiting: WaitingThumbnail[] = [];
let active = 0;

function drain() {
  while (active < MAX_THUMBNAIL_WORKERS && waiting.length) {
    const request = waiting.shift()!;
    request.signal.removeEventListener('abort', request.abort);
    request.start();
  }
}

export function acquirePdfThumbnailSlot(signal: AbortSignal): Promise<() => void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason); return; }
    const request: WaitingThumbnail = {
      signal,
      start() {
        active++;
        let released = false;
        resolve(() => {
          if (released) return;
          released = true; active--; drain();
        });
      },
      abort() {
        const index = waiting.indexOf(request);
        if (index >= 0) waiting.splice(index, 1);
        reject(signal.reason);
      },
    };
    signal.addEventListener('abort', request.abort, { once: true });
    waiting.push(request); drain();
  });
}
