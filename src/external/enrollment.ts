import { b64, wrapVaultDelegation, type VaultSession } from '@/cloud/vault/crypto';

export interface ExternalEnrollment { keyId: string; publicKey: JsonWebKey }
export interface ExternalCredentialMetadata {
  id: string; name: string; tokenPrefix: string; projects: '*' | string[];
  permissions: ('read' | 'write')[]; expiresAt: string; createdAt: string; revokedAt: string | null;
}
export interface EnrollmentOptions {
  session: VaultSession; recoveryKey: string; enrollment: ExternalEnrollment;
  name: string; projects: '*' | string[]; permissions: ('read' | 'write')[]; expiresAt: string;
  identity?: { id: string; token: string };
}
/** The token is shown once; only its SHA-256 digest is sent during registration. */
export async function prepareExternalCredential(options: EnrollmentOptions) {
  const id = options.identity?.id ?? crypto.randomUUID();
  const token = options.identity?.token ?? 'cp_' + b64(crypto.getRandomValues(new Uint8Array(32))).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
  if (!/^cp_[A-Za-z0-9_-]{43}$/.test(token)) throw new Error('Credencial inválida.');
  const tokenHash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))), byte => byte.toString(16).padStart(2, '0')).join('');
  const capsule = await wrapVaultDelegation(options.session, options.recoveryKey, options.enrollment.publicKey, options.enrollment.keyId, id);
  return { token, body: { id, name: options.name.trim(), tokenHash, tokenPrefix: token.slice(0, 11), projects: options.projects, permissions: options.permissions, expiresAt: options.expiresAt, vaultId: options.session.header.id, capsule } };
}
