import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { validateExternalMediaBytes } from './externalMediaValidation.mjs';
import { createMediaScopeResolver } from '../src/external/mediaOwnership.js';

const snapshot = state => ({ documents: [{ key:'cellproject-workspace',value:JSON.stringify({version:2,state}) }] });
const managed = (id, archivedId) => ({planner:{project:{id},...(archivedId?{archivedProject:{id:archivedId}}:{})}});

test('decoded PNG/JPEG/WebP originals pass with their real format and reject MIME substitutions',async()=>{
  for(const [format,mime] of [['png','image/png'],['jpeg','image/jpeg'],['webp','image/webp']]){
    const bytes=await sharp({create:{width:2,height:2,channels:3,background:'#427b4f'}}).toFormat(format).toBuffer();
    await validateExternalMediaBytes(bytes,mime);
    await assert.rejects(validateExternalMediaBytes(bytes,mime==='image/png'?'image/jpeg':'image/png'),error=>error.status===400);
    await assert.rejects(validateExternalMediaBytes(bytes.subarray(0,Math.ceil(bytes.length/2)),mime),error=>error.status===400);
  }
});
test('image decoding enforces the sixteen million pixel limit and PNG content integrity',async()=>{
  const oversized=await sharp({create:{width:4001,height:4000,channels:3,background:'#ffffff'}}).png().toBuffer();
  await assert.rejects(validateExternalMediaBytes(oversized,'image/png'),error=>error.status===400);
  const broken=Buffer.from([137,80,78,71,13,10,26,10,...Buffer.alloc(100)]);
  await assert.rejects(validateExternalMediaBytes(broken,'image/png'),error=>error.status===400);
});
test('all animated WebP frames are decoded before an original is accepted',async()=>{
  const frames=await Promise.all(['#ff0000','#0000ff'].map(background=>sharp({create:{width:32,height:32,channels:3,background}}).png().toBuffer()));
  const bytes=await sharp(frames,{join:{animated:true}}).webp({lossless:true}).toBuffer();
  assert.equal((await sharp(bytes).metadata()).pages,2);
  await validateExternalMediaBytes(bytes,'image/webp');
  const corrupt=Buffer.from(bytes),secondFrame=corrupt.indexOf('ANMF',corrupt.indexOf('ANMF')+4),lossless=corrupt.indexOf('VP8L',secondFrame);
  assert.ok(secondFrame>0&&lossless>secondFrame);corrupt[lossless+13]^=255;
  await assert.rejects(validateExternalMediaBytes(corrupt,'image/webp'),error=>error.status===400);
});
test('PDF originals require the UI PDF signature while text remains unexecuted data',async()=>{
  await validateExternalMediaBytes(Buffer.from('%PDF-1.7\n'), 'application/pdf');
  await assert.rejects(validateExternalMediaBytes(Buffer.from('Not a PDF'), 'application/pdf'),error=>error.status===400);
  await validateExternalMediaBytes(Buffer.from('Text source'), 'text/plain');
});

test('scope ownership includes unique archived plans and rejects duplicated or colliding plan aliases',()=>{
  const resolve=createMediaScopeResolver(snapshot({projects:{p1:managed('current1','archived1'),p2:managed('current2','shared'),p3:managed('shared')},notes:{},boards:{}}));
  for(const projectId of ['archived1','planner:archived1'])assert.equal(resolve({id:'m',projectId},'p1'),true);
  for(const owner of ['p1','p2','p3',null])for(const projectId of ['shared','planner:shared'])assert.equal(resolve({id:'m',projectId},owner),false);
  const collision=createMediaScopeResolver(snapshot({projects:{p1:managed('p2'),p2:managed('inner2')},notes:{},boards:{}}));
  assert.equal(collision({id:'m',projectId:'p2'},'p1'),false);assert.equal(collision({id:'m',projectId:'p2'},'p2'),false);
});
test('known owners cannot be overridden by forged references, account assets stay private, and unknown legacy scopes need unique explicit references',()=>{
  const p1=managed('inner1'),p2=managed('inner2');
  p1.planner.project.visuals={artifacts:[{mediaId:'known-other'},{mediaId:'legacy'},{mediaId:'account'}],description:'prose-only'};
  const resolve=createMediaScopeResolver(snapshot({projects:{p1,p2},boards:{board:{attachments:{resources:[{mediaId:'board-original'}]}}},notes:{own:{projectId:'p1'},other:{projectId:'p2'},personal:{projectId:null}}}));
  assert.equal(resolve({id:'known-other',projectId:'inner2'},'p1'),false);
  assert.equal(resolve({id:'legacy',projectId:'retired-unknown-plan'},'p1'),true);
  assert.equal(resolve({id:'prose-only',projectId:'unknown'},'p1'),false);
  assert.equal(resolve({id:'account'},'p1'),false);assert.equal(resolve({id:'account'},null),true);
  assert.equal(resolve({id:'board-original',projectId:'unknown'},null),true);assert.equal(resolve({id:'board-original',projectId:'unknown'},'p1'),false);
  assert.equal(resolve({id:'note',projectId:'note:other'},'p1'),false);assert.equal(resolve({id:'note',projectId:'note:personal'},null),true);
});
test('legacy reference ownership fails closed when a visual subtree exceeds the traversal budget',()=>{
  const p1=managed('inner1'),p2=managed('inner2');
  p1.planner.project.visuals={artifacts:[{mediaId:'legacy'}]};
  p2.planner.project.visuals={artifacts:[{mediaId:'legacy'},...Array.from({length:100000},()=>({}))]};
  const resolve=createMediaScopeResolver(snapshot({projects:{p1,p2}}));
  assert.equal(resolve({id:'legacy',projectId:'retired-unknown-plan'},'p1'),false);
  assert.equal(resolve({id:'known',projectId:'inner1'},'p1'),true);
});
