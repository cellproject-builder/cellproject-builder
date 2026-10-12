import {useEffect,useRef,useState} from 'react';
import {cloudJson,getCloudRuntime,mutationHeaders} from '@/cloud/runtime';
import {getVaultSession} from '@/cloud/vault/privacy';
import {readDeviceRecovery} from '@/cloud/vault/deviceKeys';
import {useWorkspaceStore} from '@/workspace/store';
import {prepareExternalCredential,type ExternalCredentialMetadata,type ExternalEnrollment} from './enrollment';

interface AccessState {enabled:boolean;credentials:ExternalCredentialMetadata[]}
interface PendingIdentity {id:string;token:string;name:string;projects:'*'|string[];permissions:('read'|'write')[];expiresAt:string}
export function ExternalAccessPanel(){
  const projects=useWorkspaceStore(state=>state.projects),activeProjectId=useWorkspaceStore(state=>state.activeProjectId);
  const [access,setAccess]=useState<AccessState|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[name,setName]=useState('Meu runtime');
  const [scope,setScope]=useState(activeProjectId??Object.keys(projects)[0]??''),[write,setWrite]=useState(true),[days,setDays]=useState(30),[secret,setSecret]=useState('');
  const pending=useRef<PendingIdentity|null>(null),mounted=useRef(true);
  useEffect(()=>{mounted.current=true;void cloudJson<AccessState>('/api/integrations/external').then(value=>{if(mounted.current)setAccess(value);}).catch(reason=>{if(mounted.current)setError(reason instanceof Error?reason.message:'Falha ao consultar integrações.');});return()=>{mounted.current=false;pending.current=null;};},[]);
  const refresh=async()=>{const next=await cloudJson<AccessState>('/api/integrations/external');if(mounted.current)setAccess(next);};
  const create=async()=>{
    setError('');setBusy(true);setSecret('');
    try{
      const session=getVaultSession(),runtime=getCloudRuntime();
      if(!session||!runtime)throw new Error('Desbloqueie o cofre para conceder acesso ao runtime.');
      const current=()=>{if(!mounted.current||getVaultSession()!==session||getCloudRuntime()!==runtime)throw new Error('A sessão mudou. Abra novamente as integrações.');};
      await runtime.flush();current();
      const status=runtime.getSnapshot();if(status.pending||status.issue)throw new Error('Sincronize as alterações pendentes antes de conceder acesso.');
      const recoveryKey=await readDeviceRecovery(session);current();
      if(!recoveryKey)throw new Error('Este navegador ainda não tem a recuperação protegida do cofre. Use um navegador com recuperação configurada para conceder acesso.');
      const enrollment=await cloudJson<ExternalEnrollment>('/api/integrations/external/enrollment');current();
      const identity=pending.current;
      const prepared=await prepareExternalCredential({session,recoveryKey,enrollment,name:identity?.name??name,projects:identity?.projects??(scope==='*'?'*':[scope]),permissions:identity?.permissions??(write?['read','write']:['read']),expiresAt:identity?.expiresAt??new Date(Date.now()+days*86400000).toISOString(),...(identity?{identity}:{} )});current();
      pending.current={id:prepared.body.id,token:prepared.token,name:prepared.body.name,projects:prepared.body.projects,permissions:prepared.body.permissions,expiresAt:prepared.body.expiresAt};
      await cloudJson('/api/integrations/external/credentials',{method:'POST',headers:mutationHeaders,body:JSON.stringify(prepared.body)});current();
      setSecret(prepared.token);pending.current=null;await refresh();
    }catch(reason){if(mounted.current)setError(reason instanceof Error?reason.message:'Falha ao criar acesso.');}
    finally{if(mounted.current)setBusy(false);}
  };
  const revoke=async(credential:ExternalCredentialMetadata)=>{
    setBusy(true);setError('');try{await cloudJson('/api/integrations/external/credentials/'+encodeURIComponent(credential.id),{method:'DELETE',headers:mutationHeaders});await refresh();}catch(reason){if(mounted.current)setError(reason instanceof Error?reason.message:'Falha ao revogar acesso.');}finally{if(mounted.current)setBusy(false);}
  };
  const discard=async()=>{
    const identity=pending.current;if(!identity)return;
    setBusy(true);setError('');
    try{await cloudJson('/api/integrations/external/credentials/'+encodeURIComponent(identity.id),{method:'DELETE',headers:mutationHeaders});pending.current=null;await refresh();}
    catch(reason){if(mounted.current)setError(reason instanceof Error?reason.message:'Não foi possível cancelar a concessão. Tente novamente.');}
    finally{if(mounted.current)setBusy(false);}
  };
  return <details className="mt-5 border-t border-border-base pt-4">
    <summary className="cursor-pointer text-control font-semibold text-text-primary">API e MCP</summary>
    <div className="mt-3 flex flex-col gap-3 text-control">
      <p className="text-text-secondary">Conecte um runtime externo para operar seus projetos com a própria inteligência.</p>
      {!access&&!error&&<p role="status">Consultando integrações…</p>}
      {access&&!access.enabled&&<p className="text-text-secondary">O acesso externo precisa ser configurado no servidor.</p>}
      {access?.enabled&&<>
        <form className="flex flex-col gap-3" onSubmit={event=>{event.preventDefault();void create();}}>
          <label>Nome do acesso<input className="field mt-1" maxLength={100} value={name} disabled={busy||!!pending.current} onChange={event=>setName(event.target.value)} autoComplete="off"/></label>
          <label>Projetos permitidos<select className="field mt-1" value={scope} disabled={busy||!!pending.current} onChange={event=>setScope(event.target.value)}><option value="" disabled>Escolha um projeto</option>{Object.values(projects).map(project=><option key={project.id} value={project.id}>{project.name}</option>)}<option value="*">Todos os projetos, incluindo novos</option></select></label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={write} disabled={busy||!!pending.current} onChange={event=>setWrite(event.target.checked)}/>Permitir alterações</label>
          <label>Validade<select className="field mt-1" value={days} disabled={busy||!!pending.current} onChange={event=>setDays(Number(event.target.value))}>{[7,30,90,365].map(value=><option key={value} value={value}>{value} dias</option>)}</select></label>
          <p className="text-text-secondary">Ao criar o acesso, você permite que o servidor abra os dados do cofre necessários às operações concedidas. O armazenamento continua cifrado.</p>
          <button className="btn btn-primary" disabled={busy||!name.trim()||!scope} type="submit">{busy?'Aguarde…':pending.current?'Tentar novamente':'Criar acesso'}</button>
          {pending.current&&!busy&&<button type="button" className="btn" onClick={()=>void discard()}>Cancelar concessão pendente</button>}
        </form>
        {secret&&<div role="status" className="rounded-lg border border-border-base p-3 flex flex-col gap-2"><p>Copie agora. A chave será exibida somente nesta tela.</p><input className="field font-mono min-w-0" aria-label="Chave de acesso criada" readOnly value={secret} autoComplete="off" spellCheck={false}/><button type="button" className="btn" onClick={()=>{void navigator.clipboard.writeText(secret).catch(()=>setError('Selecione a chave e copie manualmente.'));}}>Copiar chave</button><button type="button" className="btn" onClick={()=>setSecret('')}>Ocultar chave</button></div>}
        <p className="text-text-secondary break-all">API: {typeof window!=='undefined'?window.location.origin:''}/api/v1</p>
        <ul className="flex flex-col gap-2">{access.credentials.map(credential=><li key={credential.id} className="rounded-lg border border-border-base p-3"><div className="flex items-center justify-between gap-2"><span className="font-semibold break-words min-w-0">{credential.name}</span>{!credential.revokedAt&&<button type="button" className="btn shrink-0" aria-label={'Revogar '+credential.name} disabled={busy} onClick={()=>void revoke(credential)}>Revogar</button>}</div><p className="text-text-secondary">{credential.revokedAt?'Revogado':Date.parse(credential.expiresAt)<=Date.now()?'Expirado':'Válido até '+new Date(credential.expiresAt).toLocaleDateString()} · {credential.permissions.includes('write')?'Leitura e alterações':'Somente leitura'}</p><p className="text-text-secondary">{credential.projects==='*'?'Todos os projetos':credential.projects.map(id=>projects[id]?.name??id).join(', ')}</p></li>)}</ul>
      </>}
      {error&&<p role="alert" className="text-state-problem">{error}</p>}
    </div>
  </details>;
}
