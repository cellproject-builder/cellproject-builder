import { useState } from 'react';
import { DashboardIcon, ArchiveIcon, ResetIcon, PlusIcon } from '@/components/ui/SoftIcons';
import { useWorkspaceStore } from '@/workspace/store';
import { PageHeader } from '@/workspace/PageHeader';
import { Icon, shortDate } from '@/workspace/ui';
import { BoardCanvas } from './BoardCanvas';
import type { BoardRecord } from './model';
import './boards.css';

function Thumbnail({board}:{board:BoardRecord}) {
  const items=board.document.items;
  const left=Math.min(0,...items.map(item=>item.x)),top=Math.min(0,...items.map(item=>item.y));
  const width=Math.max(600,...items.map(item=>item.x+item.width))-left,height=Math.max(360,...items.map(item=>item.y+item.height))-top;
  return <div className="db-thumbnail" aria-hidden="true">{items.slice(0,40).map(item=><span key={item.id} className={`db-mini-${item.kind}`} style={{left:`${(item.x-left)/width*100}%`,top:`${(item.y-top)/height*100}%`,width:`${item.width/width*100}%`,height:`${item.height/height*100}%`}}>{item.kind==='image'?<img src={item.src} alt=""/>:item.kind==='text'||item.kind==='card'?item.text.slice(0,100):item.kind==='diagram'?<svg viewBox="0 0 100 70"><path d="M15 35h25m0 0 20-20m-20 20 20 20"/><rect x="2" y="25" width="22" height="20" rx="4"/><rect x="60" y="5" width="30" height="20" rx="4"/><rect x="60" y="45" width="30" height="20" rx="4"/></svg>:item.kind==='model'?<Icon name="planner"/>:<svg viewBox={`0 0 ${item.width} ${item.height}`}><polyline points={item.points.map(point=>`${point.x},${point.y}`).join(' ')} stroke={item.color} strokeWidth={item.widthStroke} fill="none"/></svg>}</span>)}{!items.length&&<DashboardIcon width={28} height={28}/>}</div>;
}
export function DynamicBoards({english=false,onMaximizedChange}:{english?:boolean;onMaximizedChange?(value:boolean):void}) {
  const boards=useWorkspaceStore(state=>state.boards),active=useWorkspaceStore(state=>state.activeBoardId);
  const [query,setQuery]=useState(''),[archived,setArchived]=useState(false);
  const t=(pt:string,en:string)=>english?en:pt;
  const back=()=>{onMaximizedChange?.(false);useWorkspaceStore.setState({activeBoardId:null});};
  if(active&&boards[active]&&!boards[active].archived)return <BoardCanvas key={active} boardId={active} onBack={back} onMaximizedChange={onMaximizedChange} english={english}/>;
  const shown=Object.values(boards).filter(board=>board.archived===archived&&board.title.toLocaleLowerCase().includes(query.toLocaleLowerCase())).sort((a,b)=>b.updatedAt-a.updatedAt);
  const create=()=>useWorkspaceStore.getState().createBoard(t('Novo quadro','New board'));
  return <div className="ws-page db-library">
    <PageHeader title="Dynamic Board" description={t('Um espaço livre para suas ideias.','A free space for your ideas.')} titleIcon={<DashboardIcon width={21} height={21}/>} controls={<><div className="ws-segmented"><button aria-pressed={!archived} onClick={()=>setArchived(false)}>{t('Quadros','Boards')}</button><button aria-label={t('Quadros arquivados','Archived boards')} aria-pressed={archived} onClick={()=>setArchived(true)}>{t('Arquivados','Archived')}</button></div><label className="db-library-search"><Icon name="search" size={15}/><input aria-label={t('Buscar quadros','Search boards')} placeholder={t('Buscar quadros','Search boards')} value={query} onChange={event=>setQuery(event.target.value)}/></label></>} actions={<button className="ws-button primary" aria-label={t('Novo quadro','New board')} onClick={create}><PlusIcon/>{t('Novo quadro','New board')}</button>}/>
    {shown.length?<div className="db-board-grid">{shown.map(board=><article key={board.id} className="db-board-card"><button className="db-board-open" data-board-open={board.id} onClick={()=>useWorkspaceStore.getState().openBoard(board.id)} disabled={archived}><Thumbnail board={board}/><div><strong>{board.title}</strong><small>{board.document.items.length} {t('objetos','objects')} · {shortDate(board.updatedAt)}</small></div></button>{archived?<button className="ws-icon-button db-board-archive" data-board-restore={board.id} title={t('Restaurar quadro','Restore board')} aria-label={t(`Restaurar ${board.title}`,`Restore ${board.title}`)} onClick={()=>useWorkspaceStore.getState().updateBoard(board.id,{archived:false})}><ResetIcon/></button>:<button className="ws-icon-button db-board-archive" data-board-archive={board.id} title={t('Arquivar quadro','Archive board')} aria-label={t(`Arquivar ${board.title}`,`Archive ${board.title}`)} onClick={()=>useWorkspaceStore.getState().updateBoard(board.id,{archived:true})}><ArchiveIcon/></button>}</article>)}</div>:<div className="db-library-empty"><div className="db-empty-sketch" aria-hidden="true"><span/><span/><svg viewBox="0 0 200 110"><path d="M40 55c25-40 80 45 120-10M125 35l35 10-20 28"/></svg></div><h2>{query?t('Nenhum quadro encontrado','No boards found'):archived?t('Nenhum quadro arquivado','No archived boards'):t('Dê espaço à próxima ideia','Make room for your next idea')}</h2><p>{t('Escreva, desenhe e explore diagramas em um canvas livre.','Write, draw and explore diagrams on a free canvas.')}</p>{!archived&&!query&&<button className="ws-button" onClick={create}><PlusIcon/>{t('Criar meu primeiro quadro','Create my first board')}</button>}</div>}
  </div>;
}
