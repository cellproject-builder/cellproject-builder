import {beforeEach,expect,it,vi} from 'vitest';
import {useChatStore} from '@/chat/store';
import {useKBStore} from '@/kb/store';
import {prepareRemoteContentDocuments} from './remoteContent';
import type {CloudDocument} from './runtime';
const conversation=(id:string,text:string)=>({sessionId:id,id,messages:[{id:'m-'+id,role:'user' as const,text,createdAt:1}],modelHistory:[],createdAt:1,updatedAt:2,archivedAt:null,deletedAt:null,pendingHistory:null});
const doc=(key:string,state:object,version=1):CloudDocument=>({key,value:JSON.stringify({state,version}),revision:2});
beforeEach(()=>{useChatStore.setState({...conversation('local','Old'),open:true,running:false,compacting:false,hydrated:true,loadFailed:false,archivedSessions:[],rateLimits:{}});useKBStore.setState({docs:{},pickCache:{},usage:{}});});
it('applies external conversation content while preserving the conversation selected on this device and suppressing writes',()=>{
  const storage=useChatStore.persist.getOptions().storage!,save=vi.fn();useChatStore.persist.setOptions({storage:{...storage,setItem:save}});
  try{const apply=prepareRemoteContentDocuments([doc('dynamic_diary-chat',{...conversation('other','New conversation'),archivedSessions:[conversation('local','Updated externally')],rateLimits:{}})]);apply();
    expect(useChatStore.getState()).toMatchObject({sessionId:'local',open:true,messages:[{text:'Updated externally'}]});expect(useChatStore.getState().archivedSessions.map(item=>item.sessionId)).toEqual(['other']);expect(save).not.toHaveBeenCalled();
  }finally{useChatStore.persist.setOptions({storage});}
});
it('validates all auxiliary documents before any store is changed',()=>{
  expect(()=>prepareRemoteContentDocuments([doc('dynamic_diary-chat',{...conversation('local','Must not apply'),archivedSessions:[],rateLimits:{}}),doc('cellproject-kb',{docs:{bad:{id:'bad'}}},2)])).toThrow();expect(useChatStore.getState().messages[0].text).toBe('Old');expect(useKBStore.getState().docs).toEqual({});
});
it('applies external knowledge while keeping local UI state and rejects replacement during an active reply',()=>{
  const knowledge={id:'d1',filename:'source.pdf',sizeBytes:20,pageCount:1,extractedAt:1,extractedText:'Text',fingerprint:'test',summary:{titulo:'Title',dominio:'Engineering',tags:[],resumo:[],fatos:[],nivel:'iniciante'}};
  const apply=prepareRemoteContentDocuments([doc('cellproject-kb',{docs:{d1:knowledge},pickCache:{},usage:{}},2)]);apply();expect(useKBStore.getState().docs.d1.extractedText).toBe('Text');
  useChatStore.setState({running:true});expect(()=>prepareRemoteContentDocuments([doc('dynamic_diary-chat',{...conversation('local','Cannot replace'),archivedSessions:[],rateLimits:{}})])).toThrow();expect(useChatStore.getState().messages[0].text).toBe('Old');
});
