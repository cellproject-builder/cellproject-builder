import { createHash } from 'node:crypto';
import { CloudError, invalid, readJson, sendJson } from './cloudUtils.mjs';
import { documentValue, stableId } from './cloudValidation.mjs';
import { createExternalRepository } from './externalRepository.mjs';
import { createEnrollmentKeys, sealDelegatedKey, openDelegatedKey, openVaultManifest, sealVaultManifest, sealReceipt, openReceipt, fingerprintExternalRequest } from './externalVault.mjs';
import { runExternalOperation, getExternalCatalog } from './externalWorker.mjs';
import { externalMediaCatalog, executeExternalMedia } from './externalMedia.mjs';
import { externalBackupCatalog, executeExternalBackup } from './externalBackup.mjs';

const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
const denied = () => new CloudError(403, 'scope_forbidden', 'This credential does not grant the requested operation.');
function exact(value, allowed, required=[]) {
  if (!value || typeof value!=='object' || Array.isArray(value) || Object.keys(value).some(key=>!allowed.includes(key)) || required.some(key=>!Object.hasOwn(value,key))) throw invalid();
}
function binding(credential) { return {ownerId:credential.ownerId,vaultId:credential.vaultId,credentialId:credential.id}; }
const publicOperationCode = value => typeof value==='string'&&/^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(value)?value:'operation_rejected';
function workspace(snapshot) {
  const doc=snapshot.documents.find(item=>item.key==='cellproject-workspace');
  if(!doc)return {projects:{}};
  try { const state=JSON.parse(doc.value).state;if(!state?.projects||typeof state.projects!=='object'||Array.isArray(state.projects))throw Error();return state; } catch { throw new CloudError(409,'workspace_invalid','The workspace must be repaired before external access.'); }
}
function assertScope(credential,entry,projectId,snapshot) {
  if (!credential.permissions.includes(entry.permission)) throw denied();
  const scope=entry.scope??(entry.projectRequired?'project':entry.name==='projects'?'projects-list':'account');
  if(scope==='project') {
    stableId(projectId);
    if(credential.projects!=='*'&&!credential.projects.includes(projectId))throw denied();
    if(!Object.hasOwn(workspace(snapshot).projects,projectId))throw new CloudError(404,'project_not_found','Project not found.');
  } else {
    if(projectId!==undefined)throw invalid('This operation does not accept a project ID.');
    if(scope==='account'&&credential.projects!=='*')throw denied();
  }
  return {projectId:scope==='project'?projectId:null,accountOperation:scope==='account'};
}
function scopedDiscovery(snapshot,credential) {
  if(credential.projects==='*')return snapshot;
  return {...snapshot,documents:snapshot.documents.map(doc=>{
    if(doc.key!=='cellproject-workspace')return doc;
    const envelope=JSON.parse(doc.value);envelope.state.projects=Object.fromEntries(Object.entries(envelope.state.projects).filter(([id])=>credential.projects.includes(id)));
    return {...doc,value:JSON.stringify(envelope)};
  })};
}
function revisedSnapshot(before,after,mediaOperation=false) {
  if(!after||!Array.isArray(after.documents)||!Array.isArray(after.media)||!mediaOperation&&JSON.stringify(after.media)!==JSON.stringify(before.media))throw invalid('Invalid domain snapshot.');
  const previous=new Map(before.documents.map(doc=>[doc.key,doc]));const seen=new Set();
  const documents=after.documents.map(doc=>{
    if(seen.has(doc.key))throw invalid();seen.add(doc.key);documentValue(doc.key,doc.value);
    const old=previous.get(doc.key);return {key:doc.key,value:doc.value,revision:(old?.revision??0)+(old?.value===doc.value?0:1)};
  });
  if(before.documents.some(doc=>!seen.has(doc.key)))throw invalid('Domain operations cannot drop unrelated documents.');
  return {documents,media:mediaOperation?after.media:before.media};
}

