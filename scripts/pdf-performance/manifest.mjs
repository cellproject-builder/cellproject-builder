import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, relative } from 'node:path';

// Hash only explicit benchmark sources/assets; never inspect environment files.
const root = resolve(import.meta.dirname, '../..');
const digest = async path => createHash('sha256').update(await readFile(path)).digest('hex');
const sourceFiles = [
  'attachments/AttachmentPdfPage.tsx', 'attachments/CanvasResourcePreview.tsx',
  'attachments/CanvasAttachmentSurface.tsx', 'attachments/canvasDomain.ts', 'cloud/runtime.ts',
];
const sources = {};
for (const variant of ['baseline', 'candidate']) {
  const base = resolve(root, `.codex-audit-interaction/pdf-${variant}/src`);
  sources[variant] = Object.fromEntries(await Promise.all(sourceFiles.map(async path => [path, await digest(resolve(base, path))])));
  if (variant === 'candidate') sources[variant]['attachments/pdfThumbnailQueue.ts'] = await digest(resolve(base, 'attachments/pdfThumbnailQueue.ts'));
}
const assets = {};
async function walk(path) {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const file = resolve(path, entry.name);
    if (entry.isDirectory()) await walk(file);
    else assets[relative(resolve(root, '.codex-audit-interaction/pdf-dist'), file).replaceAll('\\', '/')] = await digest(file);
  }
}
await walk(resolve(root, '.codex-audit-interaction/pdf-dist'));
const fixture = Object.fromEntries(await Promise.all(['main.tsx', 'instrumentation.ts', 'pdf.ts', 'vite.config.ts', 'index.html'].map(async file => [file, await digest(resolve(import.meta.dirname, file))])));
const manifest = {
  baselineCommit: '2d2e20fccc93d23845bd12cc327a13008a75619f',
  candidateNote: 'Frozen rendering/lifecycle/import changes; cloud runtime was frozen before its cache change and is tested separately.',
  packageLockSha256: await digest(resolve(root, 'package-lock.json')), sources, fixture, assets,
};
await writeFile(resolve(root, 'docs/design/pdf-performance/build-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`Saved ${Object.keys(assets).length} asset hashes and source provenance.`);
