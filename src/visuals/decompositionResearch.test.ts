import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { NoObjectGeneratedError } from 'ai';
import { useLocaleStore } from '@/i18n';
const deps = vi.hoisted(() => ({ research: vi.fn(), generate: vi.fn(), extract: vi.fn(), callOpts: vi.fn(() => ({ maxOutputTokens: 6000 })) }));
vi.mock('@/ai/research', () => ({ groundedText: deps.research }));
vi.mock('ai', async importOriginal => ({ ...await importOriginal<typeof import('ai')>(), generateObject: deps.generate }));
vi.mock('@/ai/client', () => ({ kbModel: { id: 'research-model' }, currentModelIds: () => ({ kb: 'research-model' }), callOpts: deps.callOpts }));
vi.mock('@/kb/extract', () => ({ extractPdfText: deps.extract }));
import { researchDecomposition, researchDecompositionParts } from './decompositionResearch';
import type { DecompositionPart } from './decompositionTypes';

const url = 'https://docs.arduino.cc/hardware/uno-rev3/';
const source = { id: 'official-uno', url, title: 'Official UNO R3', text: 'Arduino UNO R3 A000066. U4 ATMEGA328P-PU. Clock: 16 MHz. USB-B connector.', retrievedAt: 123, mime: 'text/html' };
const part: DecompositionPart = { id: 'mcu', name: 'Microcontrolador', partNumber: 'ATMEGA328P-PU', quantity: null, role: 'Processamento', specifications: ['Clock: 16 MHz.'], evidence: [{ sourceId: source.id, quote: 'U4 ATMEGA328P-PU. Clock: 16 MHz.' }], unknowns: ['Altura não documentada.'] };
const options = () => ({ signal: new AbortController().signal });
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.clearAllMocks();
  useLocaleStore.setState({ locale: 'pt-BR' });
  deps.callOpts.mockReturnValue({ maxOutputTokens: 6000 });
  deps.research.mockResolvedValue({ text: 'SEARCH DIGEST IS NOT DOCUMENTARY EVIDENCE', sources: [{ url, title: source.title }] });
  deps.generate.mockResolvedValue({ object: { parts: [part], unknowns: ['Posições 3D não documentadas.'] }, finishReason: 'stop' });
  deps.extract.mockResolvedValue({ text: source.text, pageCount: 1 });
  fetchMock = vi.fn(async (target: string) => new Response(JSON.stringify(target.endsWith('capabilities') ? { specifications: true } : { documents: [source], failures: [] })));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('evidence-based object decomposition research', () => {
  it('reads actual source documents before extracting parts and does not use a search summary as evidence', async () => {
    const result = await researchDecomposition('Arduino UNO R3 A000066', 'Selected image describes UNO R3.', options());
    expect(result).toMatchObject({ identity: 'Arduino UNO R3 A000066', parts: [part], sources: [{ id: source.id, text: source.text }] });
    expect(fetchMock.mock.calls.map(([target]) => target)).toEqual(['/api/visuals/capabilities', '/api/visuals/specifications']);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ sources: [{ url, title: source.title }] });
    const prompt = deps.generate.mock.calls[0][0].prompt;
    expect(prompt).toContain(source.text); expect(prompt).not.toContain('SEARCH DIGEST IS NOT DOCUMENTARY EVIDENCE');
    expect(deps.generate.mock.calls[0][0].system).toContain('Do not mix variants');
  });

  it('uses a simple provider schema while validating all extraction bounds locally', async () => {
    await researchDecomposition('Arduino UNO R3 A000066', '', options());
    const schema = z.toJSONSchema(deps.generate.mock.calls[0][0].schema);
    expect(JSON.stringify(schema)).not.toMatch(/minLength|maxLength|minItems|maxItems|minimum|maximum|exclusiveMinimum|exclusiveMaximum|multipleOf/);
    const oversized = { ...part, name: 'x'.repeat(301) };
    deps.generate.mockResolvedValue({ object: { parts: [oversized], unknowns: [] }, finishReason: 'stop' });
    await expect(researchDecomposition('UNO R3', '', options())).rejects.toThrow('decompositionResearchInvalid');
    deps.generate.mockResolvedValue({ object: { parts: Array.from({ length: 33 }, (_, index) => ({ ...part, id: `component-${index}` })), unknowns: [] }, finishReason: 'stop' });
    await expect(researchDecomposition('UNO R3', '', options())).rejects.toThrow('decompositionResearchInvalid');
    deps.generate.mockResolvedValue({ object: { parts: [{ ...part, quantity: -3 }], unknowns: [] }, finishReason: 'stop' });
    await expect(researchDecomposition('UNO R3', '', options())).rejects.toThrow('decompositionResearchInvalid');
  });

  it('budgets compact extraction separately and preserves reasoning-model temperature omission', async () => {
    await researchDecomposition('Arduino UNO R3 A000066', '', options());
    const request = deps.generate.mock.calls[0][0];
    expect(request.maxOutputTokens).toBe(12000);
    expect(request.system).toContain('at most 16 parts');
    expect(request.system).toContain('240 characters');
    expect(request.system).toContain('120 characters');
    expect(request.system).toContain('partial');
    deps.callOpts.mockReturnValue({ maxOutputTokens: 16000 });
    await researchDecompositionParts('UNO R3', [part], options());
    const selectedRequest = deps.generate.mock.calls[1][0];
    expect(selectedRequest.maxOutputTokens).toBe(16000); expect(selectedRequest.temperature).toBeUndefined();
    expect(selectedRequest.system).toContain('at most 8 parts');
  });

  it('sends the actual interface language while preserving evidence in the source language', async () => {
    await researchDecomposition('Arduino UNO R3 A000066', '', options());
    expect(JSON.parse(deps.generate.mock.calls[0][0].prompt)).toMatchObject({ responseLanguage: 'Brazilian Portuguese' });
    expect(deps.generate.mock.calls[0][0].system).toContain('names, roles and unknowns');
    expect(deps.generate.mock.calls[0][0].system).toContain('quotes and specifications remain verbatim');
    useLocaleStore.setState({ locale: 'en' });
    await researchDecompositionParts('UNO R3', [part], options());
    expect(JSON.parse(deps.generate.mock.calls[1][0].prompt)).toMatchObject({ responseLanguage: 'English' });
  });

  it('maps SDK truncated-object errors to the actionable extraction error without retrying', async () => {
    deps.generate.mockRejectedValue(new NoObjectGeneratedError({ text: '{"parts":[{"id":"truncated', finishReason: 'length', response: {} as never, usage: {} as never }));
    await expect(researchDecomposition('UNO R3', '', options())).rejects.toThrow('decompositionResearchInvalid');
    expect(deps.generate).toHaveBeenCalledOnce();
    expect(deps.generate.mock.calls[0][0].maxRetries).toBe(0);
  });

  it('drops unsupported pieces and specifications rather than accepting invented parts or false citations', async () => {
    deps.generate.mockResolvedValue({ object: { parts: [
      { ...part, specifications: [...part.specifications, 'Weight: 20 kg'] },
      { ...part, id: 'fake', name: 'Invented camera', partNumber: 'CAMERA123', evidence: [{ sourceId: source.id, quote: 'not present in downloaded document' }] },
      { ...part, id: 'forged', name: 'False source', evidence: [{ sourceId: 'not-returned-by-gateway', quote: source.text }] },
    ], unknowns: [] }, finishReason: 'stop' });
    const result = await researchDecomposition('Arduino UNO R3', '', options());
    expect(result.parts).toHaveLength(1); expect(result.parts[0].specifications).toEqual(part.specifications);
    expect(result.unknowns.join(' ')).toMatch(/Invented camera|False source/);
    expect(result.parts[0].unknowns.join(' ')).toMatch(/Weight: 20 kg/);
  });

  it('requires exact normalized quotes and never accepts a part number absent from its evidence', async () => {
    deps.generate.mockResolvedValue({ object: { parts: [{ ...part, evidence: [{ sourceId: source.id, quote: 'U4\n ATMEGA328P-PU.\tClock: 16 MHz.' }] }], unknowns: [] }, finishReason: 'stop' });
    expect((await researchDecomposition('UNO R3', '', options())).parts[0].evidence[0].quote).toBe(part.evidence[0].quote);
    deps.generate.mockResolvedValue({ object: { parts: [{ ...part, partNumber: 'ATMEGA328P-MU' }], unknowns: [] }, finishReason: 'stop' });
    await expect(researchDecomposition('UNO R3', '', options())).rejects.toThrow('decompositionResearchNoEvidence');
  });

  it('fails without fetched evidence and never fills gaps using model memory', async () => {
    deps.research.mockResolvedValue({ text: 'Known facts without citations', sources: [] });
    await expect(researchDecomposition('UNO R3', '', options())).rejects.toThrow('decompositionResearchNoSources');
    expect(deps.generate).not.toHaveBeenCalled(); expect(fetchMock).toHaveBeenCalledOnce();
    deps.research.mockResolvedValue({ text: '', sources: [{ url, title: source.title }] });
    fetchMock.mockImplementation(async target => new Response(JSON.stringify(target.endsWith('capabilities') ? { specifications: true } : { documents: [], failures: [] })));
    await expect(researchDecomposition('UNO R3', '', options())).rejects.toThrow('decompositionResearchNoSources');
    expect(deps.generate).not.toHaveBeenCalled();
  });

  it('only downloads actual citation URLs and bounds the sources to six', async () => {
    deps.research.mockResolvedValue({ text: '[Invented](https://evil.example/not-a-provider-citation)', sources: [
      { url: 'javascript:alert(1)', title: 'invalid' }, { url: 'https://user:secret@example.com', title: 'invalid' },
      ...Array.from({ length: 10 }, (_, index) => ({ url: `${url}?source=${index}`, title: 'Official' })),
    ] });
    await researchDecomposition('UNO R3', '', options());
    const posted = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(posted.sources).toHaveLength(6); expect(JSON.stringify(posted)).not.toContain('evil.example');
  });

  it('extracts bounded PDF text locally and rejects scanned PDFs without claiming their contents', async () => {
    const base64 = btoa('%PDF-1.7\nfixture');
    fetchMock.mockImplementation(async target => new Response(JSON.stringify(target.endsWith('capabilities') ? { specifications: true } : { documents: [{ ...source, text: undefined, mime: 'application/pdf', base64 }], failures: [] })));
    const result = await researchDecomposition('UNO R3', '', options());
    expect(result.parts).toHaveLength(1); expect(deps.extract.mock.calls[0][2]).toMatchObject({ maxPages: 100, maxChars: 12000 });
    deps.extract.mockResolvedValue({ text: '', pageCount: 1 });
    await expect(researchDecomposition('UNO R3', '', options())).rejects.toThrow('decompositionResearchNoSources');
  });

  it('checks the local gateway before paid research and propagates cancellation before extraction', async () => {
    fetchMock.mockResolvedValue(new Response('denied', { status: 403 }));
    await expect(researchDecomposition('UNO R3', '', options())).rejects.toThrow('decompositionResearchUnavailable');
    expect(deps.research).not.toHaveBeenCalled();
    const controller = new AbortController();
    fetchMock.mockImplementation(async target => { if (target.endsWith('specifications')) controller.abort(); return new Response(JSON.stringify(target.endsWith('capabilities') ? { specifications: true } : { documents: [source], failures: [] })); });
    await expect(researchDecomposition('UNO R3', '', { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(deps.generate).not.toHaveBeenCalled();
  });

  it('retains source conflicts as unknowns and does not mutate caller context', async () => {
    deps.generate.mockResolvedValue({ object: { parts: [part], unknowns: ['Datasheet names another regulator than the Rev3e schematic.'] }, finishReason: 'stop' });
    const onProgress = vi.fn(), beforeRequest = vi.fn();
    const result = await researchDecomposition('UNO R3', 'DOCUMENTARY-CONTEXT', { ...options(), beforeRequest, onProgress });
    expect(result.unknowns).toContain('Datasheet names another regulator than the Rev3e schematic.');
    expect(onProgress).toHaveBeenCalled(); expect(beforeRequest).toHaveBeenCalled();
    expect(deps.research.mock.calls[0][0].prompt).toContain('DOCUMENTARY-CONTEXT');
  });

  it('does not accept an invented assembly quantity even when another quote is genuine', async () => {
    deps.generate.mockResolvedValue({ object: { parts: [{ ...part, quantity: 40 }], unknowns: [] }, finishReason: 'stop' });
    const result = await researchDecomposition('UNO R3', '', options());
    expect(result.parts[0].quantity).toBeNull();
    expect(result.parts[0].unknowns.join(' ')).toMatch(/Quantidade/);
  });

  it('retains an explicit quoted quantity and discloses truncated document text', async () => {
    const quantitySource = { ...source, text: `${source.text} Quantity: 2. ${'A'.repeat(12000)}`.slice(0, 12000) };
    fetchMock.mockImplementation(async target => new Response(JSON.stringify(target.endsWith('capabilities') ? { specifications: true } : { documents: [quantitySource], failures: [] })));
    deps.generate.mockResolvedValue({ object: { parts: [{ ...part, quantity: 2, evidence: [{ sourceId: source.id, quote: 'U4 ATMEGA328P-PU. Clock: 16 MHz. USB-B connector. Quantity: 2.' }] }], unknowns: [] }, finishReason: 'stop' });
    const result = await researchDecomposition('UNO R3', '', options());
    expect(result.parts[0].quantity).toBe(2); expect(result.unknowns.join(' ')).toMatch(/12.000|12000/);
  });
});

describe('selected component research', () => {
  it('keeps verified assembly excerpts when component datasheets cannot prove assembly membership', async () => {
    const {mime: _mime,...assemblySource}=source;
    const componentSource={...source,id:'generic-component',url:'https://example.com/mcu-datasheet',text:'Generic MCU package dimensions only.'};
    fetchMock.mockImplementation(async target=>new Response(JSON.stringify(target.endsWith('capabilities')?{specifications:true}:{documents:[componentSource],failures:[]})));
    const result=await researchDecompositionParts('UNO R3',[part],options(),[assemblySource]);
    expect(result.parts).toEqual([part]);
    expect(result.sources.map(s=>s.id)).toEqual([source.id,componentSource.id]);
    expect(JSON.parse(deps.generate.mock.calls[0][0].prompt).sources).toEqual(result.sources);
  });

  it('uses verified assembly evidence when no additional document can be read and declares the gap', async () => {
    const {mime: _mime,...assemblySource}=source;
    deps.research.mockResolvedValue({text:'No sources',sources:[]});
    const result=await researchDecompositionParts('UNO R3',[part],options(),[assemblySource]);
    expect(result.parts).toEqual([part]);
    expect(result.sources).toEqual([assemblySource]);
    expect(result.unknowns.join(' ')).toContain('documentação adicional');
    expect(deps.generate).toHaveBeenCalledOnce();
  });

  it('retains previously verified pieces when enrichment confirms no additional evidence', async () => {
    const {mime: _mime,...assemblySource}=source;
    deps.generate.mockResolvedValue({object:{parts:[],unknowns:['Additional package dimensions could not be confirmed.']},finishReason:'stop'});
    const result=await researchDecompositionParts('UNO R3',[part],options(),[assemblySource]);
    expect(result.parts).toEqual([part]);
    expect(result.sources).toEqual([assemblySource]);
    expect(result.unknowns.join(' ')).toContain('não confirmou novas especificações');
  });

  it('researches each requested component independently with two concurrent searches and preserves IDs', async () => {
    const selected = Array.from({ length: 5 }, (_, index) => ({ ...part, id: `p-${index}`, name: `Component ${index}` }));
    let active = 0, peak = 0;
    deps.research.mockImplementation(async () => { active++; peak = Math.max(peak, active); await new Promise(resolve => setTimeout(resolve, 5)); active--; return { text: '', sources: [{ url, title: source.title }] }; });
    deps.generate.mockResolvedValue({ object: { parts: selected, unknowns: [] }, finishReason: 'stop' });
    const result = await researchDecompositionParts('UNO R3', selected, options());
    expect(deps.research).toHaveBeenCalledTimes(5); expect(peak).toBe(2);
    expect(result.parts.map(item => item.id)).toEqual(selected.map(item => item.id));
    expect(deps.research.mock.calls[0][0].prompt).toContain('Component 0');
    expect(fetchMock.mock.calls.filter(([target]) => target.endsWith('specifications'))).toHaveLength(1);
  });

  it('rejects unrequested or repeated component IDs and invalid selections', async () => {
    deps.generate.mockResolvedValue({ object: { parts: [{ ...part, id: 'unrequested' }], unknowns: [] }, finishReason: 'stop' });
    await expect(researchDecompositionParts('UNO R3', [part], options())).rejects.toThrow('decompositionResearchNoEvidence');
    deps.research.mockClear();
    for (const selected of [[], [part, part], Array(33).fill(part)]) await expect(researchDecompositionParts('UNO R3', selected, options())).rejects.toThrow('decompositionResearchInvalid');
    expect(deps.research).not.toHaveBeenCalled();
  });

  it('propagates a changed scope from beforeRequest instead of swallowing it as a source failure', async () => {
    let stale = false;
    const beforeRequest = vi.fn(async () => { if (stale) throw new Error('scope changed'); });
    deps.research.mockImplementation(async () => { stale = true; throw new Error('source failed'); });
    await expect(researchDecompositionParts('UNO R3', [part], { ...options(), beforeRequest })).rejects.toThrow('scope changed');
    expect(fetchMock).toHaveBeenCalledOnce(); expect(deps.generate).not.toHaveBeenCalled();
  });

  it('preserves a known manufacturer part number instead of substituting another package', async () => {
    const smdSource = { ...source, text: `${source.text} U4 ATMEGA328P-MU.` };
    fetchMock.mockImplementation(async target => new Response(JSON.stringify(target.endsWith('capabilities') ? { specifications: true } : { documents: [smdSource], failures: [] })));
    deps.generate.mockResolvedValue({ object: { parts: [{ ...part, partNumber: 'ATMEGA328P-MU', evidence: [{ sourceId: source.id, quote: 'U4 ATMEGA328P-MU.' }] }], unknowns: [] }, finishReason: 'stop' });
    await expect(researchDecompositionParts('UNO R3', [part], options())).rejects.toThrow('decompositionResearchNoEvidence');
  });
});
