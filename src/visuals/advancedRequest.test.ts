import { describe, expect, expectTypeOf, it } from 'vitest';
import { NoObjectGeneratedError } from 'ai';
import { VisualAssemblyError } from './advancedErrors';
import { withAssemblyStage } from './advancedRequest';

function invalidOutput(finishReason: 'stop' | 'length' = 'stop') {
  return new NoObjectGeneratedError({
    message: 'SDK output validation failed', text: 'PRIVATE-REFERENCE-TEXT', cause: new Error('PRIVATE-PROVIDER-BODY'),
    finishReason, response: { id: 'response-id', timestamp: new Date(0), modelId: 'test-model' },
    usage: { inputTokens: 1, inputTokenDetails: { noCacheTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
      outputTokens: 1, outputTokenDetails: { textTokens: 1, reasoningTokens: 0 }, totalTokens: 2 },
  });
}

describe('advanced structured response diagnostics', () => {
  it('returns the successful typed response unchanged', async () => {
    const response = { objects: [1, 2] };
    const request = withAssemblyStage('plan', undefined, async () => response);
    expectTypeOf(request).toEqualTypeOf<Promise<{ objects: number[] }>>();
    expect(await request).toBe(response);
  });

  it.each(['selection', 'plan', 'module'] as const)('identifies invalid SDK output in the %s stage without exposing its payload', async stage => {
    let calls = 0;
    const error = await withAssemblyStage(stage, stage === 'module' ? 'Servo' : undefined, async () => {
      calls++; throw invalidOutput();
    }).catch(reason => reason);
    expect(error).toBeInstanceOf(VisualAssemblyError);
    expect(error).toMatchObject({ message: 'visualAssemblyInvalid', stage, code: 'format', moduleName: stage === 'module' ? 'Servo' : undefined });
    expect(error.cause).toBeUndefined();
    expect(error.text).toBeUndefined();
    expect(error.response).toBeUndefined();
    expect(JSON.stringify(error)).not.toContain('PRIVATE-');
    expect(calls).toBe(1);
  });

  it('reports truncated SDK output as incomplete instead of an assembly contract error', async () => {
    const error = await withAssemblyStage('module', 'Servo', async () => { throw invalidOutput('length'); }).catch(reason => reason);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(VisualAssemblyError);
    expect(error.message).toBe('visualGenerationIncomplete');
    expect(error.cause).toBeUndefined();
  });

  it.each([
    ['cancellation', Object.assign(new Error('Canceled'), { name: 'AbortError' })],
    ['transport', new Error('Network unavailable')],
    ['vision', new Error('visualVisionUnsupported')],
    ['unmarked SDK-like error', Object.assign(new Error('Gateway failure'), { name: 'AI_NoObjectGeneratedError' })],
  ])('preserves %s errors rather than converting them into format failures', async (_name, original) => {
    const error = await withAssemblyStage('module', 'Servo', async () => { throw original; }).catch(reason => reason);
    expect(error).toBe(original);
  });
});
