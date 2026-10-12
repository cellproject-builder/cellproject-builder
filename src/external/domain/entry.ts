import { parentPort, workerData } from 'node:worker_threads';
import { getDomainCatalog, runDomainOperation } from './operations';

try {
  const result = workerData?.mode === 'catalog' ? getDomainCatalog() : await runDomainOperation(workerData.input);
  parentPort?.postMessage({ ok: true, value: result });
} catch (error) {
  parentPort?.postMessage({ ok: false, error: error instanceof Error ? error.message : 'external_domain_error' });
}
