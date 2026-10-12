import {useChatStore} from '@/chat/store';
import {normalizeChatSession,normalizeInactiveSessions} from '@/chat/sessionHistory';
import {useKBStore} from '@/kb/store';
import type {KBDocument} from '@/kb/types';
import {KBSummarySchema} from '@/kb/schemas';
import {useLocaleStore} from '@/i18n';
import {initializeTheme,useThemeStore,type Theme} from '@/theme';
import {useSidebarStore} from '@/workspace/sidebarPreference';
import type {CloudDocument} from './runtime';

export const CONTENT_SYNC_KEYS=['dynamic_diary-chat','cellproject-kb','cellproject-locale','dynamic_diary-theme','dynamic_diary-sidebar-collapsed'] as const;
const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
function envelope(document:CloudDocument,version:number){const value=JSON.parse(document.value);if(!record(value)||!record(value.state)||value.version!==version)throw new Error('Documento remoto inválido.');return value.state;}
function validateKnowledge(value:Record<string,unknown>){
  if(!record(value.docs)||!record(value.pickCache)||!record(value.usage))throw new Error('Base remota inválida.');
  for(const [id,doc] of Object.entries(value.docs)){
    if(!record(doc)||doc.id!==id||typeof doc.filename!=='string'||typeof doc.extractedText!=='string'||typeof doc.fingerprint!=='string'||!Number.isFinite(doc.sizeBytes)||!Number.isFinite(doc.pageCount)||!Number.isFinite(doc.extractedAt)||!record(doc.summary)||!Array.isArray(doc.summary.fatos))throw new Error('Fonte remota inválida.');
    KBSummarySchema.parse({...doc.summary,autores:doc.summary.autores??null,fatos:doc.summary.fatos.map(fact=>{if(!record(fact))throw new Error('Fato remoto inválido.');return {...fact,valor:fact.valor??null};})});
  }
  return {docs:value.docs as Record<string,KBDocument>,pickCache:value.pickCache as ReturnType<typeof useKBStore.getState>['pickCache'],usage:value.usage as ReturnType<typeof useKBStore.getState>['usage']};
}

/** Validate the entire auxiliary transaction before canvas or content setters run. */
export function prepareRemoteContentDocuments(documents:readonly CloudDocument[]):()=>void{
  let chat:ReturnType<typeof useChatStore.getState>|undefined,knowledge:ReturnType<typeof validateKnowledge>|undefined,locale:'en'|'pt-BR'|undefined,theme:Theme|undefined,sidebar:boolean|undefined;
  for(const document of documents){
    if(document.key==='dynamic_diary-chat'){
      const local=useChatStore.getState();if(local.running||local.compacting)throw new Error('Conversa local em andamento.');
      const value=envelope(document,1);if(typeof value.sessionId!=='string'||!Array.isArray(value.messages)||!Array.isArray(value.modelHistory)||!Array.isArray(value.archivedSessions)||!record(value.rateLimits))throw new Error('Conversa remota inválida.');
      const remote=normalizeChatSession(value as unknown as Parameters<typeof normalizeChatSession>[0]);
      const inactive=normalizeInactiveSessions(value.archivedSessions as Parameters<typeof normalizeInactiveSessions>[0]);
      const selected=remote.sessionId===local.sessionId?remote:inactive.find(item=>item.sessionId===local.sessionId&&item.deletedAt==null);
      const next=selected?{...value,...selected,archivedSessions:normalizeInactiveSessions([remote,...inactive],selected.sessionId)}:value;
      const merge=useChatStore.persist.getOptions().merge;if(!merge)throw new Error('Leitura de conversa indisponível.');chat=merge(next,local);
    }else if(document.key==='cellproject-kb')knowledge=validateKnowledge(envelope(document,2));
    else if(document.key==='cellproject-locale'){const value=envelope(document,1).locale;if(value!=='en'&&value!=='pt-BR')throw new Error('Idioma remoto inválido.');locale=value;}
    else if(document.key==='dynamic_diary-theme'){if(!['oled','dark','light'].includes(document.value))throw new Error('Tema remoto inválido.');theme=document.value as Theme;}
    else if(document.key==='dynamic_diary-sidebar-collapsed'){if(!['true','false'].includes(document.value))throw new Error('Preferência remota inválida.');sidebar=document.value==='true';}
  }
  return ()=>{
    const chatStorage=chat?useChatStore.persist.getOptions().storage:undefined,knowledgeStorage=knowledge?useKBStore.persist.getOptions().storage:undefined,localeStorage=locale?useLocaleStore.persist.getOptions().storage:undefined;
    try{
      if(chatStorage)useChatStore.persist.setOptions({storage:{...chatStorage,setItem:()=>{}}});
      if(knowledgeStorage)useKBStore.persist.setOptions({storage:{...knowledgeStorage,setItem:()=>{}}});
      if(localeStorage)useLocaleStore.persist.setOptions({storage:{...localeStorage,setItem:()=>{}}});
      if(chat)useChatStore.setState(chat);
      if(knowledge)useKBStore.setState({...knowledge,lastContext:null});
      if(locale)useLocaleStore.setState({locale});
      if(theme){useThemeStore.setState({theme});initializeTheme();}
      if(sidebar!==undefined)useSidebarStore.setState({collapsed:sidebar});
    }finally{
      if(chatStorage)useChatStore.persist.setOptions({storage:chatStorage});
      if(knowledgeStorage)useKBStore.persist.setOptions({storage:knowledgeStorage});
      if(localeStorage)useLocaleStore.persist.setOptions({storage:localeStorage});
    }
  };
}
