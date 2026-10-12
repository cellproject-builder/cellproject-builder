import { Worker } from 'node:worker_threads';

const workerUrl = new URL('../dist-server/external-domain.mjs', import.meta.url);
// A valid encrypted manifest may contain 96 MiB of plaintext. Leave room for
// the bounded action payload and framing instead of rejecting unrelated data.
const MAX_INPUT_BYTES = 128 * 1024 * 1024;
const TIMEOUT_MS = 15000;
function invoke(data) {
  if (Buffer.byteLength(JSON.stringify(data)) > MAX_INPUT_BYTES) throw new Error('external_worker_input_limit');
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerUrl, { workerData: data, resourceLimits: { maxOldGenerationSizeMb: 512, maxYoungGenerationSizeMb: 32, stackSizeMb: 4 }, execArgv: [] });
    let finished = false;
    const finish = (error, value) => {
      if (finished) return;
      finished = true; clearTimeout(timer);
      void worker.terminate();
      if (error) reject(error); else resolve(value);
    };
    const timer = setTimeout(() => finish(new Error('external_worker_timeout')), TIMEOUT_MS);
    worker.once('message', message => {
      if (message?.ok) return finish(null, message.value);
      const error = new Error(message?.error || 'external_worker_failed');
      const code = error.message === 'planChanged' ? 'revision_conflict' : error.message;
      error.code = /^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(code) ? code : 'operation_rejected';
      error.status = error.code === 'revision_conflict' ? 409 : 400;
      finish(error);
    });
    worker.once('error', error => finish(error));
    worker.once('exit', () => { if (!finished) finish(new Error('external_worker_exited')); });
  });
}
/** A fresh worker is a tenant boundary, including store caches and hydration queues. */
export function runExternalOperation(input) { return invoke({ mode: 'operation', input }); }
let catalogPromise;
export function getExternalCatalog() {
  catalogPromise ??= invoke({ mode: 'catalog' }).then(value => Object.freeze(value.map(entry => Object.freeze(entry)))).catch(error => { catalogPromise = undefined; throw error; });
  return catalogPromise.then(value => structuredClone(value));
}
