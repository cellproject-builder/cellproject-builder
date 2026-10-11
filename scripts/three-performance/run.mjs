import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import ts from 'typescript';

const fixture = path.dirname(fileURLToPath(import.meta.url));
const project = path.resolve(fixture, '../..');
const hash = value => createHash('sha256').update(value).digest('hex');
const args = process.argv.slice(2);
const options = { baseline: '', prepareOnly: false, off: false, serve: false, port: 5198 };
const help = 'node scripts/three-performance/run.mjs --baseline <commit-or-ref> [--prepare-only] [--off] [--serve] [--port 5198]';
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--help') { console.log(help); process.exit(0); }
  else if (arg === '--baseline') options.baseline = args[++i] ?? '';
  else if (arg === '--port') options.port = Number(args[++i]);
  else if (arg === '--prepare-only') options.prepareOnly = true;
  else if (arg === '--off') options.off = true;
  else if (arg === '--serve') options.serve = true;
  else throw new Error(`Unknown option: ${arg}\n${help}`);
}
if (!options.baseline) throw new Error(`An explicit baseline ref is required.\n${help}`);
if (!Number.isInteger(options.port) || options.port < 1024 || options.port > 65535 || [5190, 5197].includes(options.port)) throw new Error('Choose an unused port from 1024 to 65535, excluding the protected development/measurement ports 5190 and 5197.');
if (options.prepareOnly && options.serve) throw new Error('--prepare-only cannot serve an unbuilt fixture.');

