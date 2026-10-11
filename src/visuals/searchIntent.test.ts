import { beforeEach, describe, expect, it, vi } from 'vitest';
const deps = vi.hoisted(() => ({ generate: vi.fn(), config: vi.fn() }));
vi.mock('ai', () => ({ generateObject: deps.generate }));
vi.mock('@/config/store', () => ({ getActiveConfig: deps.config }));
vi.mock('@/ai/client', () => ({ kbModel: {}, callOpts: () => ({ maxOutputTokens: 2000 }), currentModelIds: () => ({ kb: 'test' }) }));
import { imageSearchQueries, resolveImageSearchIntent } from './searchIntent';

const input = { text: 'traga-me os motores apontados daqui', mentions: [], attachments: [] };
beforeEach(() => { vi.clearAllMocks(); deps.config.mockReturnValue(null); });
describe('image search intent', () => {
  it('separates requested objects while retaining their own model identifiers', () => {
    const intent = { query: 'NEMA 23 stepper motor ESP32-S3', label: 'Motor e placa', targetTerms: ['stepper motor', 'ESP32'], uncertainty: '', targets: [
      { aliases: ['stepper motor', 'motor de passo'], identifiers: ['NEMA 23'] },
      { aliases: ['ESP32-S3 module'], identifiers: ['ESP32-S3'] },
    ] };
    expect(imageSearchQueries(intent)).toEqual(['stepper motor NEMA 23', 'ESP32-S3 module']);
    expect(imageSearchQueries({ ...intent, targets: [
      { query: 'Arduino Uno board', aliases: ['Arduino Uno'], identifiers: ['Arduino Uno'] },
      { query: 'USB data cable', aliases: ['USB cable'], identifiers: [] },
    ] })).toEqual(['Arduino Uno board', 'USB data cable']);
    expect(imageSearchQueries({ ...intent, targets: [intent.targets[0]], query: 'NEMA 23 stepper motor close-up' })).toEqual(['NEMA 23 stepper motor close-up']);
  });
  it('preserves a self-contained part identifier without BYOK', async () => {
    const result = await resolveImageSearchIntent({ ...input, text: 'ESP32-WROOM-32' }, '', { signal: new AbortController().signal });
    expect(result).toMatchObject({ query: 'ESP32-WROOM-32', targetTerms: ['ESP32-WROOM-32'] });
    expect(deps.generate).not.toHaveBeenCalled();
  });
  it('does not send an unresolved deictic request to Commons when AI is unavailable', async () => {
    await expect(resolveImageSearchIntent(input, '{"selected":[]}', { signal: new AbortController().signal })).rejects.toThrow('visualSearchNeedsAI');
  });
  it('removes request boilerplate from an unpaid self-contained search', async () => {
    const result = await resolveImageSearchIntent({ ...input, text: 'show me NEMA 23 stepper motor photos' }, '', { signal: new AbortController().signal });
    expect(result).toMatchObject({ query: 'NEMA 23 stepper motor', targetTerms: ['NEMA 23 stepper motor'] });
  });
  it('sends the selected component description to the model before any search', async () => {
    deps.config.mockReturnValue({ provider: 'test' });
    deps.generate.mockResolvedValue({ finishReason: 'stop', object: { query: 'stepper motor photograph', label: 'Motores de passo', targets: [{ query: 'stepper motor photograph', aliases: ['stepper motor', 'motor de passo'], identifiers: [] }], uncertainty: 'Modelo não informado.', unresolved: false } });
    const context = JSON.stringify({ selected: [{ label: 'Motores, transmissões e estrutura', text: 'Quatro motores de passo, reduções, rolamentos e fixadores.' }], project: { name: 'Robô de dois braços' } });
    await resolveImageSearchIntent(input, context, { signal: new AbortController().signal });
    const sent = JSON.parse(deps.generate.mock.calls[0][0].prompt);
    expect(sent).toEqual({ request: input.text, context });
  });
  it.each(['reference', 'attachment'] as const)('searches a %s without typed text and does not mistake electrical quantities for model codes', async source => {
    deps.config.mockReturnValue({ provider: 'test' });
    const description = 'Fonte chaveada SH0505, 5 volts e 5 amperes. Capacitor eletrolítico de 1000 µF, 16 volts. Fusível de 5 amperes.';
    const request = { text: '', mentions: source === 'reference' ? [{ id: 'power', kind: 'node' as const, label: 'Fonte, capacitor e proteção', detail: 'Recurso', fingerprint: 'v1' }] : [],
      attachments: source === 'attachment' ? [{ id: 'spec', name: 'fonte.md', mime: 'text/markdown', byteLength: 200, text: description, mediaId: null }] : [] };
    const context = JSON.stringify(source === 'reference' ? { selected: [{ label: request.mentions[0].label, text: description }] } : { attachments: [{ name: 'fonte.md', text: description }] });
    deps.generate.mockResolvedValue({ finishReason: 'stop', object: {
      query: 'SH0505 power supply, 1000uF capacitor and 5A fuse', label: 'Fonte, capacitor e fusível',
      targets: [
        { query: 'SH0505 switching power supply 5V 5A', aliases: ['SH0505 power supply'], identifiers: ['SH0505'] },
        { query: '1000uF 16V electrolytic capacitor', aliases: ['electrolytic capacitor'], identifiers: [] },
        { query: '5A fuse', aliases: ['fuse'], identifiers: [] },
      ], uncertainty: '', unresolved: false,
    } });
    const result = await resolveImageSearchIntent(request, context, { signal: new AbortController().signal });
    expect(imageSearchQueries(result)).toEqual(['SH0505 switching power supply 5V 5A', '1000uF 16V electrolytic capacitor', '5A fuse']);
    expect(result.targets?.map(target => target.identifiers)).toEqual([['SH0505'], [], []]);
  });
  it('keeps every selected component when the model returns bilingual aliases for a reference-only search', async () => {
    deps.config.mockReturnValue({ provider: 'test' });
    const targets = [
      { query: '5V 5A regulated power supply', aliases: ['Fonte regulada', 'regulated power supply'], identifiers: [] },
      { query: 'fuse and cut-off button', aliases: ['Fusível e botão de corte', 'fuse and cut-off button'], identifiers: [] },
      { query: 'SH0505 converter', aliases: ['Conversor SH0505', 'SH0505 converter'], identifiers: ['SH0505'] },
      { query: '1000 µF capacitor', aliases: ['Capacitor eletrolítico', 'electrolytic capacitor'], identifiers: [] },
      { query: 'network cable', aliases: ['Cabo de rede', 'network cable'], identifiers: [] },
      { query: 'protection box', aliases: ['Caixa de proteção', 'protection box'], identifiers: [] },
    ];
    deps.generate.mockResolvedValue({ finishReason: 'stop', object: { query: 'power supply, capacitor and protection', label: 'Fonte, capacitor e proteção', targets, uncertainty: '', unresolved: false } });
    const request = { text: '', mentions: [{ id: 'power', kind: 'node' as const, label: 'Fonte, capacitor e proteção', detail: 'Recurso', fingerprint: 'v1' }], attachments: [] };
    const result = await resolveImageSearchIntent(request, JSON.stringify({ selected: [{ text: 'Fonte 5 V / 5 A; conversor SH0505; capacitor 1000 µF; fusível; botão de corte; cabo de rede; caixa de proteção.' }] }), { signal: new AbortController().signal });
    expect(result.targets).toEqual(targets);
    expect(imageSearchQueries(result)).toEqual(targets.map(target => target.query));
    expect(result.targetTerms.length).toBeLessThanOrEqual(8);
    for (const target of targets) expect(result.targetTerms).toContain(target.aliases[0]);
  });
  it('rejects ambiguous or truncated model answers rather than falling back to the broad user sentence', async () => {
    deps.config.mockReturnValue({ provider: 'test' });
    deps.generate.mockResolvedValue({ finishReason: 'stop', object: { query: '', label: '', targets: [], uncertainty: '', unresolved: true } });
    await expect(resolveImageSearchIntent(input, '', { signal: new AbortController().signal })).rejects.toThrow('visualSearchUnclear');
    deps.generate.mockResolvedValue({ finishReason: 'length', object: { query: 'motor', label: 'Motor', targets: [{ aliases: ['motor'], identifiers: [] }], uncertainty: '', unresolved: false } });
    await expect(resolveImageSearchIntent(input, '', { signal: new AbortController().signal })).rejects.toThrow('visualSearchUnclear');
  });
  it('keeps explicit identifiers with their own component and rejects invented models', async () => {
    deps.config.mockReturnValue({ provider: 'test' });
    deps.generate.mockResolvedValue({ finishReason: 'stop', object: { query: 'NEMA 23 stepper motor ESP32-S3', label: 'Motor e placa', targets: [{ query: 'NEMA 23 stepper motor', aliases: ['stepper motor', 'motor de passo'], identifiers: ['NEMA 23'] }, { query: 'ESP32-S3 module', aliases: ['ESP32'], identifiers: ['ESP32-S3'] }], uncertainty: '', unresolved: false } });
    const request = { ...input, text: 'imagens do motor NEMA 23 e da placa ESP32-S3' };
    const result = await resolveImageSearchIntent(request, '', { signal: new AbortController().signal });
    expect(result.targets).toEqual([{ query: 'NEMA 23 stepper motor', aliases: ['stepper motor', 'motor de passo'], identifiers: ['NEMA 23'] }, { query: 'ESP32-S3 module', aliases: ['ESP32'], identifiers: ['ESP32-S3'] }]);
    await expect(resolveImageSearchIntent(input, '', { signal: new AbortController().signal })).rejects.toThrow('visualSearchUnclear');
  });
  it('does not lose a known query model behind a generic alias or accept a new model absent from context', async () => {
    deps.config.mockReturnValue({ provider: 'test' });
    deps.generate.mockResolvedValue({ finishReason: 'stop', object: { query: 'NEMA 23 stepper motor', label: 'Motor', targets: [{ query: 'NEMA 23 stepper motor', aliases: ['stepper motor'], identifiers: [] }], uncertainty: '', unresolved: false } });
    const request = { ...input, text: 'foto do motor NEMA 23' };
    const result = await resolveImageSearchIntent(request, '', { signal: new AbortController().signal });
    expect(result.targets?.[0].identifiers).toEqual(['NEMA 23']);
    await expect(resolveImageSearchIntent(input, '', { signal: new AbortController().signal })).rejects.toThrow('visualSearchUnclear');
  });
  it('validates model codes in independent queries even when the combined query omits them', async () => {
    deps.config.mockReturnValue({ provider: 'test' });
    const object = { query: 'microcontroller and USB cable', label: 'Placa e cabo', targets: [
      { query: 'ESP32-S3 module', aliases: ['ESP32'], identifiers: [] as string[] },
      { query: 'USB data cable', aliases: ['USB cable'], identifiers: [] as string[] },
    ], uncertainty: '', unresolved: false };
    deps.generate.mockResolvedValue({ finishReason: 'stop', object });
    const request = { ...input, text: 'ESP32-S3 e cabo USB' };
    const resolved = await resolveImageSearchIntent(request, '', { signal: new AbortController().signal });
    expect(resolved.targets?.map(target => target.identifiers)).toEqual([['ESP32-S3'], []]);
    deps.generate.mockResolvedValue({ finishReason: 'stop', object: { ...object, targets: [{ ...object.targets[0], query: 'ESP32-S2 module' }, object.targets[1]] } });
    await expect(resolveImageSearchIntent(request, '', { signal: new AbortController().signal })).rejects.toThrow('visualSearchUnclear');
  });
  it('rechecks cancellation after the request gate, before calling the model', async () => {
    deps.config.mockReturnValue({ provider: 'test' });
    const controller = new AbortController();
    await expect(resolveImageSearchIntent(input, '', { signal: controller.signal, beforeRequest: async () => { controller.abort(); } })).rejects.toMatchObject({ name: 'AbortError' });
    expect(deps.generate).not.toHaveBeenCalled();
  });
});
