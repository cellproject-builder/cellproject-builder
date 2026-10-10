import { randomUUID } from 'node:crypto';
import { createLocalAccess } from './access.mjs';
import { createLimits, createMediaQueue } from './limits.mjs';
import { createReferenceRegistry } from './referenceRegistry.mjs';
import { reviewReference, reviewReferences, classifyPlanIntake } from './typesafe.mjs';
import { parseTargetTerms, parseTargets, selectBalancedImages } from './referenceMetadata.mjs';
import { fetchSpecificationDocuments, parseSpecificationSources } from './specDocuments.mjs';

function json(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(JSON.stringify(value));
}
async function readJson(req) {
  if (req.headers['content-type']?.split(';')[0] !== 'application/json') throw new Error('Invalid JSON request');
  if (Number(req.headers['content-length']) > 24 * 1024) throw new Error('Request too large');
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > 24 * 1024) throw new Error('Request too large'); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

// No environment access on import. Public deployments default to denied APIs.
export function createVisualHandler({ local = false, typesafeKey, authorize, referenceRegistry, publicFetch, fetchImpl, now = Date.now, allowedOrigins } = {}) {
  const access = authorize ?? (local ? createLocalAccess({ now, allowedOrigins }) : () => null);
  const registry = referenceRegistry ?? createReferenceRegistry({ publicFetch, now });
  const limits = createLimits(now);
  const mediaQueue = createMediaQueue();
  return async (req, res, next) => {
    const url = new URL(req.url ?? '/', 'http://local.invalid');
    if (!url.pathname.startsWith('/api/visuals/')) { if (next) next(); else { res.statusCode = 404; res.end(); } return; }
    const requestId = randomUUID();
    const fail = (status, code, message) => json(res, status, { error: { code, message, requestId } });
    const establish = url.pathname === '/api/visuals/capabilities';
    const accessId = access(req, res, establish);
    if (!accessId) { fail(403, 'forbidden', 'Visual APIs are available only in an authorized local session.'); return; }
    const controller = new AbortController();
    const cancel = () => { if (!res.writableEnded) controller.abort(); };
    req.on('aborted', cancel); res.on('close', cancel);
    let release, releaseMedia, releaseReview;
    try {
      if (establish && req.method === 'GET') { json(res, 200, { references: true, specifications: true, textualReview: Boolean(typesafeKey), reason: typesafeKey ? null : 'Textual review is not configured.' }); return; }
      if (url.pathname === '/api/visuals/media' && req.method === 'GET') {
        // Gallery thumbnails wait for bounded unpaid download slots (never paid review).
        releaseMedia = await mediaQueue.acquire(controller.signal);
        release = limits.enter('media', accessId);
        const media = await registry.media(url.searchParams.get('sessionId'), url.searchParams.get('candidateId'), accessId, controller.signal);
        res.writeHead(200, { 'content-type': media.mime, 'content-length': media.bytes.length, 'cache-control': 'private, max-age=300', 'x-content-type-options': 'nosniff', 'cross-origin-resource-policy': 'same-origin' }); res.end(media.bytes); return;
      }
      if (req.method !== 'POST') { fail(404, 'not_found', 'Unknown visual endpoint.'); return; }
      const input = await readJson(req);
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid request');
      if (url.pathname === '/api/visuals/plan-intake') {
        releaseReview = limits.enter('review', accessId);
        const classification = await classifyPlanIntake(input, { key: typesafeKey, fetchImpl, signal: controller.signal, now });
        json(res, 200, { status: classification ? 'classified' : 'not-configured', classification }); return;
      }
      if (url.pathname === '/api/visuals/specifications') {
        const sources = parseSpecificationSources(input.sources);
        release = limits.enter('resolve', accessId);
        const documents = await fetchSpecificationDocuments(sources, { publicFetch, now, signal: controller.signal });
        if (!documents.documents.length) { fail(422, 'specifications_unavailable', 'No readable specification documents were retrieved. Try official HTML documentation or a text-based PDF.'); return; }
        json(res, 200, documents); return;
      }
      if (url.pathname === '/api/visuals/reference-sessions') {
        if (typeof input.query !== 'string' || !input.query.trim() || input.query.length > 2000 || typeof input.context !== 'string' || Buffer.byteLength(input.context) > 8192 || !Array.isArray(input.sources) || input.sources.length > 6 || typeof input.projectId !== 'string' || typeof input.contextFingerprint !== 'string') throw new Error('Invalid search request');
        parseTargetTerms(input.targetTerms);
        parseTargets(input.targets);
        release = limits.enter('resolve', accessId);
        const session = await registry.create(input, accessId, controller.signal);
        session.review = { status: typesafeKey ? 'ranked' : 'not-configured', assessed: 0, removed: 0 };
        if (typesafeKey && session.candidates.length) {
          try {
            // One bounded paid batch per search, under the existing review limits.
            releaseReview = limits.enter('review', accessId);
            const reviews = await reviewReferences({ query: input.query, contextText: input.context, references: session.candidates }, { key: typesafeKey, fetchImpl, signal: controller.signal, now });
            controller.signal.throwIfAborted();
            for (const { id, assessment } of reviews) {
              const { candidate } = registry.get(session.sessionId, id, accessId);
              candidate.reference.assessment = assessment;
            }
            const kept = session.candidates.filter(reference => {
              const assessment = reference.assessment;
              // Preserve uncertain candidates; only confident irrelevance is removed.
              return !(assessment?.confidence >= .6 && assessment.probabilities['0'] + assessment.probabilities['1'] >= .8);
            });
            kept.sort((a, b) => b.assessment.score - a.assessment.score);
            session.review = { status: 'ranked', assessed: reviews.length, removed: session.candidates.length - kept.length };
            // Balance only retained candidates; a rejected object must not be
            // restored merely to fill its group. Target ownership stays local.
            session.candidates = selectBalancedImages(kept, {
              getTargets: reference => registry.get(session.sessionId, reference.id, accessId).candidate.metadata.matchedTargetIndexes ?? [],
            });
          } catch {
            controller.signal.throwIfAborted();
            session.review = { status: 'unavailable', assessed: 0, removed: 0 };
          } finally { releaseReview?.(); releaseReview = undefined; }
        }
        session.targetMatches = Object.fromEntries(session.candidates.map(reference => [reference.id, registry.get(session.sessionId, reference.id, accessId).candidate.metadata.matchedTargetIndexes ?? []]));
        json(res, 200, session); return;
      }
      if (url.pathname === '/api/visuals/review') {
        const { session, candidate } = registry.get(input.sessionId, input.candidateId, accessId);
        if (input.contextFingerprint !== session.contextFingerprint || input.projectId !== session.projectId) throw new Error('Reference context changed');
        if (candidate.reference.assessment) { json(res, 200, { candidateId: input.candidateId, assessment: candidate.reference.assessment }); return; }
        if (!typesafeKey) { json(res, 200, { candidateId: input.candidateId, assessment: null }); return; }
        release = limits.enter('review', accessId);
        const assessment = await reviewReference({ query: session.query, contextText: session.context, reference: candidate.reference }, { key: typesafeKey, fetchImpl, signal: controller.signal, now });
        registry.get(input.sessionId, input.candidateId, accessId);
        candidate.reference.assessment = assessment;
        json(res, 200, { candidateId: input.candidateId, assessment }); return;
      }
      fail(404, 'not_found', 'Unknown visual endpoint.');
    } catch (error) {
      if (res.writableEnded || res.destroyed) return;
      const limited = /limit/i.test(error?.message ?? '');
      fail(limited ? 429 : 400, limited ? 'limit_reached' : 'visual_request_failed', limited ? 'Visual request limit reached. Please try again later.' : 'The visual request could not be completed. Check the input, source access and gateway configuration.');
    } finally { release?.(); releaseMedia?.(); releaseReview?.(); req.off('aborted', cancel); res.off('close', cancel); }
  };
}