export function createExternalApi({config,repository,runOperation=runExternalOperation,getCatalog=async()=>[...await getExternalCatalog(),...externalMediaCatalog,...externalBackupCatalog],vaultRepository,fetchImpl=fetch}={}) {
  repository??=createExternalRepository({config,fetchImpl});
  let enrollmentPromise;
  let pending=0;const perCredential=new Map();
  const enabled=()=>Boolean(config?.enabled&&config?.vaultEnabled&&config?.externalApiEnabled&&config?.externalApiKey&&config?.externalEncryptionKey);
  function available(){if(!enabled())throw new CloudError(503,'external_api_not_configured','External API access is not configured.');}
  async function authenticate(req) {
    available();
    if(req.headers.host!==new URL(config.origin).host)throw new CloudError(421,'host_forbidden','This host is not configured for the application.');
    if(req.headers.origin&&req.headers.origin!==config.origin||req.headers['sec-fetch-site']==='cross-site')throw new CloudError(403,'origin_forbidden','This request origin is not permitted.');
    const match=/^Bearer (cp_[A-Za-z0-9_-]{43})$/.exec(req.headers.authorization??'');
    if(!match)throw new CloudError(401,'authentication_required','A dedicated API bearer credential is required.');
    const credential=await repository.authenticate(createHash('sha256').update(match[1]).digest('hex'));
    if(!credential)throw new CloudError(401,'invalid_credential','The credential is invalid, expired or revoked.');
    return credential;
  }
  async function handle(req,res,route) {
    const credential=await authenticate(req);
    const count=perCredential.get(credential.id)??0;
    if(pending>=2||count>=2)throw new CloudError(429,'external_api_busy','Too many concurrent external operations.');
    pending++;perCredential.set(credential.id,count+1);
    let raw;
    try {
      const catalog=await getCatalog();
      if(route==='/api/v1/capabilities'&&req.method==='GET') {
        if(!credential.permissions.includes('read'))throw denied();
        const head=await repository.snapshot(credential);sendJson(res,200,{version:1,revision:head.revision,catalog});return;
      }
      const kind=route==='/api/v1/query'&&req.method==='POST'?'query':route==='/api/v1/actions'&&req.method==='POST'?'action':null;
      if(!kind)throw new CloudError(404,'not_found','External endpoint not found.');
      const body=await readJson(req,16*1024*1024);
      exact(body,kind==='query'?['name','input','projectId']:['name','input','projectId','operationId','baseRevision'],kind==='query'?['name']:['name','operationId','baseRevision']);
      if(typeof body.name!=='string'||body.name.length>100)throw invalid();
      if(body.input!==undefined&&(!body.input||typeof body.input!=='object'||Array.isArray(body.input)))throw invalid();
      if(kind==='action'&&(!uuid(body.operationId)||!Number.isSafeInteger(body.baseRevision)||body.baseRevision<1))throw invalid('A UUID operation ID and a current vault revision are required.');
      const entry=catalog.find(item=>item.name===body.name&&item.kind===kind);
      if(!entry)throw new CloudError(404,'unknown_operation','Unknown external operation.');
      // Scope is checked before plaintext is exposed to the worker, and again by SQL at commit.
      if(!credential.permissions.includes(entry.permission))throw denied();
      const scope=entry.scope??(entry.projectRequired?'project':entry.name==='projects'?'projects-list':'account');
      if(scope==='project'&&credential.projects!=='*'&&!credential.projects.includes(body.projectId)||scope==='account'&&credential.projects!=='*')throw denied();
      raw=await openDelegatedKey(credential.sealedKey,binding(credential),config.externalEncryptionKey);
      const fingerprint=kind==='action'?fingerprintExternalRequest(body,config.externalEncryptionKey):null;
      const operationScope={projectId:scope==='project'?body.projectId:null,accountOperation:scope==='account'};
      if(kind==='action') {
        const replay=await repository.replay(credential,{operationId:body.operationId,fingerprint,...operationScope});
        if(replay){const saved=await openReceipt(raw,binding(credential),body.operationId,replay.receipt);sendJson(res,200,{...saved,replayed:true});return;}
      }
      const head=await repository.snapshot(credential);
      if(head.header.id!==credential.vaultId)throw new CloudError(409,'vault_changed','Re-enroll this credential for the current vault.');
      if(kind==='action'&&body.baseRevision!==head.revision)throw new CloudError(409,'vault_revision_conflict','Read the current revision before retrying the operation.');
      const manifest=await openVaultManifest(raw,credential.ownerId,head);
      assertScope(credential,entry,body.projectId,manifest.snapshot);
      const snapshot=scope==='projects-list'?scopedDiscovery(manifest.snapshot,credential):manifest.snapshot;
      let output,nextManifest;
      const mediaOperation=externalMediaCatalog.some(item=>item.name===body.name&&item.kind===kind);
      const backupOperation=externalBackupCatalog.some(item=>item.name===body.name&&item.kind===kind);
      try{
        if(mediaOperation||backupOperation){const execute=backupOperation?executeExternalBackup:executeExternalMedia;const data=await execute({repository,credential,manifest,rawKey:raw,operation:{kind,name:body.name,input:body.input??{}},projectId:body.projectId});output={result:data.result,snapshot:data.manifest.snapshot};nextManifest=data.manifest;}
        else output=await runOperation({snapshot,projectId:body.projectId,operation:{kind,name:body.name,input:body.input??{}}});
      }
      catch(error){if(error instanceof CloudError)throw error;throw new CloudError(error?.status===409?409:400,publicOperationCode(error?.code),'The operation was rejected by the project rules.');}
      if(kind==='query'){sendJson(res,200,{revision:head.revision,result:output.result});return;}
      const next={...(nextManifest??manifest),snapshot:revisedSnapshot(manifest.snapshot,output.snapshot,mediaOperation||backupOperation)};
      const response={revision:head.revision+1,result:output.result};
      const encrypted=await sealVaultManifest(raw,credential.ownerId,credential.vaultId,response.revision,next);
      const receipt=await sealReceipt(raw,binding(credential),body.operationId,response);
      const committed=await repository.commit(credential,{operationId:body.operationId,fingerprint,baseRevision:head.revision,manifest:encrypted,receipt,...operationScope});
      if(committed.replayed){const saved=await openReceipt(raw,binding(credential),body.operationId,committed.receipt);sendJson(res,200,{...saved,replayed:true});return;}
      sendJson(res,200,{...response,revision:committed.revision,replayed:false});
    } finally {raw?.fill(0);pending--;const left=(perCredential.get(credential.id)??1)-1;if(left)perCredential.set(credential.id,left);else perCredential.delete(credential.id);}
  }
  async function manage(req,res,session,route) {
    if(route==='/api/integrations/external'&&req.method==='GET') {
      if(!enabled()){sendJson(res,200,{enabled:false,credentials:[]});return;}
      sendJson(res,200,{enabled:true,credentials:await repository.list(session)});return;
    }
    available();
    if(route==='/api/integrations/external/enrollment'&&req.method==='GET') {
      enrollmentPromise??=createEnrollmentKeys();const enrollment=await enrollmentPromise;
      sendJson(res,200,{keyId:enrollment.keyId,publicKey:enrollment.publicKey});return;
    }
    if(route==='/api/integrations/external/credentials'&&req.method==='POST') {
      const body=await readJson(req,16384);
      exact(body,['id','name','tokenHash','tokenPrefix','projects','permissions','expiresAt','vaultId','capsule'],['id','name','tokenHash','tokenPrefix','projects','permissions','expiresAt','vaultId','capsule']);
      if(!uuid(body.id)||!uuid(body.vaultId)||typeof body.tokenHash!=='string'||!/^[a-f0-9]{64}$/.test(body.tokenHash)||typeof body.name!=='string'||body.name.trim().length<1||body.name.length>100||!/^cp_[A-Za-z0-9_-]{8}$/.test(body.tokenPrefix))throw invalid();
      if(body.projects!=='*'&&(!Array.isArray(body.projects)||body.projects.length<1||body.projects.length>100||new Set(body.projects).size!==body.projects.length))throw invalid();
      if(body.projects!=='*')body.projects.forEach(stableId);
      if(!Array.isArray(body.permissions)||!body.permissions.includes('read')||body.permissions.some(value=>!['read','write'].includes(value))||new Set(body.permissions).size!==body.permissions.length)throw invalid();
      const expiry=Date.parse(body.expiresAt);if(typeof body.expiresAt!=='string'||!Number.isFinite(expiry)||expiry<=Date.now()||expiry>Date.now()+366*86400000)throw invalid('Credential expiration must be within one year.');
      enrollmentPromise??=createEnrollmentKeys();const enrollment=await enrollmentPromise;
      const key=await enrollment.unwrapEnrollment(body.capsule,{ownerId:session.user.id,vaultId:body.vaultId,credentialId:body.id});
      try {
        const head=await vaultRepository.get(session);if(!head||head.vault===null||head.header?.id!==body.vaultId)throw invalid('The vault changed. Reload before enrolling.');
        const manifest=await openVaultManifest(key,session.user.id,head);
        if(body.projects!=='*'&&body.projects.some(id=>!Object.hasOwn(workspace(manifest.snapshot).projects,id)))throw invalid('Unknown project grant.');
        const {capsule:_capsule,...metadata}=body;
        const sealedKey=await sealDelegatedKey(key,{ownerId:session.user.id,vaultId:body.vaultId,credentialId:body.id},config.externalEncryptionKey);
        sendJson(res,201,await repository.enrollment(session,{...metadata,name:body.name.trim(),sealedKey}));return;
      } finally {key.fill(0);}
    }
    const revoke=/^\/api\/integrations\/external\/credentials\/([a-f0-9-]{36})$/.exec(route);
    if(revoke&&req.method==='DELETE'){if(!uuid(revoke[1]))throw invalid();await repository.revoke(session,revoke[1]);sendJson(res,200,{revoked:true});return;}
    throw new CloudError(404,'not_found','Integration endpoint not found.');
  }
  return {handle,manage,close(){void enrollmentPromise?.then(value=>value.close());}};
}
