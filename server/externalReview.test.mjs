import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { executeExternalMedia } from './externalMedia.mjs';
import { sealVaultMedia } from './externalVault.mjs';
import { hash } from './cloudValidation.mjs';
import { runExternalOperation } from './externalWorker.mjs';
import { buildExternalWorker } from '../scripts/build-external-worker.mjs';
import { executeExternalBackup, createExternalBackupHeader } from './externalBackup.mjs';

const ownerId='11111111-1111-4111-8111-111111111111',vaultId='22222222-2222-4222-8222-222222222222',blobId='33333333-3333-4333-8333-333333333333';
const credential={id:'44444444-4444-4444-8444-444444444444',ownerId,vaultId,projects:['managed-project'],permissions:['read','write']};
const rawKey=randomBytes(32);
const workspace={version:2,state:{projects:{'managed-project':{id:'managed-project',planner:{project:{id:'ui-plan'}}}}}};
const empty=()=>({snapshot:{documents:[{key:'cellproject-workspace',value:JSON.stringify(workspace),revision:1}],media:[]},files:{}});

for(const storageScope of ['ui-plan','planner:ui-plan'])test(`review: project media read includes UI originals stored under ${storageScope}`,async()=>{
  const bytes=Buffer.from('Existing UI original'),encrypted=Buffer.from(JSON.stringify(sealVaultMedia(rawKey,ownerId,vaultId,blobId,bytes)));
  const manifest=empty();
  manifest.snapshot.media.push({id:'ui-original',name:'original.txt',mime:'text/plain',projectId:storageScope,size:bytes.length,sha256:hash(bytes)});
  manifest.files['ui-original']={blobId,size:encrypted.length,sha256:hash(encrypted)};
  const repository={readBlob:async()=>encrypted};
  const result=await executeExternalMedia({repository,credential,manifest,rawKey,projectId:'managed-project',operation:{kind:'query',name:'media.read',input:{id:'ui-original'}}});
  assert.equal(result.result.base64,bytes.toString('base64'));
});

test('review: external image upload preserves the UI image signature gate',async()=>{
  const bytes=Buffer.from('This is not PNG data');let writes=0;
  const repository={writeBlob:async()=>{writes++;}};
  await assert.rejects(executeExternalMedia({repository,credential,manifest:empty(),rawKey,projectId:'managed-project',operation:{kind:'action',name:'media.put',input:{id:'broken-image',name:'broken.png',mime:'image/png',base64:bytes.toString('base64'),sha256:hash(bytes)}}}));
  assert.equal(writes,0);
});

for(const [storageScope,projectId] of [['note:owned-note','managed-project'],['notebook:owned-note','managed-project'],['board:owned-board',null]])test(`review: media resolves UI document scope ${storageScope}`,async()=>{
  const manifest=empty(),state=JSON.parse(manifest.snapshot.documents[0].value);
  state.state.notes={'owned-note':{id:'owned-note',projectId:'managed-project'}};
  state.state.boards={'owned-board':{id:'owned-board'}};
  manifest.snapshot.documents[0].value=JSON.stringify(state);
  manifest.snapshot.media.push({id:'document-file',name:'original.txt',mime:'text/plain',projectId:storageScope,size:1,sha256:'a'.repeat(64)});
  manifest.files['document-file']={blobId,size:48,sha256:'b'.repeat(64)};
  const result=await executeExternalMedia({repository:{},credential:{...credential,projects:'*'},manifest,rawKey,projectId:projectId??undefined,operation:{kind:'query',name:projectId?'media.list':'personal_media.list',input:{}}});
  assert.deepEqual(result.result.items.map(item=>item.id),['document-file']);
});

