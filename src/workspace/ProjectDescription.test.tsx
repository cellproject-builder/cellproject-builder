import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it } from 'vitest';
import { useLocaleStore } from '@/i18n';
import { ProjectDescription } from './ProjectDescription';
import { PageHeader } from './PageHeader';

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  useLocaleStore.setState({ locale: 'pt-BR' });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });
const render = (text: string, key = 'project-a') => act(() => root.render(<ProjectDescription key={key} text={text}/>));
const description = '# DUOAXION\n\nUm robô de mesa com **dois braços** e seis eixos por braço.\n\n| Requisito | Valor |\n| --- | --- |\n| Servos | 14 MG90S |\n| Controle | ESP32 |\n\n- Conferir alimentação\n- Medir alcance\n\n[Especificação](https://example.test/spec)\n\n' + 'Contexto de montagem. '.repeat(50);

it('keeps long project context compact until the reader explicitly expands it', () => {
  render(description);
  const toggle = host.querySelector('button')!;
  expect(toggle.textContent).toContain('Ler descrição completa');
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  expect(host.querySelector('table')).toBeNull();
  expect(host.textContent).not.toContain('Contexto de montagem. '.repeat(50));
  expect(host.textContent).not.toContain('**');
  expect(host.textContent).toContain('Um robô de mesa');
  expect(host.textContent).not.toContain('Requisito');
  act(() => toggle.click());
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  expect(document.getElementById(toggle.getAttribute('aria-controls')!)?.textContent).toContain('14 MG90S');
  expect(host.querySelector('table')?.querySelectorAll('tbody tr')).toHaveLength(2);
  expect(host.querySelector('strong')?.textContent).toBe('dois braços');
  expect(host.textContent).toContain('DUOAXION');
  expect(host.textContent).not.toContain('Duoaxion');
  expect(host.querySelector('a')?.getAttribute('rel')).toContain('noopener');
  expect(host.textContent).toContain('Contexto de montagem. '.repeat(50).trim());
  act(() => toggle.click());
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  expect(host.querySelector('table')).toBeNull();
});

it('does not render an empty description or add a disclosure to a short objective', () => {
  render('   ');
  expect(host.textContent).toBe('');
  render('Compreender o torque de uma articulação.');
  expect(host.textContent).toContain('Compreender o torque de uma articulação.');
  expect(host.querySelector('button')).toBeNull();
});

it('collapses again when the overview switches to a different project', () => {
  render(description);
  act(() => host.querySelector('button')!.click());
  render(description.replace('DUOAXION', 'ESP32'), 'project-b');
  expect(host.querySelector('button')?.getAttribute('aria-expanded')).toBe('false');
});

it('offers full reading for medium paragraphs that would occupy too many lines on a phone', () => {
  render('Investigar a montagem e registrar as medidas dos componentes. '.repeat(4));
  expect(host.querySelector('button')?.getAttribute('aria-expanded')).toBe('false');
  act(() => host.querySelector('button')!.click());
  expect(host.querySelector('button')?.getAttribute('aria-expanded')).toBe('true');
});

it('keeps supplied HTML inert when the full description is opened', () => {
  render('<img src=x onerror="alert(1)">\n\n' + 'Detalhe seguro. '.repeat(35));
  act(() => host.querySelector('button')!.click());
  expect(host.querySelector('img, script')).toBeNull();
  expect(host.textContent).toContain('<img src=x onerror="alert(1)">');
});

it('uses the English disclosure labels when English is selected', () => {
  useLocaleStore.setState({ locale: 'en' });
  render(description);
  expect(host.querySelector('button')?.textContent).toContain('Read full description');
  act(() => host.querySelector('button')!.click());
  expect(host.querySelector('button')?.textContent).toContain('Collapse');
});

it('puts an icon title in its own truncatable text element without shortening the stored title', () => {
  const title = 'Projeto com nome muito extenso '.repeat(30);
  act(() => root.render(<PageHeader title={title} titleIcon={<svg aria-hidden="true"/>}/>));
  const heading = host.querySelector('h1')!;
  expect(heading.querySelector('.ws-page-header-title')?.textContent).toBe(title);
  expect(heading.getAttribute('title')).toBe(title);
});
