import { describe, expect, it } from 'vitest';
import { parseDiagram, type DiagramV1 } from './model';
import { torqueDiagram } from './fixture';
import { parseGeneratedDiagram } from './quality';

const drawing = (): DiagramV1 => ({ ...torqueDiagram(), parameters: [], constants: {}, calculations: [], bindings: [],
  elements: [{ id: 'controller', type: 'rect', x: 30, y: 30, width: 100, height: 80, fill: 'none', stroke: '#ffffff' }] });

describe('explanatory diagram generation', () => {
  it('rejects an unnamed illustration even when title and explanation describe it', () => {
    expect(() => parseGeneratedDiagram(drawing())).toThrow('diagramLabelsMissing');
  });

  it.each([
    { text: '   ' }, { text: '\u200b' }, { text: '→ — +' },
    { fill: 'none' }, { fill: '#ffffff00' }, { x: 460 }, { y: 0 },
    { fill: 'none', stroke: '#ffffff', strokeWidth: 0 },
    { fill: '#ffffff00', stroke: '#00000000' },
  ])('does not count an empty, invisible or clipped label: %j', patch => {
    const diagram = drawing();
    diagram.elements.push({ id: 'name', type: 'text', x: 30, y: 24, fontSize: 16, text: 'Controlador', ...patch });
    expect(() => parseGeneratedDiagram(diagram)).toThrow('diagramLabelsMissing');
  });

  it('accepts real visible nomenclature without changing the saved document', () => {
    const diagram = drawing();
    diagram.elements.push({ id: 'name', type: 'text', x: 30, y: 24, fontSize: 16, fill: 'currentColor', text: 'Controlador — variante a confirmar' });
    expect(parseGeneratedDiagram(diagram)).toEqual(diagram);
    // Reading/importing legacy drawings remains compatible.
    expect(parseDiagram(drawing())).toEqual(drawing());
  });

  it('counts visible stroke text and resolved numeric bindings, retaining the existing arithmetic checks', () => {
    const diagram = drawing();
    diagram.elements.push({ id: 'name', type: 'text', x: 30, y: 24, fill: 'none', stroke: 'currentColor', text: 'Fonte' });
    expect(() => parseGeneratedDiagram(diagram)).not.toThrow();
    const bound = torqueDiagram(); bound.elements = bound.elements.filter(e => e.type !== 'text' || e.id === 'result');
    bound.elements.find(e => e.id === 'result')!.text = '';
    expect(() => parseGeneratedDiagram(bound)).not.toThrow();
    bound.calculations[0].inputs = ['unknown', 'gravity'];
    expect(() => parseGeneratedDiagram(bound)).toThrow('diagramUnknownCalculation');
  });

  it('still rejects executable attributes and unknown graph IDs before accepting labels', () => {
    const diagram = torqueDiagram('private-node', 'test');
    expect(() => parseGeneratedDiagram(diagram, [])).toThrow('diagramUnknownNode');
    expect(() => parseGeneratedDiagram({ ...diagram, onClick: 'alert(1)' })).toThrow();
  });

  it('checks default bound label positions, without rejecting a readable initial state for other parameter extremes', () => {
    const diagram = drawing();
    diagram.parameters = [{ id: 'position', label: 'Posição', min: 0, max: 1, step: .1, value: 1, unit: '' }];
    diagram.elements.push({ id: 'name', type: 'text', x: 30, y: 24, text: 'Controle' });
    diagram.bindings = [{ elementId: 'name', attribute: 'x', valueId: 'position', multiplier: 460, offset: 0, decimals: 0, suffix: '' }];
    expect(() => parseGeneratedDiagram(diagram)).toThrow('diagramLabelsMissing');
    diagram.parameters[0].value = .5;
    expect(() => parseGeneratedDiagram(diagram)).not.toThrow();
    diagram.bindings[0] = { ...diagram.bindings[0], attribute: 'y', multiplier: 24 };
    diagram.parameters[0].value = 0;
    expect(() => parseGeneratedDiagram(diagram)).toThrow('diagramLabelsMissing');
    diagram.parameters[0].value = 1;
    expect(() => parseGeneratedDiagram(diagram)).not.toThrow();
  });
});
