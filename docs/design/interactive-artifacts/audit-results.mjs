import { readFile, writeFile } from 'node:fs/promises';
const dir = new URL('./results/', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('manifest.json', dir), 'utf8'));
const diagnostic = JSON.parse(await readFile(new URL('diagram-data-diagnostic.json', dir), 'utf8'));
if (!manifest.runs.some(r => r.id === 'diagram-data-diagnostic')) manifest.runs.push({ id: 'diagram-data-diagnostic', status: diagnostic.status, durationMs: diagnostic.durationMs, attempt: 2, httpStatus: diagnostic.httpStatus });
manifest.requestCounts = { llm: 7, typesafe: 3, successfulLlmOutputs: 4, failedDiagramAttempts: 3 };
await writeFile(new URL('manifest.json', dir), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify({ counts: manifest.requestCounts, runs: manifest.runs.map(r => ({ id: r.id, status: r.status })) }));