test('review: project plaintext quota is checked before encrypted upload',async()=>{
  const manifest=empty();let writes=0;
  for(let index=0;index<5;index++){
    const id=`existing-${index}`;manifest.snapshot.media.push({id,name:'existing.txt',mime:'text/plain',projectId:'managed-project',size:10*1024*1024,sha256:'a'.repeat(64)});
    manifest.files[id]={blobId,size:48,sha256:'b'.repeat(64)};
  }
  const bytes=Buffer.from('one byte beyond quota');
  await assert.rejects(executeExternalMedia({repository:{writeBlob:async()=>{writes++;}},credential,manifest,rawKey,projectId:'managed-project',operation:{kind:'action',name:'media.put',input:{id:'overflow',name:'overflow.txt',mime:'text/plain',base64:bytes.toString('base64'),sha256:hash(bytes)}}}));
  assert.equal(writes,0);
});

test('review: shared UI failures expose a bounded machine code, never error prose',async()=>{
  await buildExternalWorker();
  const prefix='data:image/png;base64,',bodySize=Math.floor((2*1024*1024-prefix.length)/4)*4;
  const src=prefix+'iVBORw0KGgoA'+'A'.repeat(bodySize-12);
  const document={version:1,items:[0,1,2].map(index=>({id:`image-${index}`,kind:'image',x:0,y:0,width:100,height:100,src,label:'Evidence'})),edges:[],viewport:{x:0,y:0,zoom:1}};
  const board=(id,document)=>({id,title:id,document,archived:false,createdAt:1,updatedAt:1});
  const state={projects:{},tasks:{},comments:{},sprints:{},notes:{},folders:{},legacyImported:true,boards:{first:board('first',document),second:board('second',document),third:board('third',{...document,items:[]})}};
  const snapshot={documents:[{key:'cellproject-workspace',value:JSON.stringify({version:2,state}),revision:1}],media:[]};
  await assert.rejects(runExternalOperation({snapshot,operation:{kind:'action',name:'board.document.set',input:{id:'third',document}}}),error=>{
    assert.match(error.code,/^[A-Za-z][A-Za-z0-9_]{0,79}$/);
    assert.doesNotMatch(error.code,/imagens|dados originais|workspace\./);
    return true;
  });
});

test('review: a valid vault below the 96 MiB manifest ceiling is not rejected by a smaller worker input limit',async()=>{
  // These unused, valid persisted envelopes model a large vault. A projects
  // query must not need to parse account content or drop it to fit a smaller cap.
  const value=JSON.stringify({version:1,state:{padding:'x'.repeat(31*1024*1024)}});
  const snapshot={documents:['dynamic_diary-chat','cellproject-kb','cellproject-config'].map(key=>({key,value,revision:1})),media:[]};
  assert.ok(Buffer.byteLength(JSON.stringify({snapshot,files:{}}))<96*1024*1024);
  const output=await runExternalOperation({snapshot,operation:{kind:'query',name:'projects',input:{}}});
  assert.equal(output.result.items.length,0);
  assert.deepEqual(output.snapshot.documents.map(doc=>[doc.key,doc.value.length,doc.revision]),snapshot.documents.map(doc=>[doc.key,doc.value.length,doc.revision]));
});

