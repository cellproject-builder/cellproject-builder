import { describe, expect, it } from 'vitest';
import { createVault, unb64 } from '@/cloud/vault/crypto';
import { prepareExternalCredential } from './enrollment';

describe('external credential enrollment',()=>{
  it('wraps a vault capability to the enrollment server without exporting the active key or recovery secret',async()=>{
    const {session,recoveryKey}=await createVault('owner','a strong test-only passphrase');
    const pair=await crypto.subtle.generateKey({name:'RSA-OAEP',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['encrypt','decrypt']);
    const publicKey=await crypto.subtle.exportKey('jwk',pair.publicKey),keyId=crypto.randomUUID();
    const prepared=await prepareExternalCredential({session,recoveryKey,enrollment:{keyId,publicKey},name:'Runtime',projects:['p1'],permissions:['read','write'],expiresAt:new Date(Date.now()+86400000).toISOString()});
    expect(prepared.token).toMatch(/^cp_[A-Za-z0-9_-]{43}$/);expect(JSON.stringify(prepared.body)).not.toContain(prepared.token);expect(JSON.stringify(prepared.body)).not.toContain(recoveryKey);
    expect(prepared.body.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    const label=new TextEncoder().encode(JSON.stringify(['cellproject-external-enrollment',1,session.ownerId,session.header.id,prepared.body.id,keyId]));
    const raw=await crypto.subtle.decrypt({name:'RSA-OAEP',label},pair.privateKey,unb64(prepared.body.capsule.data));
    const key=await crypto.subtle.importKey('raw',raw,'AES-GCM',false,['decrypt']);const probe=await session.seal('proof','external-test');
    const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(probe.iv),additionalData:new TextEncoder().encode(JSON.stringify(['dynamic-diary-vault',1,'owner',session.header.id,'external-test']))},key,unb64(probe.data));
    expect(new TextDecoder().decode(plain)).toBe('proof');expect(session.deviceKeyForStorage().extractable).toBe(false);new Uint8Array(raw).fill(0);session.dispose();
  });
  it('rejects an unrelated recovery secret and preserves the credential identity when preparing a retry',async()=>{
    const {session,recoveryKey}=await createVault('owner','a strong test-only passphrase');
    const pair=await crypto.subtle.generateKey({name:'RSA-OAEP',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['encrypt','decrypt']);
    const enrollment={keyId:crypto.randomUUID(),publicKey:await crypto.subtle.exportKey('jwk',pair.publicKey)};
    const options={session,recoveryKey,enrollment,name:'Runtime',projects:'*' as const,permissions:['read' as const],expiresAt:new Date(Date.now()+86400000).toISOString()};
    await expect(prepareExternalCredential({...options,recoveryKey:'00'.repeat(32)})).rejects.toThrow();
    const first=await prepareExternalCredential(options),retry=await prepareExternalCredential({...options,identity:{id:first.body.id,token:first.token}});
    expect(retry.body.id).toBe(first.body.id);expect(retry.body.tokenHash).toBe(first.body.tokenHash);expect(retry.token).toBe(first.token);session.dispose();
  });
});
