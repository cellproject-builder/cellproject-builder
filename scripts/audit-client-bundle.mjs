import { build } from 'vite';
import { gzipSync } from 'node:zlib';
import { writeFile } from 'node:fs/promises';

// Inspect the actual production graph, including shared chunks. A lazy import
// alone is not proof that another static path hasn't pulled the feature in.
const result = await build({ configFile: 'vite.config.ts', build: { write: false }, logLevel: 'warn' });
const output = (Array.isArray(result) ? result : [result]).flatMap(item => item.output);
const chunks = new Map(output.filter(item => item.type === 'chunk').map(item => [item.fileName, item]));
function closure(seeds) {
  const seen = new Set();
  const visit = name => { if (seen.has(name)) return; const chunk = chunks.get(name); if (!chunk) return; seen.add(name); chunk.imports.forEach(visit); };
  seeds.forEach(visit);
  return [...seen].sort();
}
const boot = [...chunks.values()].filter(chunk => chunk.isEntry).map(chunk => chunk.fileName);
const app = [...chunks.values()].filter(chunk => Object.keys(chunk.modules).some(name => name.replaceAll('\\', '/').endsWith('/src/App.tsx'))).map(chunk => chunk.fileName);
if (!boot.length || !app.length) throw new Error('Application entries were not found in the production build.');
const application = closure([...boot, ...app]);
const modules = application.flatMap(name => Object.keys(chunks.get(name).modules)).map(name => name.replaceAll('\\', '/'));
const forbidden = modules.filter(name => /\/src\/boards\/(BoardCanvas|BoardComposer|BoardModelPreview)\.tsx$|\/src\/visuals\/rendering\/VisualCanvasLayer\.tsx$|\/src\/kb\/extract\.ts$/.test(name));
const report = {
  application: { chunks: application, bytes: application.reduce((total, name) => total + Buffer.byteLength(chunks.get(name).code), 0), gzipBytes: application.reduce((total, name) => total + gzipSync(chunks.get(name).code).length, 0) },
  eagerFeatureModules: forbidden.map(name => name.slice(name.lastIndexOf('/src/') + 1)),
  chunks: [...chunks.values()].map(chunk => ({ file: chunk.fileName, bytes: Buffer.byteLength(chunk.code), gzipBytes: gzipSync(chunk.code).length, imports: chunk.imports, dynamicImports: chunk.dynamicImports })),
};
console.log(JSON.stringify({ application: report.application, eagerFeatureModules: report.eagerFeatureModules }, null, 2));
const destination = process.argv.indexOf('--output');
if (destination !== -1) await writeFile(process.argv[destination + 1], JSON.stringify(report, null, 2) + '\n');
if (process.argv.includes('--check') && forbidden.length) {
  console.error('Heavy feature modules must be loaded on demand:', report.eagerFeatureModules.join(', '));
  process.exitCode = 1;
}
