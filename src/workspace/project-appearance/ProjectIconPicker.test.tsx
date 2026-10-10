import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ProjectIconPicker } from './ProjectIconPicker';
import { ProjectIcon, projectIconCatalog, searchProjectIcons } from './projectIcons';

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  (globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => {act(() => root.unmount()); host.remove();});
it('searches the full SVG catalog by Portuguese synonyms and ignores accents', () => {
  expect(projectIconCatalog.length).toBeGreaterThanOrEqual(318);
  expect(searchProjectIcons('mecânica').map(icon => icon.id)).toContain('GearIcon');
  expect(searchProjectIcons('gráfico').map(icon => icon.id)).toContain('BarChartIcon');
  expect(searchProjectIcons('livro').map(icon => icon.id)).toContain('ReaderIcon');
  expect(searchProjectIcons('not-an-existing-icon')).toEqual([]);
});
it('keeps choosing an icon or color inside the draft and does not submit the project form', () => {
  const change = vi.fn(), submit = vi.fn();
  act(() => root.render(<form onSubmit={event => {event.preventDefault(); submit();}}><ProjectIconPicker value={{icon:'planner',color:'#60a5fa'}} onChange={change}/></form>));
  act(() => Simulate.click(host.querySelector('[aria-label="Escolher ícone do projeto"]')!));
  const search = host.querySelector<HTMLInputElement>('[aria-label="Buscar ícones"]')!;
  act(() => Simulate.change(search,{target:{value:'engrenagem'}} as never));
  act(() => Simulate.keyDown(search,{key:'Enter'}));
  act(() => Simulate.click(host.querySelector('[data-icon-id="GearIcon"]')!));
  expect(change).toHaveBeenLastCalledWith({icon:'GearIcon',color:'#60a5fa'});
  act(() => Simulate.click(host.querySelector('[data-icon-color="#a78bfa"]')!));
  expect(change).toHaveBeenLastCalledWith({icon:'planner',color:'#a78bfa'});
  expect(submit).not.toHaveBeenCalled();
});
it('lets the keyboard enter filtered results and select an icon without submitting', () => {
  const change = vi.fn();
  act(() => root.render(<ProjectIconPicker value={{icon:'planner',color:'#60a5fa'}} onChange={change}/>));
  act(() => Simulate.click(host.querySelector('[aria-label="Escolher ícone do projeto"]')!));
  const search = host.querySelector<HTMLInputElement>('[aria-label="Buscar ícones"]')!;
  act(() => Simulate.change(search,{target:{value:'engrenagem'}} as never));
  act(() => Simulate.keyDown(search,{key:'ArrowDown'}));
  const option = host.querySelector<HTMLButtonElement>('[data-icon-id="GearIcon"]')!;
  expect(document.activeElement).toBe(option);
  act(() => Simulate.keyDown(option,{key:'Enter'}));
  expect(change).toHaveBeenCalledWith({icon:'GearIcon',color:'#60a5fa'});
});
it('renders a safe fallback for unknown stored icons and invalid stored colors', () => {
  act(() => root.render(<ProjectIcon appearance={{icon:'MissingInOlderClientIcon',color:'url(https://invalid.example)'}}/>));
  expect(host.querySelector('svg')).not.toBeNull();
  expect(host.querySelector<HTMLElement>('[data-project-icon]')?.style.color).toBe('rgb(96, 165, 250)');
  expect(host.innerHTML).not.toContain('https://');
});
it('returns keyboard focus to the trigger when the icon library closes', () => {
  act(() => root.render(<ProjectIconPicker value={{icon:'planner',color:'#60a5fa'}} onChange={vi.fn()}/>));
  const trigger = host.querySelector<HTMLButtonElement>('[aria-label="Escolher ícone do projeto"]')!;
  act(() => Simulate.click(trigger));
  const close = host.querySelector<HTMLButtonElement>('[aria-label="Fechar biblioteca de ícones"]')!;
  act(() => close.focus());
  act(() => Simulate.click(close));
  expect(host.querySelector('[aria-label="Biblioteca de ícones"]')).toBeNull();
  expect(document.activeElement).toBe(trigger);
});
