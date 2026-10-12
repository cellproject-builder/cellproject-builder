import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createExternalApi } from './externalApi.mjs';
import { sealDelegatedKey, sealVaultManifest, openVaultManifest } from './externalVault.mjs';
import { CloudError, sendError } from './cloudUtils.mjs';

const ownerId = '11111111-1111-4111-8111-111111111111', vaultId = '22222222-2222-4222-8222-222222222222';
const token = 'cp_' + Buffer.alloc(32, 4).toString('base64url');
const tokenHash = createHash('sha256').update(token).digest('hex');
const header={format:'dynamic-diary-vault',version:1,id:vaultId,kdf:{name:'PBKDF2',hash:'SHA-256',iterations:600000,salt:Buffer.alloc(16).toString('base64')},password:{v:1,iv:Buffer.alloc(12).toString('base64'),data:Buffer.alloc(48).toString('base64')},recovery:{v:1,iv:Buffer.alloc(12).toString('base64'),data:Buffer.alloc(48).toString('base64')}};
const catalog = [
  {name:'projects',kind:'query',description:'Projects',inputSchema:{type:'object',additionalProperties:false},permission:'read',projectRequired:false,scope:'projects-list'},
  {name:'project',kind:'query',description:'Project',inputSchema:{type:'object',additionalProperties:false},permission:'read',projectRequired:true,scope:'project'},
  {name:'task.create',kind:'action',description:'Create task',inputSchema:{type:'object'},permission:'write',projectRequired:true,scope:'project'},
  {name:'project.create',kind:'action',description:'Create project',inputSchema:{type:'object'},permission:'write',projectRequired:false,scope:'account'},
];
async function setup(fn, {projects=['p1'],permissions=['read','write'],workerFailure}={}) {
  const encryptionKey = randomBytes(32).toString('base64'), rawKey = randomBytes(32);
  const binding = {ownerId,vaultId,credentialId:randomUUID()};
  const credential = {id:binding.credentialId,ownerId,vaultId,projects,permissions,sealedKey:await sealDelegatedKey(rawKey,binding,encryptionKey)};
  let revision=1, revoked=false, commits=0, executions=0;
  let manifest={snapshot:{documents:[{key:'cellproject-workspace',revision:1,value:JSON.stringify({version:2,state:{projects:{p1:{id:'p1',name:'Authorized'},p2:{id:'p2',name:'Secret'}},tasks:[],notes:[],sprints:[],boards:[]}})}],media:[]},files:{}};
  let cipher=await sealVaultManifest(rawKey,ownerId,vaultId,revision,manifest);
  const receipts=new Map();
  const repo={
    authenticate:async hash=>{if(revoked||hash!==tokenHash)throw new CloudError(401,'invalid_credential','Invalid credential.');return credential;},
    snapshot:async()=>({header,revision,manifest:cipher}),
    replay:async(_c,input)=>{const old=receipts.get(input.operationId);if(old&&old.fingerprint!==input.fingerprint)throw new CloudError(409,'operation_conflict','Operation conflict.');return old??null;},
    commit:async(_c,input)=>{if(revoked)throw new CloudError(401,'invalid_credential','Invalid credential.');if(input.baseRevision!==revision)throw new CloudError(409,'vault_revision_conflict','Revision conflict.');commits++;revision++;cipher=input.manifest;manifest=await openVaultManifest(rawKey,ownerId,{header,revision,manifest:cipher});const receipt={fingerprint:input.fingerprint,receipt:input.receipt,revision};receipts.set(input.operationId,receipt);return {revision,replayed:false};},
  };
  let origin;
  const api=createExternalApi({config:{enabled:true,vaultEnabled:true,externalApiEnabled:true,externalApiKey:'server-only',externalEncryptionKey:encryptionKey,get origin(){return origin;}},repository:repo,getCatalog:async()=>catalog,runOperation:async request=>{
    executions++; if(workerFailure)throw workerFailure;
    if(request.operation.name==='projects')return {result:Object.values(JSON.parse(request.snapshot.documents[0].value).state.projects),snapshot:request.snapshot};
    if(request.operation.kind==='query')return {result:{id:request.projectId},snapshot:manifest.snapshot};
    const snapshot=structuredClone(request.snapshot),doc=snapshot.documents[0],data=JSON.parse(doc.value);data.state.tasks.push({id:'t1',projectId:request.projectId,title:request.operation.input.title});doc.value=JSON.stringify(data);return {result:{id:'t1'},snapshot};
  }});
  const server=createServer((req,res)=>api.handle(req,res,req.url).catch(error=>sendError(res,error)));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin=`http://127.0.0.1:${server.address().port}`;
  const call=(path,body,headers={})=>fetch(origin+path,{method:body?'POST':'GET',headers:{authorization:'Bearer '+token,...(body?{'content-type':'application/json'}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})});
  try{await fn({call,repo,credential,rawKey,manifest,counts:()=>({commits,executions}),revoke:()=>{revoked=true;},api});}finally{api.close();await new Promise(resolve=>server.close(resolve));rawKey.fill(0);}
}
test('dedicated bearer authentication rejects cookies and foreign origins',async()=>setup(async({call})=>{
  assert.equal((await call('/api/v1/capabilities',null,{authorization:'',cookie:'test=valid'})).status,401);
  assert.equal((await call('/api/v1/capabilities',null,{origin:'https://evil.example'})).status,403);
  const response=await call('/api/v1/capabilities');assert.equal(response.status,200);assert.equal((await response.json()).catalog.length,4);
}));
test('queries filter project discovery and reject out-of-scope resources before domain execution',async()=>setup(async({call,counts})=>{
  assert.deepEqual((await (await call('/api/v1/query',{name:'projects'})).json()).result,[{id:'p1',name:'Authorized'}]);
  const before=counts();assert.equal((await call('/api/v1/query',{name:'project',projectId:'p2'})).status,403);assert.deepEqual(counts(),before);
  assert.equal((await call('/api/v1/actions',{name:'project.create',operationId:randomUUID(),baseRevision:1,input:{name:'New'}})).status,403);
}));
test('mutation preserves unrelated content and increments changed document revisions once; retry returns durable receipt',async()=>setup(async({call,counts,repo,credential,rawKey})=>{
  const body={name:'task.create',projectId:'p1',input:{title:'From external runtime'},operationId:randomUUID(),baseRevision:1};
  const first=await call('/api/v1/actions',body);assert.equal(first.status,200);assert.equal((await first.json()).revision,2);
  const retry=await call('/api/v1/actions',body);assert.equal(retry.status,200);assert.equal((await retry.json()).replayed,true);assert.deepEqual(counts(),{commits:1,executions:1});
  const saved=await openVaultManifest(rawKey,ownerId,await repo.snapshot(credential));assert.equal(saved.snapshot.documents[0].revision,2);assert.equal(JSON.parse(saved.snapshot.documents[0].value).state.projects.p2.name,'Secret');
  assert.equal((await call('/api/v1/actions',{...body,input:{title:'Changed'}})).status,409);
}));
test('stale revisions, read-only credentials and revoked credentials cannot mutate',async()=>{
  await setup(async({call,counts,revoke})=>{const body={name:'task.create',projectId:'p1',input:{title:'X'},operationId:randomUUID(),baseRevision:2};assert.equal((await call('/api/v1/actions',body)).status,409);assert.deepEqual(counts(),{commits:0,executions:0});revoke();assert.equal((await call('/api/v1/capabilities')).status,401);});
  await setup(async({call,counts})=>{assert.equal((await call('/api/v1/actions',{name:'task.create',projectId:'p1',input:{title:'X'},operationId:randomUUID(),baseRevision:1})).status,403);assert.equal(counts().commits,0);},{permissions:['read']});
});
test('unknown actions and malformed envelopes cannot route to internal AI or a raw state writer',async()=>setup(async({call,counts})=>{
  for(const name of ['ai.generate','setState','https://example.com'])assert.equal((await call('/api/v1/actions',{name,operationId:randomUUID(),baseRevision:1})).status,404);
  assert.equal((await call('/api/v1/query',{name:'project',projectId:'p1',rawState:{}})).status,400);assert.deepEqual(counts(),{commits:0,executions:0});
}));

test('unexpected domain exceptions cannot expose prose or validation payloads as a public error code',async()=>{
  const failure=Object.assign(new Error('Private workspace name in a validation issue'),{code:'Private workspace name in a validation issue'});
  await setup(async({call,counts})=>{
    const response=await call('/api/v1/actions',{name:'task.create',projectId:'p1',input:{title:'X'},operationId:randomUUID(),baseRevision:1});
    assert.equal(response.status,400);const body=await response.json();
    assert.equal(body.error.code,'operation_rejected');assert.doesNotMatch(JSON.stringify(body),/Private workspace/);assert.equal(counts().commits,0);
  },{workerFailure:failure});
});
