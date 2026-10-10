/** Laboratory boundary, not a general-purpose hostile-code runtime.
 * CSP restricts subresources/connect; it does not bound CPU or prevent all self-navigation.
 */
export function createIsolatedDocument(runtime: string, nonce: string) {
  if (!/^[a-zA-Z0-9]{6,80}$/.test(nonce)) throw new Error('Invalid script nonce');
  const policy = `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'; object-src 'none'`;
  return `<!doctype html><html lang="pt-BR"><head><meta name="color-scheme" content="dark"><meta http-equiv="Content-Security-Policy" content="${policy}"><style>:root{color-scheme:dark}html,body,#root{margin:0;width:100%;height:100%;background:transparent;color:#e8e1ef;font:14px system-ui;box-sizing:border-box}*{box-sizing:border-box}button,input{font:inherit}input{accent-color:#bba2ed}</style></head><body><div id="root"></div><script nonce="${nonce}">window.addEventListener('error',()=>parent.postMessage({type:'lab-error'},'*'));${runtime.replace(/<\/script/gi, '<\\/script')}</script></body></html>`;
}
export function classifyFrameMessage(source: unknown, frame: unknown, origin: string, raw: unknown): { type: 'error' } | { type: 'select'; nodeId: string } | null {
  if (!source || source !== frame || origin !== 'null' || !raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const data = raw as Record<string, unknown>;
  if (Object.keys(data).length === 1 && data.type === 'lab-error') return { type: 'error' };
  if (Object.keys(data).length === 2 && data.type === 'lab-node' && typeof data.nodeId === 'string' && ['servo', 'test'].includes(data.nodeId)) return { type: 'select', nodeId: data.nodeId };
  return null;
}
