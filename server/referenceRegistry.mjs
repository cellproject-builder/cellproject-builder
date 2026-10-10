import { randomUUID } from 'node:crypto';
import { fetchPublicHttps } from './publicHttps.mjs';
import { extractImageMetadata, commonsMetadata, parseTargetTerms, parseTargets, rankImageMetadata } from './referenceMetadata.mjs';
import { validateImageBytes } from './media.mjs';

export function createReferenceRegistry({ publicFetch = fetchPublicHttps, now = Date.now } = {}) {
  const sessions = new Map();
  const purge = () => { for (const [id, session] of sessions) if (session.expiresAt <= now()) sessions.delete(id); };
  const find = (sessionId, candidateId, accessId) => {
    purge(); const session = sessions.get(sessionId);
    const candidate = session?.candidates.get(candidateId);
    if (!session || session.accessId !== accessId || !candidate) throw new Error('Unknown or expired image reference');
    return { session, candidate };
  };
  return {
    async create(input, accessId, signal) {
      purge();
      if (sessions.size >= 100) throw new Error('Reference session limit reached');
      const options = { query: input.query, ...(input.targetTerms === undefined ? {} : { targetTerms: parseTargetTerms(input.targetTerms) }), ...(input.targets === undefined ? {} : { targets: parseTargets(input.targets) }) };
      const sessionId = randomUUID(), expiresAt = now() + 30 * 60_000;
      // Independent bounded public-HTTPS requests run together; one slow source
      // does not add its timeout to every other source's timeout.
      const pages = await Promise.allSettled((Array.isArray(input.sources) ? input.sources : []).slice(0, 6).map(async source => {
        signal?.throwIfAborted();
        if (!source || typeof source.url !== 'string') return [];
        const page = await publicFetch(source.url, { maxBytes: 1024 * 1024, signal });
        return extractImageMetadata(page, source, options);
      }));
      signal?.throwIfAborted();
      // Inaccessible pages are optional sources, never invented candidates.
      const found = pages.flatMap(result => result.status === 'fulfilled' ? result.value : []);
      let selected = rankImageMetadata(found, options);
      const covered = new Set(selected.flatMap(metadata => metadata.matchedTargetIndexes));
      const missing = options.targets
        ? options.targets.filter((_group, index) => !covered.has(index)).map(group => {
          // An explicit identifier already contained in the object name is not repeated.
          const present = text => text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
          const alias = group.aliases[0];
          return [alias, ...group.identifiers.filter(identifier => !present(alias).includes(present(identifier)))].join(' ').slice(0, 500);
        })
        : selected.length ? [] : [input.query.slice(0, 500)];
      if (missing.length) {
        const complements = new Array(missing.length), failures = [];
        let next = 0;
        // Each absent object has its own query; slow or failing complements do
        // not discard useful page results. At most eight queries, three in flight.
        await Promise.all(Array.from({ length: Math.min(3, missing.length) }, async () => {
          while (next < missing.length) {
            const index = next++;
            signal?.throwIfAborted();
            try {
              const url = new URL('https://commons.wikimedia.org/w/api.php');
              url.search = new URLSearchParams({ action: 'query', format: 'json', generator: 'search', gsrsearch: missing[index], gsrnamespace: '6', gsrlimit: '12', prop: 'imageinfo', iiprop: 'url|size|mime|extmetadata', iiurlwidth: '1280' }).toString();
              const page = await publicFetch(url.href, { maxBytes: 1024 * 1024, signal });
              signal?.throwIfAborted();
              if (page.mime !== 'application/json') throw new Error('Image search returned an unsupported response');
              complements[index] = commonsMetadata(JSON.parse(page.bytes.toString('utf8')));
            } catch (error) { signal?.throwIfAborted(); failures.push(error); }
          }
        }));
        signal?.throwIfAborted();
        if (!selected.length && failures.length === missing.length) throw failures[0];
        selected = rankImageMetadata([...found, ...complements.flatMap(images => images ?? [])], options);
      }
      signal?.throwIfAborted();
      const seen = new Set(), candidates = new Map();
      for (const metadata of selected) {
        if (seen.has(metadata.remoteUrl) || candidates.size >= 12) continue;
        seen.add(metadata.remoteUrl);
        const id = randomUUID();
        const reference = { id, title: metadata.title, description: metadata.description, sourcePageUrl: metadata.sourcePageUrl, credit: metadata.credit, license: metadata.license, width: metadata.width, height: metadata.height, sessionId, assessment: null, imageUrl: `/api/visuals/media?${new URLSearchParams({ sessionId, candidateId: id })}` };
        candidates.set(id, { metadata, reference });
      }
      sessions.set(sessionId, { accessId, projectId: input.projectId ?? '', query: input.query, contextFingerprint: input.contextFingerprint ?? '', context: input.context ?? '', expiresAt, candidates });
      return { sessionId, expiresAt, candidates: [...candidates.values()].map(item => item.reference) };
    },
    get(sessionId, candidateId, accessId) { return find(sessionId, candidateId, accessId); },
    async media(sessionId, candidateId, accessId, signal) {
      const { candidate } = find(sessionId, candidateId, accessId);
      const response = await publicFetch(candidate.metadata.remoteUrl, { maxBytes: 5 * 1024 * 1024, signal });
      find(sessionId, candidateId, accessId); signal?.throwIfAborted();
      return { mime: validateImageBytes(response.mime, response.bytes), bytes: response.bytes };
    },
  };
}
