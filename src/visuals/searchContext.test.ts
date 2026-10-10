import { expect, it } from 'vitest';
import { compactSearchContext } from './searchContext';

const bytes = (text: string) => new TextEncoder().encode(text).byteLength;
it('retains explicit component and attachment context ahead of a very long project objective', () => {
  const result = compactSearchContext(JSON.stringify({ project: { name: 'Robô', objective: 'Contexto geral '.repeat(8_000), rules: ['Regra'] }, selected: [{ kind: 'node', label: 'Motores, transmissões e estrutura', text: JSON.stringify({ name: 'Motores', oQue: 'Quatro motores de passo com seus drivers' }) }], attachments: [{ name: 'medidas.txt', mime: 'text/plain', text: 'Eixo medido: 5 mm' }] }));
  const payload = JSON.parse(result);
  expect(bytes(result)).toBeLessThanOrEqual(8192);
  expect(result.indexOf('selected')).toBeLessThan(result.indexOf('project'));
  expect(payload.selected[0].text).toContain('Quatro motores de passo');
  expect(payload.attachments[0].text).toContain('Eixo medido: 5 mm');
  expect(payload.project.name).toBe('Robô');
});

it('shares the budget across references so one verbose source cannot hide later explicit choices', () => {
  const result = compactSearchContext(JSON.stringify({ project: { name: 'Projeto' }, selected: [
    { kind: 'note', label: 'Fonte longa', text: '🛠️ "Detalhe"\n'.repeat(8_000) },
    { kind: 'node', label: 'Motor de passo', text: '{"oQue":"Bipolar de quatro fios"}' },
    { kind: 'image', label: 'Foto do eixo', text: 'Eixo quadrado fotografado' },
  ], attachments: [{ name: 'referencia.md', mime: 'text/markdown', text: 'Acoplamento: alumínio' }] }));
  const payload = JSON.parse(result);
  expect(bytes(result)).toBeLessThanOrEqual(8192);
  expect(payload.selected).toHaveLength(3);
  expect(payload.selected[0].truncated).toBe(true);
  expect(payload.selected[1].text).toContain('Bipolar de quatro fios');
  expect(payload.selected[2].text).toContain('Eixo quadrado');
  expect(payload.attachments[0].text).toContain('Acoplamento: alumínio');
  expect(result).not.toContain('\uFFFD');
});

it('reclaims the budget of short references before truncating a selected component model in favor of project background', () => {
  const result = compactSearchContext(JSON.stringify({ selected: [
    { kind: 'note', label: 'Especificação', text: 'Introduction '.repeat(300) + 'Required motor: MG996R' },
    { kind: 'note', label: 'Nota curta', text: 'short' },
  ], attachments: [], project: { name: 'Robô', objective: 'background '.repeat(2000) } }));
  const payload = JSON.parse(result);
  expect(payload.selected[0].text).toContain('Required motor: MG996R');
  expect(payload.selected[0].truncated).toBe(false);
  expect(payload.selected[1].text).toBe('short');
  expect(payload.project.name).toBe('Robô');
  expect(bytes(result)).toBeLessThanOrEqual(8192);
});

it('keeps all allowed reference excerpts within the UTF-8 limit even with escaped multi-byte text', () => {
  const result = compactSearchContext(JSON.stringify({ project: { name: '🛠️'.repeat(1000), objective: '"'.repeat(9000) }, selected: Array.from({ length: 20 }, (_, index) => ({ kind: 'note', label: `Fonte ${index}`, text: `SOURCE-${index}: ` + '\u0000漢🚀"'.repeat(2000) })), attachments: Array.from({ length: 8 }, (_, index) => ({ name: `Arquivo ${index}`, mime: 'text/plain', text: `FILE-${index}: ` + '🚀'.repeat(2000) })) }));
  expect(bytes(result)).toBeLessThanOrEqual(8192);
  const payload = JSON.parse(result);
  expect(payload.selected).toHaveLength(20); expect(payload.attachments).toHaveLength(8);
  for (let index = 0; index < 20; index++) expect(payload.selected[index].text).toContain(`SOURCE-${index}:`);
  for (let index = 0; index < 8; index++) expect(payload.attachments[index].text).toContain(`FILE-${index}:`);
  expect(result).not.toContain('\uFFFD');
});

it('preserves legacy plain text and safely clips oversized text at code-point boundaries', () => {
  expect(compactSearchContext('Referência de motor com eixo de 5 mm')).toBe('Referência de motor com eixo de 5 mm');
  const result = compactSearchContext('Motor de passo: ' + '🚀漢'.repeat(8000));
  expect(bytes(result)).toBeLessThanOrEqual(8192);
  expect(result.startsWith('Motor de passo: ')).toBe(true);
  expect(result).toContain('truncated');
  expect(result).not.toContain('\uFFFD');
});
