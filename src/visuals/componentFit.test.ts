import { expect, it } from 'vitest';
import { validateComponentFits } from './componentFit';
const context = { revision: 'r1', partial: false, sources: [{ id: 'req', label: 'Requisitos', kind: 'project', text: 'Alimentação de 5 V', truncated: false }] };
const image = { id: 'i', title: 'Motor A', description: '', sourcePageUrl: 'https://maker.example/motor-a', imageUrl: 'https://maker.example/a.png', credit: null, license: null, width: null, height: null };
const sources = [{ id: 'doc', title: 'Motor A', url: image.sourcePageUrl, text: 'Motor A. Supply voltage: 12 V.', retrievedAt: 1 }];
const check = { aspect: 'Alimentação', status: 'conflict', explanation: 'O motor pede 12 V e o projeto prevê 5 V.', requirement: { sourceId: 'req', quote: 'Alimentação de 5 V' }, evidence: [{ sourceId: 'doc', quote: 'Supply voltage: 12 V.' }] };
const result = { candidates: [{ imageId: 'i', productName: 'Motor A', identity: { sourceId: 'doc', quote: 'Motor A.' }, checks: [check], unknowns: ['Dimensões e torque não definidos.'] }] };
it('retains a documented conflict and links both the requirement and the retrieved specification', () => {
  const [fit] = validateComponentFits(result, [image], context, sources);
  expect(fit.status).toBe('conflict'); expect(fit.checks[0].requirement?.label).toBe('Requisitos');
  expect(fit.checks[0].evidence[0].url).toBe(image.sourcePageUrl);
});
it('never promotes invented quotations, model variants or metadata-only matches to compatibility', () => {
  for (const changed of [
    { ...result, candidates: [{ ...result.candidates[0], checks: [{ ...check, status: 'supported', evidence: [{ sourceId: 'doc', quote: 'Supply voltage: 5 V.' }] }] }] },
    { ...result, candidates: [{ ...result.candidates[0], productName: 'Motor B' }] },
    { ...result, candidates: [{ ...result.candidates[0], identity: { sourceId: 'missing', quote: 'Motor A.' } }] },
  ]) {
    const [fit] = validateComponentFits(changed, [image], context, sources);
    expect(fit.status).toBe('unknown');
  }
  expect(validateComponentFits({ candidates: [] }, [image], context, [])[0].status).toBe('unknown');
});
it('reports partial or missing requirements even when documented checks match', () => {
  const raw = { candidates: [{ ...result.candidates[0], checks: [{ ...check, status: 'supported' }], unknowns: [] }] };
  expect(validateComponentFits(raw, [image], { ...context, partial: true }, sources)[0].status).toBe('unknown');
  expect(validateComponentFits(raw, [image], { ...context, sources: [] }, sources)[0].status).toBe('unknown');
});

it('does not lose a nominal variant when a generic family identity is quoted', () => {
  const pico = { ...image, title: 'Raspberry Pi Pico W' };
  const raw = { candidates: [{ ...result.candidates[0], productName: 'Raspberry Pi Pico', identity: { sourceId: 'doc', quote: 'Raspberry Pi Pico.' }, checks: [{ ...check, status: 'supported' }], unknowns: [] }] };
  const docs = [{ ...sources[0], text: 'Raspberry Pi Pico. Supply voltage: 12 V.' }];
  expect(validateComponentFits(raw, [pico], context, docs)[0].status).toBe('unknown');
  const cable = { ...image, title: 'USB Type-A cable' };
  const cableRaw = { candidates: [{ ...raw.candidates[0], productName: 'USB', identity: { sourceId: 'doc', quote: 'USB Type-C cable.' } }] };
  expect(validateComponentFits(cableRaw, [cable], context, [{ ...docs[0], text: 'USB Type-C cable. Supply voltage: 12 V.' }])[0].status).toBe('unknown');
});

it('accepts exact identities across filename punctuation and letter casing', () => {
  const board = { ...image, title: 'Arduino Uno - R3.jpg' };
  const docs = [{ ...sources[0], text: 'This is the new Arduino Uno R3. Supply voltage: 5 V.' }];
  const raw = { candidates: [{ ...result.candidates[0], productName: 'Arduino UNO R3', identity: { sourceId: 'doc', quote: 'This is the new Arduino Uno R3.' }, checks: [{ ...check, status: 'supported', evidence: [{ sourceId: 'doc', quote: 'Supply voltage: 5 V.' }] }], unknowns: [] }] };
  expect(validateComponentFits(raw, [board], context, docs)[0].status).toBe('supported');
});

it('compares mating components only when both exact identities and specifications are read', () => {
  const board = { ...image, id: 'board', title: 'Arduino UNO R3', sourcePageUrl: 'https://maker.example/uno-r3' };
  const cable = { ...image, id: 'cable', title: 'Cable AB', sourcePageUrl: 'https://maker.example/cable-ab' };
  const docs = [
    { ...sources[0], id: 'board-doc', url: board.sourcePageUrl, text: 'Arduino UNO R3. USB connector: Type B.' },
    { ...sources[0], id: 'cable-doc', url: cable.sourcePageUrl, text: 'Cable AB. Connector: USB Type B male.' },
  ];
  const ctx = { ...context, sources: [{ ...context.sources[0], text: 'Conectar a placa ao cabo USB.' }] };
  const raw = { candidates: [
    { imageId: 'board', productName: board.title, identity: { sourceId: 'board-doc', quote: 'Arduino UNO R3.' }, checks: [{ aspect: 'Conector USB', status: 'supported', explanation: 'A placa e o cabo especificam USB Type B.', relatedImageIds: ['cable'], requirement: { sourceId: 'req', quote: 'Conectar a placa ao cabo USB.' }, evidence: [{ sourceId: 'board-doc', quote: 'USB connector: Type B.' }, { sourceId: 'cable-doc', quote: 'Connector: USB Type B male.' }] }], unknowns: [] },
    { imageId: 'cable', productName: cable.title, identity: { sourceId: 'cable-doc', quote: 'Cable AB.' }, checks: [], unknowns: [] },
  ] };
  const fit = validateComponentFits(raw, [board, cable], ctx, docs)[0];
  expect(fit.status).toBe('supported');
  expect(fit.checks[0].relatedProducts).toEqual([{ imageId: 'cable', name: 'Cable AB' }]);
  expect(fit.checks[0].evidence).toHaveLength(2);
  for (const changed of [
    { candidates: [raw.candidates[0], { ...raw.candidates[1], identity: null }] },
    { candidates: [{ ...raw.candidates[0], checks: [{ ...raw.candidates[0].checks[0], evidence: raw.candidates[0].checks[0].evidence.slice(0, 1) }] }, raw.candidates[1]] },
    { candidates: [{ ...raw.candidates[0], checks: [{ ...raw.candidates[0].checks[0], relatedImageIds: ['other'] }] }, raw.candidates[1]] },
  ]) expect(validateComponentFits(changed, [board, cable], ctx, docs)[0].status).toBe('unknown');
});
