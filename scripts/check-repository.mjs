import { readFile, readdir, access } from 'node:fs/promises';
import { resolve, dirname, relative } from 'node:path';
import ts from 'typescript';

const root = resolve(import.meta.dirname, '..');
const errors = [], slash = value => value.replaceAll('\\', '/');
const exists = async file => access(file).then(() => true, () => false);
async function files(directory, filter) {
  if (!await exists(directory)) return [];
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (['node_modules', 'dist', '.git', 'new_design', 'preview'].includes(entry.name)) continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) output.push(...await files(path, filter));
    else if (filter(path)) output.push(path);
  }
  return output;
}

// Current, maintained navigation and module documentation. Historical evidence
// has its own protocol and is not silently rewritten by this check.
const docs = [
  'README.md', 'docs/README.md', 'docs/architecture.md', 'docs/repository-map.md', 'scripts/README.md',
  'docs/archive/README.md', 'docs/archive/early-concepts/README.md', 'docs/reports/README.md',
  'docs/pwa.md', 'docs/project-appearance.md',
  ...await files(resolve(root, 'docs/modules'), file => file.endsWith('.md')),
  ...await files(resolve(root, 'docs/research'), file => file.endsWith('.md')),
  'docs/reports/repository-review-2026-10-10.md',
].map(file => resolve(root, file));
let links = 0;
for (const file of docs) {
  if (!await exists(file)) { errors.push(`Missing document: ${slash(relative(root, file))}`); continue; }
  const text = (await readFile(file, 'utf8')).replace(/```[\s\S]*?```/g, '');
  for (const match of text.matchAll(/!?\[[^\]]*\]\((<[^>]+>|[^\s)]+)(?:\s+"[^"]*")?\)/g)) {
    const href = match[1].replace(/^<|>$/g, '');
    if (/^(?:[a-z][a-z\d+.-]*:|#|\/\/)/i.test(href)) continue;
    const path = decodeURIComponent(href.split(/[?#]/)[0]);
    if (!path) continue;
    links++;
    if (!await exists(resolve(dirname(file), path))) errors.push(`${slash(relative(root, file))}: missing target ${href}`);
  }
}
for (const file of ['vite.config.js', 'vite.config.d.ts']) {
  if (await exists(resolve(root, file))) errors.push(`Stale generated config at repository root: ${file}`);
}
const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
for (const name of ['dev', 'build', 'preview']) if (!pkg.scripts[name]?.includes('--config vite.config.ts')) errors.push(`${name} must select vite.config.ts explicitly`);
if (!(await readFile(resolve(root, 'vitest.config.ts'), 'utf8')).includes("from './vite.config.ts'")) errors.push('Vitest must import the TypeScript config explicitly');

const config = ts.readConfigFile(resolve(root, 'tsconfig.json'), ts.sys.readFile);
const options = ts.parseJsonConfigFileContent(config.config, ts.sys, root).options;
const sourceFiles = await files(resolve(root, 'src'), file => /\.(?:ts|tsx)$/.test(file) && !/\.test\.(?:ts|tsx)$/.test(file));
const graph = new Map();
for (const file of sourceFiles) {
  const source = ts.createSourceFile(file, await readFile(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const dependencies = [];
  function visit(node) {
    let specifier;
    if (ts.isImportDeclaration(node) && !node.importClause?.isTypeOnly) {
      const bindings = node.importClause?.namedBindings;
      const typesOnly = !node.importClause?.name && bindings && ts.isNamedImports(bindings) && bindings.elements.length > 0 && bindings.elements.every(item => item.isTypeOnly);
      if (!typesOnly) specifier = node.moduleSpecifier;
    } else if (ts.isExportDeclaration(node) && !node.isTypeOnly) {
      const bindings = node.exportClause;
      const typesOnly = bindings && ts.isNamedExports(bindings) && bindings.elements.length > 0 && bindings.elements.every(item => item.isTypeOnly);
      if (!typesOnly) specifier = node.moduleSpecifier;
    }
    else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) specifier = node.arguments[0];
    if (specifier && ts.isStringLiteral(specifier)) {
      const dependency = ts.resolveModuleName(specifier.text, file, options, ts.sys).resolvedModule?.resolvedFileName;
      if (dependency && !dependency.includes('/node_modules/') && !dependency.includes('\\node_modules\\')) dependencies.push(resolve(dependency));
    }
    ts.forEachChild(node, visit);
  }
  visit(source); graph.set(file, dependencies);
}
// These are reusable data/rendering contracts. Reject transitive links back to
// UI, navigation, provider orchestration or persistence before they spread.
const contracts = ['src/boards/model.ts', 'src/workspace/noteCanvasModel.ts', 'src/workspace/project-appearance/projectAppearance.ts', 'src/visuals/diagram/model.ts', 'src/visuals/rendering/modelItem.ts', 'src/graph/treeIndex.ts', 'src/graph/treeLayout.ts'];
for (const contract of contracts) {
  if (!graph.has(resolve(root, contract))) { errors.push(`Missing source contract: ${contract}`); continue; }
  const visited = new Set();
  function inspect(file, chain) {
    if (visited.has(file)) return; visited.add(file);
    const name = slash(relative(root, file));
    if (/^src\/(?:ai|cloud|chat|components|config)\//.test(name) || /^src\/(?:store|App|main)\./.test(name) || /^src\/workspace\/(?:store|Workspace|Projects)\./.test(name)) errors.push(`${contract}: forbidden dependency ${[...chain, name].join(' -> ')}`);
    for (const dependency of graph.get(file) ?? []) inspect(dependency, [...chain, name]);
  }
  inspect(resolve(root, contract), []);
}

console.log(`Repository check: ${docs.length} maintained documents, ${links} local links, ${contracts.length} transitive module boundaries.`);
if (errors.length) { errors.forEach(error => console.error(error)); process.exitCode = 1; }
else console.log('No broken local targets, stale root configs or forbidden contract dependencies found.');
