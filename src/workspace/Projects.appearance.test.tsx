import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useLocaleStore } from '@/i18n';
import { EMPTY_OBJECTIVE_DRAFT, useGraphStore } from '@/store';
import { flushWorkspacePersistence, useWorkspaceStore as workspace } from './store';
import { ProjectForm, Projects } from './Projects';

let host:HTMLDivElement, root:Root;
beforeEach(async () => {
  (globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT = true;
  useLocaleStore.setState({locale:'pt-BR'});
  await Promise.all([workspace.persist.rehydrate(),useGraphStore.persist.rehydrate()]);
  workspace.setState({projects:{},tasks:{},notes:{},sprints:{},folders:{},comments:{},activeProjectId:null,surface:'projects',legacyImported:true});
  useGraphStore.setState({project:null,archivedProject:null,aiJobs:{},drafts:{},pendingSuggestions:null,objectiveDraft:{...EMPTY_OBJECTIVE_DRAFT}});
  host=document.createElement('div'); document.body.append(host); root=createRoot(host);
});
afterEach(async () => {await act(async () => {root.unmount(); await flushWorkspacePersistence();}); host.remove();});
it('keeps each card icon and color when projects are reordered or filtered and opens customization', async () => {
  workspace.getState().createProject('Robótica','Investigar peças',{icon:'GearIcon',color:'#a78bfa'});
  workspace.getState().createProject('Leitura','Comparar referências',{icon:'ReaderIcon',color:'#4ade80'});
  await act(async () => root.render(<Projects/>));
  const card = () => [...host.querySelectorAll<HTMLButtonElement>('.ws-project-card')].find(button => button.textContent?.includes('Robótica'))!;
  expect(card().querySelector('[data-project-icon="GearIcon"]')).not.toBeNull();
  const color = card().querySelector<HTMLElement>('[data-project-icon]')!.style.color;
  act(() => Simulate.change(host.querySelector('[aria-label="Buscar projetos"]')!,{target:{value:'Robótica'}} as never));
  expect(card().querySelector<HTMLElement>('[data-project-icon]')!.style.color).toBe(color);
  act(() => Simulate.click(host.querySelector('[aria-label="Personalizar projeto Robótica"]')!));
  expect(document.querySelector('[role="dialog"] [aria-label="Escolher ícone do projeto"]')).not.toBeNull();
});
it('keeps appearance changes as a draft until saved and discards them when cancelled', async () => {
  const id=workspace.getState().createProject('Robótica','Investigar peças',{icon:'GearIcon',color:'#60a5fa'});
  const close=vi.fn();
  await act(async () => root.render(<ProjectForm project={workspace.getState().projects[id]} onClose={close}/>));
  act(() => Simulate.click(document.querySelector('[data-icon-color="#a78bfa"]')!));
  expect(workspace.getState().projects[id].appearance?.color).toBe('#60a5fa');
  act(() => Simulate.click([...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(button => button.textContent==='Cancelar')!));
  expect(close).toHaveBeenCalledOnce();
  expect(workspace.getState().projects[id].appearance?.color).toBe('#60a5fa');
  await act(async () => root.render(<ProjectForm key="reopened" project={workspace.getState().projects[id]} onClose={close}/>));
  expect(document.querySelector('[data-icon-color="#60a5fa"]')?.getAttribute('aria-pressed')).toBe('true');
  act(() => Simulate.click(document.querySelector('[data-icon-color="#a78bfa"]')!));
  act(() => Simulate.submit(document.querySelector('[role="dialog"] form')!));
  expect(workspace.getState().projects[id].appearance).toEqual({icon:'GearIcon',color:'#a78bfa'});
});
it('creates a plan with its selected icon and color without requiring a project name', async () => {
  await act(async () => root.render(<ProjectForm initialObjective="Investigar energia" onClose={() => {}}/>));
  act(() => Simulate.click(document.querySelector('[aria-label="Escolher ícone do projeto"]')!));
  act(() => Simulate.click(document.querySelector('[data-icon-id="LightningBoltIcon"]')!));
  act(() => Simulate.click(document.querySelector('[data-icon-color="#fbbf24"]')!));
  act(() => Simulate.submit(document.querySelector('[role="dialog"] form')!));
  const project=Object.values(workspace.getState().projects)[0];
  expect(project).toMatchObject({name:'Investigar energia',appearance:{icon:'LightningBoltIcon',color:'#fbbf24'}});
  expect(workspace.getState().surface).toBe('planner');
});
