import { describe, expect, it } from 'vitest';
import { APICallError, RetryError } from 'ai';
import { readRateLimit } from './rateLimit';

const now = Date.parse('2026-10-08T12:00:00Z');
const peakCapacity = 'The system is currently experiencing high demand and cannot process your request. Your request exceeds the maximum usage size allowed during peak load. For improved capacity reliability, consider switching to Provisioned Throughput.';
const configurationMessage = 'This AI provider is not configured on the server.';
const apiError = (statusCode: number, responseHeaders?: Record<string, string>, body?: unknown) => new APICallError({
  message: 'Provider returned error', url: 'https://provider.test/chat', requestBodyValues: {},
  statusCode, responseHeaders, responseBody: body === undefined ? undefined : JSON.stringify(body),
});

describe('readRateLimit', () => {
  it('reads a real SDK 429 and respects an advertised delay longer than one minute', () => {
    expect(readRateLimit(apiError(429, { 'Retry-After': '180' }), now)).toEqual({ quotaExhausted: false, retryAfterMs: 180_000 });
  });

  it('uses retry-after-ms before retry-after, with case insensitive header names', () => {
    expect(readRateLimit(apiError(429, { 'ReTrY-AfTeR-Ms': '1250', 'retry-after': '30' }), now)).toEqual({ quotaExhausted: false, retryAfterMs: 1250 });
  });

  it('reads an HTTP date and treats a past reset as zero wait', () => {
    expect(readRateLimit(apiError(429, { 'retry-after': 'Thu, 08 Oct 2026 12:03:00 GMT' }), now)?.retryAfterMs).toBe(180_000);
    expect(readRateLimit(apiError(429, { 'retry-after': 'Thu, 08 Oct 2026 11:59:00 GMT' }), now)?.retryAfterMs).toBe(0);
  });

  it.each(['-1', 'Infinity', 'NaN', 'invalid', '12 seconds', '999999999999999999999999'])('ignores invalid millisecond header %s and tries the valid seconds header', (value) => {
    expect(readRateLimit(apiError(429, { 'retry-after-ms': value, 'retry-after': '2.5' }), now)?.retryAfterMs).toBe(2500);
  });

  it('ignores a negative seconds header rather than interpreting it as a date', () => {
    expect(readRateLimit(apiError(429, { 'retry-after': '-10' }), now)).toEqual({ quotaExhausted: false });
  });

  it('accepts an explicit zero delay', () => {
    expect(readRateLimit(apiError(429, { 'retry-after-ms': '0' }), now)?.retryAfterMs).toBe(0);
  });

  it('unwraps SDK retries and application error info/cause without importing the service', () => {
    const retry = new RetryError({ message: 'Retry failed', reason: 'maxRetriesExceeded', errors: [apiError(429, { 'retry-after': '42' })] });
    expect(readRateLimit({ name: 'AIError', info: { kind: 'rate', status: 429 }, cause: retry }, now)).toEqual({ quotaExhausted: false, retryAfterMs: 42_000 });
  });

  it('retains already classified retry metadata', () => {
    expect(readRateLimit({ info: { kind: 'rate', retryAfterMs: 3200, quotaExhausted: false } }, now)).toEqual({ quotaExhausted: false, retryAfterMs: 3200 });
  });

  it('recognizes errors emitted inside a streaming response', () => {
    expect(readRateLimit(new Error('Too many requests: rate limit reached'), now)).toEqual({ quotaExhausted: false });
    expect(readRateLimit({ error: { code: 429, message: 'Provider unavailable' } }, now)).toEqual({ quotaExhausted: false });
  });

  it.each([
    new Error(peakCapacity),
    new Error('Provider returned error', { cause: new Error(peakCapacity) }),
    { error: { code: 'NoCapacity', message: 'Provider returned error' } },
    { data: { error: { code: 'no_capacity', message: 'Provider returned error' } } },
    { error: { message: 'Provider returned error', metadata: { provider_code: 'NoCapacity' } } },
    { metadata: { raw: JSON.stringify({ error: { code: 'NoCapacity', message: peakCapacity } }) } },
  ])('recognizes peak-load capacity failures through SDK and provider wrappers (%#)', error => {
    expect(readRateLimit(error, now)).toEqual({ quotaExhausted: false });
  });

  it.each([429, 503])('retains retry timing for temporary provider status %s', status => {
    expect(readRateLimit(apiError(status, { 'retry-after-ms': '6250' }), now)).toEqual({ quotaExhausted: false, retryAfterMs: 6250 });
    expect(readRateLimit(apiError(status, { 'retry-after': '6' }), now)).toEqual({ quotaExhausted: false, retryAfterMs: 6000 });
  });

  it.each([
    apiError(503, { 'retry-after': '7' }, { error: { code: 'provider_not_configured', message: configurationMessage } }),
    apiError(503, undefined, { error: { code: 'provider_not_configured', message: 'Provider returned error' } }),
    apiError(503, undefined, { error: { message: configurationMessage } }),
    { status: 503, code: 'provider_not_configured', message: 'Provider returned error' },
    new Error(configurationMessage, { cause: apiError(503, { 'retry-after': '7' }) }),
    { info: { kind: 'rate', status: 503 }, cause: { error: { code: 'provider_not_configured' } } },
  ])('excludes permanent provider configuration failures from temporary capacity (%#)', error => {
    expect(readRateLimit(error, now)).toBeNull();
  });

  it('keeps authentication and explicit account exhaustion precedence for configuration failures', () => {
    const body = { error: { code: 'provider_not_configured', message: configurationMessage } };
    expect(readRateLimit(apiError(401, undefined, body), now)).toBeNull();
    expect(readRateLimit(apiError(402, undefined, body), now)).toEqual({ quotaExhausted: true });
    expect(readRateLimit(apiError(503, undefined, { ...body, cause: { code: 'insufficient_quota' } }), now)).toEqual({ quotaExhausted: true });
  });

  it('does not inspect configuration wording echoed in request or context when a provider is unavailable', () => {
    const error = new APICallError({ message: 'Service unavailable', url: 'https://provider.test/chat', statusCode: 503,
      requestBodyValues: { code: 'provider_not_configured', prompt: configurationMessage }, responseHeaders: { 'retry-after': '7' },
      responseBody: JSON.stringify({ error: { message: 'Service unavailable' }, request: { code: 'provider_not_configured' }, context: { message: configurationMessage } }),
    });
    expect(readRateLimit(error, now)).toEqual({ quotaExhausted: false, retryAfterMs: 7000 });
  });

  it('recognizes a capacity response embedded in an accepted HTTP request', () => {
    const error = new APICallError({ message: 'Provider returned error', url: 'https://provider.test/chat', requestBodyValues: {}, statusCode: 200,
      responseHeaders: { 'retry-after': '8' }, data: { error: { code: 'NoCapacity', message: peakCapacity } } });
    expect(readRateLimit(error, now)).toEqual({ quotaExhausted: false, retryAfterMs: 8000 });
  });

  it.each([401, 403])('does not treat a rejected credential as capacity even with status %s and capacity details', status => {
    expect(readRateLimit(apiError(status, { 'retry-after': '6' }, { error: { code: 'NoCapacity', message: peakCapacity } }), now)).toBeNull();
  });

  it('gives explicit authentication and billing failures precedence over capacity wording', () => {
    expect(readRateLimit(apiError(503, undefined, { error: { code: 'invalid_api_key', message: peakCapacity } }), now)).toBeNull();
    expect(readRateLimit(apiError(429, undefined, { error: { code: 'insufficient_quota', message: peakCapacity } }), now)).toEqual({ quotaExhausted: true });
    expect(readRateLimit(apiError(402, undefined, { error: { message: peakCapacity } }), now)).toEqual({ quotaExhausted: true });
  });

  it('does not mistake context size, request contents or generic failures for provider capacity', () => {
    expect(readRateLimit(new Error('Your request exceeds the maximum context length.'), now)).toBeNull();
    expect(readRateLimit(new Error('Cannot process this request: invalid input.'), now)).toBeNull();
    expect(readRateLimit(new Error('Authentication service unavailable.'), now)).toBeNull();
    expect(readRateLimit({ statusCode: 400, requestBodyValues: { prompt: peakCapacity }, context: { error: { code: 'NoCapacity' } } }, now)).toBeNull();
    expect(readRateLimit({ statusCode: 401, responseHeaders: { 'retry-after': '10' }, requestBodyValues: { error: { code: 'NoCapacity' } } }, now)).toBeNull();
    expect(readRateLimit(apiError(400, undefined, { error: { code: 'context_length_exceeded', message: 'Maximum context length exceeded.' }, requestBodyValues: { prompt: peakCapacity }, context: { message: peakCapacity } }), now)).toBeNull();
  });

  it('reads a provider error embedded in an HTTP 200 SDK response', () => {
    const error = new APICallError({ message: 'Provider returned error', url: 'https://provider.test/chat', requestBodyValues: {}, statusCode: 200, responseHeaders: { 'retry-after': '8' }, data: { code: 429, message: 'Provider returned error' } });
    expect(readRateLimit(error, now)).toEqual({ quotaExhausted: false, retryAfterMs: 8000 });
  });

  it('reads explicit account exhaustion from SDK provider data', () => {
    const error = new APICallError({ message: 'Provider returned error', url: 'https://provider.test/chat', requestBodyValues: {}, statusCode: 200, data: { code: 'insufficient_quota' } });
    expect(readRateLimit(error, now)).toEqual({ quotaExhausted: true });
  });

  it('distinguishes explicit account quota exhaustion from a transient limit', () => {
    expect(readRateLimit(apiError(429, undefined, { error: { code: 'insufficient_quota', message: 'You exceeded your current quota, please check your plan and billing details.' } }), now)).toEqual({ quotaExhausted: true });
    expect(readRateLimit(apiError(429, undefined, { error: { code: 'rate_limit_exceeded', message: 'Per-minute token quota exceeded' } }), now)).toEqual({ quotaExhausted: false });
    expect(readRateLimit(apiError(429, undefined, { error: { code: 'RESOURCE_EXHAUSTED', message: 'Daily request quota exceeded' } }), now)).toEqual({ quotaExhausted: false });
  });

  it('reads nested provider raw metadata for explicit credit exhaustion', () => {
    expect(readRateLimit(apiError(429, undefined, { error: { message: 'Provider returned error', metadata: { raw: JSON.stringify({ error: { type: 'insufficient_credits', message: 'Insufficient credits' } }) } } }), now)).toEqual({ quotaExhausted: true });
  });

  it('recognizes explicit billing exhaustion even when the provider uses status 402', () => {
    expect(readRateLimit(apiError(402, undefined, { error: { message: 'Insufficient credits' } }), now)).toEqual({ quotaExhausted: true });
  });

  it('does not misread unrelated provider failures or credential-like request contents', () => {
    const error = new APICallError({ message: 'Authentication failed', url: 'https://provider.test/chat', statusCode: 401, requestBodyValues: { apiKey: 'rate limit insufficient credits' }, responseHeaders: { 'retry-after': '20' } });
    expect(readRateLimit(error, now)).toBeNull();
    expect(readRateLimit(new Error('Unknown failure'), now)).toBeNull();
  });

  it('tolerates malformed body JSON and cyclic causes', () => {
    const error = apiError(429);
    const wrapper: { cause?: unknown } = { cause: error };
    Object.assign(error, { cause: wrapper, responseBody: '{ malformed' });
    expect(readRateLimit(wrapper, now)).toEqual({ quotaExhausted: false });
  });
});
