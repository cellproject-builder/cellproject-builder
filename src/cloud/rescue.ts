import { CloudRuntime, encodeBytes, sanitizeCloudDocument, sha256 } from './runtime';

/** An explicit partial rescue: never presented or accepted as a complete global backup. */
export async function captureSessionRescue(runtime: CloudRuntime) {
  const media = [];
  const missingMediaIds: string[] = [];
  for (const metadata of runtime.media()) {
    const bytes = runtime.cachedMedia(metadata.id);
    if (bytes && bytes.byteLength === metadata.size && await sha256(bytes) === metadata.sha256) media.push({ ...metadata, base64: encodeBytes(bytes) });
    else { media.push(metadata); missingMediaIds.push(metadata.id); }
  }
  return {
    format: 'cellproject-session-rescue', version: 1, exportedAt: new Date().toISOString(), complete: false,
    explanation: 'Resgate dos documentos atuais e arquivos já disponíveis nesta aba. Arquivos não disponíveis continuam identificados pelos metadados e IDs. Este pacote não substitui um backup global completo.',
    documents: runtime.documents().map(({ key, value }) => ({ key, value: sanitizeCloudDocument(key, value) })),
    media, missingMediaIds,
  };
}
export async function downloadSessionRescue(runtime: CloudRuntime) {
  const rescue = await captureSessionRescue(runtime);
  const url = URL.createObjectURL(new Blob([JSON.stringify(rescue)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = `dynamic-diary-resgate-${rescue.exportedAt.slice(0, 10)}.json`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return rescue;
}