function stagedDocumentFixture() {
  const grant={...credential,projects:'*'},blobs=new Map(),reads=[];
  const manifest={snapshot:{documents:[],media:[]},files:{}};
  const repository={
    async writeBlob(c,input){assert.equal(input.accountOperation,true);assert.equal(input.projectId,null);blobs.set(input.id,{ownerId:c.ownerId,bytes:Buffer.from(input.base64,'base64')});},
    async readBlob(c,input){reads.push(c.ownerId);const blob=blobs.get(input.id);if(!blob||blob.ownerId!==c.ownerId)throw Error('PRIVATE_OWNER_STORAGE_DETAIL');return Buffer.from(blob.bytes);},
  };
  const call=(name,input,current=manifest,c=grant)=>executeExternalBackup({repository,credential:c,manifest:current,rawKey,operation:{kind:'action',name,input}});
  const stage=async(key,bytes)=>{const output=await call('backup.document.stage',{key,base64:bytes.toString('base64'),sha256:hash(bytes)});assert.deepEqual(output.manifest,manifest);const {key:ignored,...part}=output.result;assert.equal(ignored,key);return part;};
  return {grant,manifest,blobs,reads,call,stage};
}
test('review: staged documents reconstruct split UTF-8 and preserve inline archive property order',async()=>{
  const f=stagedDocumentFixture(),key='cellproject-kb',value=JSON.stringify({version:1,state:{text:'Evidence Ω🚀'}}),bytes=Buffer.from(value);
  const split=bytes.indexOf(Buffer.from('Ω'))+1,parts=[await f.stage(key,bytes.subarray(0,split)),await f.stage(key,bytes.subarray(split))];
  const documents=[{value:'dark',key:'dynamic_diary-theme'},{key,value}],header=await createExternalBackupHeader(documents,[],5);
  const imported=await f.call('backup.import',{...header,documents:[documents[0],{key,parts,sha256:hash(bytes),size:bytes.length}],media:[]});
  assert.deepEqual(imported.manifest.snapshot.documents.map(({key,value})=>({key,value})),[{key:'dynamic_diary-theme',value:'dark'},{key,value}]);
  assert.deepEqual(imported.manifest.snapshot.media,[]);assert.deepEqual(imported.manifest.files,{});
  const diverged={snapshot:{documents:[{key,value:'{"version":1,"state":{"text":"Keep existing"}}',revision:3}],media:[]},files:{}};
  await assert.rejects(f.call('backup.import',{...header,documents:[documents[0],{key,parts,sha256:hash(bytes),size:bytes.length}],media:[]},diverged),error=>error.status===409);
});
test('review: reordered, duplicated, invalid UTF-8 and foreign-owner document chunks cannot publish',async()=>{
  const f=stagedDocumentFixture(),key='dynamic_diary-theme',bytes=Buffer.from('lightdark'),parts=[await f.stage(key,bytes.subarray(0,5)),await f.stage(key,bytes.subarray(5))];
  const header=await createExternalBackupHeader([{key,value:bytes.toString()}],[],5);
  const input=parts=>({...header,documents:[{key,parts,sha256:hash(bytes),size:bytes.length}],media:[]});
  for(const bad of [[...parts].reverse(),[parts[0],parts[0]]])await assert.rejects(f.call('backup.import',input(bad)),error=>[400,502].includes(error.status));
  const invalid=Buffer.from([0xc3,0x28]),invalidPart=await f.stage(key,invalid),invalidHeader=await createExternalBackupHeader([{key,value:invalid.toString('utf8')}],[],5);
  await assert.rejects(f.call('backup.import',{...invalidHeader,documents:[{key,parts:[invalidPart],sha256:hash(invalid),size:invalid.length}],media:[]}),error=>[400,502].includes(error.status));
  const other={...f.grant,ownerId:'55555555-5555-4555-8555-555555555555'};
  await assert.rejects(f.call('backup.import',input(parts),f.manifest,other),error=>[403,502].includes(error.status)&&!error.message.includes('PRIVATE_OWNER_STORAGE_DETAIL'));
  assert.deepEqual(f.manifest,{snapshot:{documents:[],media:[]},files:{}});
});
test('review: declared staged document and chunk quotas reject before blob reads',async()=>{
  const f=stagedDocumentFixture(),key='dynamic_diary-theme',bytes=Buffer.from('light'),part=await f.stage(key,bytes),header=await createExternalBackupHeader([{key,value:'light'}],[],5);
  for(const document of [{key,parts:[{...part,size:8*1024*1024+1}],sha256:hash(bytes),size:bytes.length},{key,parts:[part],sha256:hash(bytes),size:32*1024*1024+1},{key,parts:Array.from({length:5},()=>({...part,size:8*1024*1024})),sha256:hash(bytes),size:32*1024*1024}]){
    await assert.rejects(f.call('backup.import',{...header,documents:[document],media:[]}),error=>[400,413].includes(error.status));
  }
  assert.deepEqual(f.reads,[]);
});
