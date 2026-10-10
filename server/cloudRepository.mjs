import { CloudError, unavailable, remoteJson, boundedResponseBytes, timeoutSignal } from './cloudUtils.mjs';
import { DOCUMENT_KEYS, MEDIA_LIMIT, IMPORT_LIMIT, documentValue, writeDocumentInput, importInput, stableId, operationId, mediaMetadata, mediaInput, hash } from './cloudValidation.mjs';

export function createCloudRepository({ config, fetchImpl = fetch } = {}) {
  const headers = session => ({ apikey: config.publishableKey, authorization: `Bearer ${session.accessToken}` });
  const request = async (session, path, init = {}) => {
    try { return await fetchImpl(`${config.supabaseUrl}${path}`, { ...init, headers: { ...headers(session), ...init.headers }, redirect: 'error', signal: timeoutSignal(init.signal, 60_000) }); } catch { throw unavailable(); }
  };
  const check = async response => {
    if (response.ok) return response;
    let data = {}; try { data = await remoteJson(response); } catch { /* Untrusted error payloads never reach the browser. */ }
    if (response.status === 409 || /(?:CELLPROJECT_)?CONFLICT|revision_conflict|operation_conflict|divergent/i.test(data.message ?? '')) throw new CloudError(409, 'revision_conflict', 'Remote data changed. Reload and resolve the conflict before saving.');
    if ([401, 403].includes(response.status)) throw new CloudError(403, 'cloud_forbidden', 'The cloud operation is not permitted.');
    if (response.status === 404) throw new CloudError(404, 'media_not_found', 'Media was not found.');
    if (response.status === 429) throw new CloudError(429, 'cloud_rate_limited', 'Too many requests. Please try again later.');
    if (/CELLPROJECT_LIMIT|quota[\s_].*exceed/i.test(data.message ?? '')) throw new CloudError(413, 'cloud_limit', 'Cloud storage limit reached.');
    throw unavailable();
  };
  const rpc = async (session, name, value, limit) => remoteJson(await check(await request(session, `/rest/v1/rpc/${name}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) })), limit);
  const storagePath = metadata => `/storage/v1/object/${config.bucket ?? 'cellproject-media'}/${metadata.path}`;
  const download = async (session, metadata) => {
    const expected = `${session.user.id}/${hash(metadata.id)}/${metadata.sha256}`;
    if (metadata.path !== expected) throw unavailable();
    const response = await check(await request(session, storagePath(metadata), { method: 'GET' }));
    const bytes = await boundedResponseBytes(response, MEDIA_LIMIT);
    if (bytes.length !== metadata.size || hash(bytes) !== metadata.sha256) throw unavailable();
    return bytes;
  };
  return {
    async snapshot(session) {
      const data = await rpc(session, 'cellproject_snapshot', {}, IMPORT_LIMIT * 2);
      if (!data || !Array.isArray(data.documents) || data.documents.length > DOCUMENT_KEYS.size || !Array.isArray(data.media) || data.media.length > 100_000) throw unavailable();
      const keys = new Set(); const mediaIds = new Set();
      try {
        for (const doc of data.documents) { documentValue(doc.key, doc.value); if (keys.has(doc.key) || !Number.isSafeInteger(doc.revision) || doc.revision < 1) throw unavailable(); keys.add(doc.key); }
        data.media = data.media.map(media => { const clean = mediaMetadata(media); if (mediaIds.has(clean.id)) throw unavailable(); mediaIds.add(clean.id); return clean; });
      } catch { throw unavailable(); }
      return { documents: data.documents.map(({ key, value, revision }) => ({ key, value, revision })), media: data.media };
    },
    async writeDocument(session, key, input) {
      const data = await rpc(session, 'cellproject_write_document', writeDocumentInput(key, input));
      if (!Number.isSafeInteger(data?.revision) || data.revision < 1) throw unavailable();
      return { revision: data.revision };
    },
    async importDocuments(session, input) {
      const payload = importInput(input); const data = await rpc(session, 'cellproject_import', payload);
      if (!data || !Array.isArray(data.documents) || data.documents.length !== payload.p_documents.length || data.documents.some(doc => !payload.p_documents.some(item => item.key === doc.key) || !Number.isSafeInteger(doc.revision) || doc.revision < 1) || new Set(data.documents.map(doc => doc.key)).size !== data.documents.length) throw unavailable();
      return { documents: data.documents.map(({ key, revision }) => ({ key, revision })) };
    },
    async writeMedia(session, input) {
      const { bytes, metadata, operationId } = mediaInput(input, session.user.id);
      const uploaded = await request(session, storagePath(metadata), { method: 'POST', headers: { 'content-type': metadata.mime, 'x-upsert': 'false', 'cache-control': 'private, no-store' }, body: bytes });
      if (!uploaded.ok && uploaded.status !== 409 && uploaded.status !== 400) await check(uploaded);
      else if (!uploaded.ok) {
        const error = await remoteJson(uploaded);
        if (!(uploaded.status === 409 || error.statusCode === '409' || error.error === 'Duplicate' || error.error === 'Asset Already Exists')) throw unavailable();
      } else await uploaded.body?.cancel();
      // Storage and SQL are separate services. Publish the catalog only after a full
      // authenticated readback; interrupted uploads may leave protected orphans.
      await download(session, metadata);
      const committed = await rpc(session, 'cellproject_write_media', { p_metadata: metadata, p_operation_id: operationId });
      if (committed?.id !== metadata.id || committed?.sha256 !== metadata.sha256 || committed?.size !== metadata.size) throw unavailable();
      return { id: metadata.id, sha256: metadata.sha256, size: metadata.size };
    },
    async readMedia(session, id) {
      stableId(id);
      const query = new URLSearchParams({ id: `eq.${id}`, owner_id: `eq.${session.user.id}`, select: 'id,mime,name,projectId:project_id,createdAt:created_at_ms,sha256,size,path', limit: '1' });
      const rows = await remoteJson(await check(await request(session, `/rest/v1/cellproject_media?${query}`)));
      if (!Array.isArray(rows) || !rows.length) throw new CloudError(404, 'media_not_found', 'Media was not found.');
      let metadata; try { metadata = mediaMetadata(rows[0], { path: true }); } catch { throw unavailable(); }
      if (metadata.id !== id) throw unavailable();
      return { ...metadata, bytes: await download(session, metadata) };
    },
    async deleteMedia(session, id, input) {
      stableId(id); operationId(input?.operationId);
      const result = await rpc(session, 'cellproject_delete_media', { p_id: id, p_operation_id: input.operationId });
      if (result?.deleted !== true) throw unavailable();
      // No eager Storage deletion: immutable bytes remain recoverable and are
      // collected separately after a retention period, outside the request path.
      return { deleted: true };
    },
  };
}
