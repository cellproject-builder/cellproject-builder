import { build } from 'esbuild';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export async function buildExternalWorker() {
  await build({ absWorkingDir: root, entryPoints: ['src/cloud/backupValidation.ts'], outfile: 'dist-server/backup-validation.mjs', bundle: true, platform: 'node', format: 'esm', target: 'node22', logLevel: 'silent' });
  const result = await build({
    absWorkingDir: root, entryPoints: ['src/external/domain/entry.ts'], outfile: 'dist-server/external-domain.mjs',
    bundle: true, platform: 'node', format: 'esm', target: 'node22', sourcemap: false, metafile: true, logLevel: 'silent',
    alias: {
      '@/cloud/storage': resolve(root, 'src/external/domain/memoryStorage.ts'),
      '@/data/workspaceRepository': resolve(root, 'src/external/domain/memoryStorage.ts'),
      '@/cloud/runtime': resolve(root, 'src/external/domain/memoryRuntime.ts'),
      '@/kb/extract': resolve(root, 'src/external/domain/disabledExtraction.ts'),
    },
  });
  const usedInputs = Object.entries(result.metafile.outputs).flatMap(([, output]) => Object.entries(output.inputs).filter(([, input]) => input.bytesInOutput > 0).map(([path]) => path));
  const forbidden = usedInputs.filter(path => /(?:ai\/(?:service|plannerTools|workspaceTools|noteTools|visualTools)|node_modules\/(?:ai|@ai-sdk|@openrouter)|cloud\/(?:runtime|vault)\.|idb-keyval|pdfjs-dist)/.test(path.replaceAll('\\', '/')));
  if (forbidden.length) throw new Error(`External domain bundle includes forbidden runtime dependencies: ${forbidden.join(', ')}`);
  return { path: resolve(root, 'dist-server/external-domain.mjs'), inputs: Object.keys(result.metafile.inputs) };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await buildExternalWorker();
  process.stdout.write('External domain worker built.\n');
}