function git(...args) {
  const result = spawnSync('git', args, { cwd: project, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`git ${args[0]} failed: ${result.stderr.trim()}`);
  return result.stdout;
}
const baselineRef = git('rev-parse', '--verify', '--end-of-options', `${options.baseline}^{commit}`).trim();
const candidateHead = git('rev-parse', 'HEAD').trim();
const run = path.join(project, '.codex-audit-three-repro', `${new Date().toISOString().replaceAll(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`);
fs.mkdirSync(path.join(run, 'fixture', 'no-env'), { recursive: true });
const textFiles = ['index.html', 'main.tsx', 'instrumentation.ts', 'style.css', 'unused-boundaries.ts', 'vite.config.ts', 'README.md'];
for (const file of textFiles) fs.copyFileSync(path.join(fixture, file), path.join(run, 'fixture', file));

// Freeze the complete local runtime dependency closure, including the compositor.
// Type-only imports are erased by Vite, and external packages use the installed lockfile.
const entry = 'src/visuals/rendering/VisualCanvasLayer.tsx';
const boundaries = new Set(['../media', '../decompositionState']);
function freeze(variant, read) {
  const pending = [entry], visited = new Map();
  function resolveLocal(from, specifier) {
    const base = specifier.startsWith('@/') ? `src/${specifier.slice(2)}` : path.posix.normalize(path.posix.join(path.posix.dirname(from), specifier));
    if (!base.startsWith('src/visuals/')) throw new Error(`Unsafe fixture dependency outside the visual module: ${from} -> ${specifier}`);
    for (const name of [base, ...['.ts', '.tsx', '.js', '.mjs', '.json', '/index.ts', '/index.tsx'].map(extension => base + extension)]) {
      const content = read(name);
      if (content !== null) return [name, content];
    }
    throw new Error(`Cannot resolve frozen dependency: ${from} -> ${specifier}`);
  }
  const contents = new Map();
  while (pending.length) {
    const file = pending.pop();
    if (visited.has(file)) continue;
    const content = contents.get(file) ?? read(file);
    if (content === null) throw new Error(`Missing source: ${variant}/${file}`);
    visited.set(file, hash(content));
    const destination = path.join(run, 'sources', variant, file);
    fs.mkdirSync(path.dirname(destination), { recursive: true }); fs.writeFileSync(destination, content);
    const ast = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true);
    const imports = [];
    for (const statement of ast.statements) {
      if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue;
      if (statement.isTypeOnly || statement.importClause?.isTypeOnly) continue;
      const bindings = statement.importClause?.namedBindings;
      if (!statement.importClause?.name && bindings && ts.isNamedImports(bindings) && bindings.elements.every(element => element.isTypeOnly)) continue;
      if (statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) imports.push(statement.moduleSpecifier.text);
    }
    function checkDynamic(node) {
      if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(node.expression) && node.expression.text === 'require')) throw new Error(`Dynamic imports/require need manual fixture review: ${file}`);
      ts.forEachChild(node, checkDynamic);
    }
    checkDynamic(ast);
    for (const specifier of imports) {
      if (file === entry && boundaries.has(specifier)) continue;
      if (!specifier.startsWith('.') && !specifier.startsWith('@/')) continue;
      const [dependency, value] = resolveLocal(file, specifier);
      contents.set(dependency, value); pending.push(dependency);
    }
  }
  return Object.fromEntries([...visited].sort(([a], [b]) => a.localeCompare(b)));
}
const baselineCache = new Map();
function readBaseline(file) {
  if (!baselineCache.has(file)) {
    const result = spawnSync('git', ['show', `${baselineRef}:${file}`], { cwd: project, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, windowsHide: true });
    if (result.error) throw result.error;
    baselineCache.set(file, result.status === 0 ? result.stdout : null);
  }
  return baselineCache.get(file);
}
const baseline = { label: baselineRef, sourceHashes: freeze('baseline', readBaseline) };
const candidate = { label: `worktree-${candidateHead}`, sourceHashes: freeze('candidate', file => {
  const location = path.join(project, file);
  return fs.existsSync(location) && fs.statSync(location).isFile() ? fs.readFileSync(location, 'utf8') : null;
}) };
const manifest = {
  preparedAt: new Date().toISOString(), baseline, candidate,
  lockfileSHA256: hash(fs.readFileSync(path.join(project, 'package-lock.json'))),
  fixtureHashes: Object.fromEntries(textFiles.map(file => [file, hash(fs.readFileSync(path.join(fixture, file)))])),
  nodeVersion: process.version, note: 'A new synthetic local experiment; not an exact replay of the historical measured browser conditions.',
};
fs.writeFileSync(path.join(run, 'preparation.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`Prepared isolated sources in ${run}`);
if (options.prepareOnly) process.exit(0);

const modes = options.off ? ['baseline-off', 'candidate-off'] : ['baseline', 'candidate'];
const config = path.join(run, 'fixture', 'vite.config.ts');
for (const mode of modes) {
  const result = spawnSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--config', config, '--mode', mode], { cwd: project, stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
  const assets = path.join(run, 'dist', mode, 'assets');
  const mapFile = fs.readdirSync(assets).find(file => file.endsWith('.js.map'));
  if (!mapFile) throw new Error(`No source map for ${mode}`);
  const map = JSON.parse(fs.readFileSync(path.join(assets, mapFile), 'utf8'));
  const sourceHashes = Object.fromEntries(map.sources.map((source, i) => [source, hash(map.sourcesContent[i] ?? '')]));
  if (map.sources.some(source => /\/src\/(?:store\.ts|workspace\/|cloud\/)|\/visuals\/(?:media|decompositionState)\.ts$/.test(source))) throw new Error(`Account/storage source unexpectedly included in ${mode}`);
  fs.writeFileSync(path.join(run, `${mode}-bundle.json`), JSON.stringify({ bundle: mapFile.slice(0, -4), sourceHashes }, null, 2) + '\n');
}
console.log(`Built ${modes.join(', ')}. Stop other CPU-heavy work before browser measurements.`);
if (!options.serve) { console.log(`Serve ${path.join(run, 'dist')} on an unused localhost port. Add --serve for a local server.`); process.exit(0); }

const root = path.join(run, 'dist');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.map': 'application/json' };
const server = http.createServer((request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
    const target = path.resolve(root, `.${pathname}`, pathname.endsWith('/') ? 'index.html' : '');
    if (!target.startsWith(root + path.sep) || !fs.existsSync(target) || !fs.statSync(target).isFile()) { response.writeHead(404); response.end('Not found'); return; }
    response.writeHead(200, { 'Content-Type': `${mime[path.extname(target)] ?? 'application/octet-stream'}; charset=utf-8`, 'Cache-Control': 'no-store' });
    fs.createReadStream(target).pipe(response);
  } catch { response.writeHead(400); response.end('Bad request'); }
});
server.on('error', error => { console.error(error.message); process.exitCode = 1; });
server.listen(options.port, '127.0.0.1', () => {
  for (const mode of modes) console.log(`http://127.0.0.1:${options.port}/${mode}/`);
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
