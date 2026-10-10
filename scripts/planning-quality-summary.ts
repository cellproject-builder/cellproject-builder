import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readUsage, type AttemptRecord } from './planning-quality-core';

export function assistantText(responseText: string): string {
  const dataLines = responseText.split('\n').filter(line => line.startsWith('data:'));
  if (!dataLines.length) {
    try { return JSON.parse(responseText).choices?.[0]?.message?.content ?? ''; } catch { return ''; }
  }
  return dataLines.map(line => {
    try { return JSON.parse(line.slice(5).trim()).choices?.[0]?.delta?.content ?? ''; } catch { return ''; }
  }).join('');
}
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
const nodes = (object: any): any[] => object?.categorias?.flatMap((category: any) => category.children ?? []) ?? object?.nodes ?? [];

/** Technical extraction only. It never assigns semantic rubric scores. */
export async function summarizeQualityRun(directory: string) {
  const runPath = path.resolve(directory);
  const files = await readdir(runPath);
  const attempts = await Promise.all(files.filter(file => /^attempt-\d+\.json$/.test(file)).sort().map(async file => {
    const record = JSON.parse(await readFile(path.join(runPath, file), 'utf8')) as AttemptRecord & { requestSha256: string; responseSha256: string | null };
    const request = JSON.parse(record.requestText);
    const rawText = assistantText(record.responseText ?? '');
    let raw: any; try { raw = JSON.parse(rawText); } catch { raw = null; }
    const rawNodes = nodes(raw);
    const ids = [...(raw?.categorias ?? []), ...rawNodes].map(item => item.tempId).filter(Boolean);
    const duplicateIds = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
    const usage = readUsage(record.responseText ?? '');
    return {
      file, stage: record.stage, attempt: record.attempt, status: record.status ?? null, elapsedMs: record.elapsedMs ?? null,
      usage, originalRecordedUsage: record.usage ?? null, usageExtractionCorrected: JSON.stringify(usage) !== JSON.stringify(record.usage),
      requestHashMatches: sha256(record.requestText) === record.requestSha256,
      responseHashMatches: record.responseText === undefined ? null : sha256(record.responseText) === record.responseSha256,
      model: request.model, parameters: { max_tokens: request.max_tokens, temperature: request.temperature ?? null, reasoning: request.reasoning ?? null, stream: request.stream ?? false, response_format: request.response_format?.type ?? null },
      rawJSONParsed: raw !== null, rawNodeCount: rawNodes.length, duplicateIds,
      criteriaOver140Characters: rawNodes.filter(node => typeof node.comoConfirmar === 'string' && node.comoConfirmar.length > 140).map(node => ({ name: node.name, chars: node.comoConfirmar.length })),
      rawHintCount: rawNodes.reduce((total, node) => total + (node.groundTruthHints?.length ?? 0), 0),
    };
  }));
  const knownCost = attempts.filter(attempt => attempt.usage.costUsd !== null).reduce((sum, attempt) => sum + (attempt.usage.costUsd ?? 0), 0);
  const summary = {
    formatVersion: 1, generatedAt: new Date().toISOString(), purpose: 'Supplemental extraction from preserved raw evidence; no paid calls, no original files rewritten, no semantic scoring.',
    extractorHashes: {
      summary: sha256(await readFile(new URL('./planning-quality-summary.ts', import.meta.url), 'utf8')),
      usageParser: sha256(await readFile(new URL('./planning-quality-core.ts', import.meta.url), 'utf8')),
    },
    requests: attempts.length, actualCostUsd: attempts.every(attempt => attempt.usage.costUsd !== null) ? knownCost : null, reportedPartialCostUsd: knownCost,
    inputTokens: attempts.every(attempt => attempt.usage.inputTokens !== null) ? attempts.reduce((sum, attempt) => sum + (attempt.usage.inputTokens ?? 0), 0) : null,
    outputTokens: attempts.every(attempt => attempt.usage.outputTokens !== null) ? attempts.reduce((sum, attempt) => sum + (attempt.usage.outputTokens ?? 0), 0) : null,
    semanticEvaluation: 'manual review required; schema, string length, duplicate IDs and hash checks do not prove engineering correctness', attempts,
  };
  await writeFile(path.join(runPath, 'technical-summary.json'), JSON.stringify(summary, null, 2) + '\n', 'utf8');
  console.log(`Technical summary: ${attempts.length} requests; reported cost ${summary.actualCostUsd === null ? 'unknown (partial $' + knownCost.toFixed(6) + ')' : '$' + summary.actualCostUsd.toFixed(6)}`);
  return summary;
}
