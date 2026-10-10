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
