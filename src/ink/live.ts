import { useCallback, useSyncExternalStore } from 'react';
import { z } from 'zod';
import { validateCipher, type VaultSession } from '@/cloud/vault/crypto';
import { inkPointSchema, inkStyleShape, type InkStrokeData } from './model';
import type { NoteInkAnchor } from '@/workspace/noteInkModel';

export interface LiveInkScope { surface: 'board' | 'note' | 'notebook' | 'planner'; documentId: string }
export interface LiveInkStrokeData extends InkStrokeData { id?: string; x?: number; y?: number; anchor?: NoteInkAnchor }
export interface LiveInkFrame { version: 1; sender: string; scope: LiveInkScope; gestureId: string; seq: number; phase: 'preview' | 'commit' | 'cancel'; stroke?: LiveInkStrokeData }
export interface LiveInkStroke { gestureId: string; sender: string; scope: LiveInkScope; stroke: LiveInkStrokeData; committed: boolean }
interface Options { session: VaultSession; fetcher?: typeof fetch; isActive?: () => boolean; onCommit?: (frame: LiveInkFrame) => void }
const PURPOSE = 'live-ink:v1', ENDPOINT = '/api/live/ink', MAX_BYTES = 512 * 1024, PREVIEW_TTL = 8000, COMMIT_TTL = 120000;
const empty: LiveInkStroke[] = [];
const identifier = z.string().regex(/^[\w:-]{1,160}$/).refine(value => !['constructor', 'prototype', '__proto__'].includes(value));
const coordinate = z.number().finite().min(-100000).max(100000);
const scopeSchema = z.object({ surface: z.enum(['board', 'note', 'notebook', 'planner']), documentId: identifier }).strict();
const strokeSchema = z.object({
  id: identifier.optional(), x: coordinate.optional(), y: coordinate.optional(),
  color: z.string().regex(/^#[\da-fA-F]{6}$/), width: z.number().finite().min(.25).max(24),
  points: z.array(inkPointSchema).min(1).max(4096), ...inkStyleShape,
  anchor: z.object({ id: z.string().regex(/^(title|document|block:[\w-]{1,100})$/), x: z.number().finite().min(0).max(10000), y: z.number().finite().min(0).max(10000), width: z.number().finite().min(1).max(10000) }).strict().optional(),
}).strict();
const frameSchema = z.object({ version: z.literal(1), sender: identifier, scope: scopeSchema, gestureId: identifier, seq: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER), phase: z.enum(['preview', 'commit', 'cancel']), stroke: strokeSchema.optional() }).strict().refine(frame => frame.phase !== 'preview' || !!frame.stroke);
const scopeKey = (scope: LiveInkScope) => `${scope.surface}:${scope.documentId}`;
const gestureKey = (scope: LiveInkScope, id: string) => `${scopeKey(scope)}:${id}`;
function browserEvent(name: string, detail?: unknown) { if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(name, { detail })); }
function unref(timer: ReturnType<typeof setTimeout> | ReturnType<typeof setInterval>) { (timer as unknown as { unref?: () => void }).unref?.(); return timer; }

/** Coordinates are encrypted before fetch. These previews never enter persistent storage. */
export class LiveInkChannel {
  readonly sender = crypto.randomUUID();
  private readonly fetcher: typeof fetch;
  private readonly local = new Map<string, { scope: LiveInkScope; gestureId: string; stroke: LiveInkStrokeData; at: number }>();
  private readonly pending = new Map<string, Omit<LiveInkFrame, 'sender' | 'seq' | 'version'>>();
  private readonly terminal: Omit<LiveInkFrame, 'sender' | 'seq' | 'version'>[] = [];
  private readonly remote = new Map<string, LiveInkStroke & { expires: number }>();
  private readonly remoteScopes = new Map<string, LiveInkStroke[]>();
  private readonly acknowledged = new Map<string, number>();
  private readonly received = new Map<string, { seq: number; at: number }>();
  private readonly listeners = new Set<() => void>();
  private sequence = 0;
  private closed = false;
  private started = false;
  private sending = false;
  private lastSendAt: number | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private reconnect: ReturnType<typeof setTimeout> | undefined;
  private cleanup: ReturnType<typeof setInterval>;
  private connection: AbortController | undefined;
  private reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  private requests = new AbortController();
  constructor(private readonly options: Options) {
    const fetcher = options.fetcher ?? fetch;
    // Native browser fetch must not receive this channel as its receiver.
    this.fetcher = (input, init) => fetcher(input, init);
    this.cleanup = unref(setInterval(() => this.expire(), 250));
  }
  private available() { if (this.closed) return false; if (this.options.isActive && !this.options.isActive()) { this.dispose(); return false; } return true; }
  readonly subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getRemote(scope: LiveInkScope): LiveInkStroke[] { return this.remoteScopes.get(scopeKey(scope)) ?? empty; }
  /** Retire only completed previews already present in an applied, validated document. */
  acknowledge(scope: LiveInkScope, strokeIds: readonly string[]) {
    if (!this.available() || !strokeIds.length) return;
    const ids = new Set(strokeIds); let changed = false;
    // HTTP snapshots and SSE can arrive in either order. Remember a bounded
    // window of canonical IDs even after their stroke has been erased locally.
    for (const id of ids) {
      const key = gestureKey(scope, id); this.acknowledged.delete(key); this.acknowledged.set(key, Date.now() + COMMIT_TTL);
      if (this.acknowledged.size > 8192) this.acknowledged.delete(this.acknowledged.keys().next().value!);
    }
    for (const [key, value] of this.remote) {
      if (value.committed && scopeKey(value.scope) === scopeKey(scope) && ids.has(value.stroke.id ?? value.gestureId)) { this.remote.delete(key); changed = true; }
    }
    if (changed) this.changed();
  }
  hasLocalGesture() { return this.local.size > 0; }
  private changed() {
    this.remoteScopes.clear();
    for (const value of this.remote.values()) { const key = scopeKey(value.scope); const values = this.remoteScopes.get(key) ?? []; values.push(value); this.remoteScopes.set(key, values); }
    for (const listener of this.listeners) listener();
  }
  private activity() { browserEvent('dynamic-diary:ink-activity', { active: this.local.size > 0 }); }
  preview(scope: LiveInkScope, gestureId: string, stroke: LiveInkStrokeData) {
    if (!this.available()) return;
    // Keep pointer movement O(1). Full point validation happens only for the coalesced frame we send.
    if (!scopeSchema.safeParse(scope).success || !identifier.safeParse(gestureId).success || !Array.isArray(stroke.points) || stroke.points.length < 1 || stroke.points.length > 4096) return;
    const key = gestureKey(scope, gestureId);
    if (!this.local.has(key) && this.local.size >= 8) return;
    const wasActive = this.local.size > 0;
    this.local.set(key, { scope, gestureId, stroke, at: Date.now() });
    this.pending.set(key, { scope, gestureId, phase: 'preview', stroke });
    if (!wasActive) this.activity(); this.schedule();
  }
  finish(scope: LiveInkScope, gestureId: string, cancelled = false) {
    if (!this.available()) return;
    const key = gestureKey(scope, gestureId), local = this.local.get(key); if (!local) return;
    this.local.delete(key); this.pending.delete(key); this.activity();
    // A bounded final queue stays ordered behind an in-flight frame; intermediate previews are expendable.
    if (this.terminal.length >= 32) this.terminal.shift();
    this.terminal.push({ scope, gestureId, phase: cancelled ? 'cancel' : 'commit', ...(cancelled ? {} : { stroke: local.stroke }) });
    if (this.timer) clearTimeout(this.timer); this.timer = undefined; void this.flush();
  }
  private schedule(resuming = false) {
    if (this.timer || this.sending || !this.available()) return;
    // A slow POST already consumes the cadence interval. Keep the first preview
    // delayed, but resume queued movement as soon as the previous send permits.
    const delay = resuming && this.lastSendAt !== undefined ? Math.max(0, 100 - (Date.now() - this.lastSendAt)) : 100;
    if (!delay) void this.flush();
    else this.timer = unref(setTimeout(() => { this.timer = undefined; void this.flush(); }, delay));
  }
  private async flush() {
    if (this.sending || !this.available()) return; this.sending = true;
    try {
      // At most one current preview per gesture is sent per tick. Terminal frames can flush immediately.
      const batch = this.terminal.splice(0);
      if (!batch.length) { batch.push(...this.pending.values()); this.pending.clear(); }
      for (const partial of batch) {
        if (!this.available()) return;
        if (partial.phase === 'preview' && !this.local.has(gestureKey(partial.scope, partial.gestureId))) continue;
        const parsed = frameSchema.safeParse({ version: 1, sender: this.sender, seq: ++this.sequence, ...partial });
        if (!parsed.success) continue;
        const frame = parsed.data;
        try {
          const encrypted = await this.options.session.seal(JSON.stringify(frame), PURPOSE);
          if (!this.available()) return;
          const body = JSON.stringify(encrypted); if (body.length > MAX_BYTES || typeof navigator !== 'undefined' && navigator.onLine === false) continue;
          this.lastSendAt = Date.now();
          const response = await this.fetcher(ENDPOINT, { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'content-type': 'application/json', 'x-cellproject-request': '1' }, body, signal: AbortSignal.any([this.requests.signal, AbortSignal.timeout(8000)]) });
          await response.body?.cancel();
          if ([401, 403].includes(response.status)) { this.dispose(); return; }
        } catch { /* Offline previews are discarded; durable document sync remains the source of truth. */ }
      }
    } finally { this.sending = false; if (this.terminal.length && this.available()) void this.flush(); else if (this.pending.size) this.schedule(true); }
  }
  async receive(value: unknown): Promise<void> {
    if (!this.available()) return;
    try {
      const envelope = validateCipher(value, 384 * 1024), plain = await this.options.session.openText(envelope, PURPOSE);
      if (!this.available() || plain.length > 384 * 1024) return;
      const parsed = frameSchema.safeParse(JSON.parse(plain)); if (!parsed.success) return;
      const frame = parsed.data;
      if (frame.sender === this.sender || frame.seq <= (this.received.get(frame.sender)?.seq ?? -1)) return;
      this.received.set(frame.sender, { seq: frame.seq, at: Date.now() }); if (this.received.size > 128) this.received.delete(this.received.keys().next().value!);
      const key = `${frame.sender}:${gestureKey(frame.scope, frame.gestureId)}`;
      if (frame.phase === 'cancel') this.remote.delete(key);
      else {
        const stroke = frame.stroke ?? this.remote.get(key)?.stroke;
        if (stroke) {
          if ((this.acknowledged.get(gestureKey(frame.scope, stroke.id ?? frame.gestureId)) ?? 0) > Date.now()) this.remote.delete(key);
          else { this.remote.set(key, { gestureId: frame.gestureId, sender: frame.sender, scope: frame.scope, stroke, committed: frame.phase === 'commit', expires: Date.now() + (frame.phase === 'commit' ? COMMIT_TTL : PREVIEW_TTL) }); if (this.remote.size > 128) this.remote.delete(this.remote.keys().next().value!); }
        }
        if (frame.phase === 'commit') {
          try { this.options.onCommit?.(frame); } catch { /* An observer must not break the encrypted event stream. */ }
          browserEvent('dynamic-diary:cloud-commit', { scope: frame.scope, sender: frame.sender });
        }
      }
      this.changed();
    } catch { /* Wrong vaults, malformed ciphertext and untrusted payloads produce no visible content. */ }
  }
  private expire() {
    if (!this.available()) return;
    const time = Date.now(); let changed = false, activity = false;
    for (const [key, value] of this.remote) if (value.expires <= time) { this.remote.delete(key); changed = true; }
    for (const [key, expires] of this.acknowledged) if (expires <= time) this.acknowledged.delete(key);
    for (const [key, value] of this.local) if (time - value.at > PREVIEW_TTL) { this.local.delete(key); this.pending.delete(key); activity = true; }
    for (const [key, value] of this.received) if (time - value.at > 600000) this.received.delete(key);
    if (changed) this.changed(); if (activity) this.activity();
  }
  start() { if (this.started || !this.available()) return; this.started = true; void this.connect(); }
  private async connect() {
    if (!this.available()) return;
    const controller = new AbortController(); this.connection = controller;
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    const alive = () => { if (watchdog) clearTimeout(watchdog); watchdog = unref(setTimeout(() => controller.abort(), 45000)); };
    try {
      alive();
      const response = await this.fetcher(ENDPOINT, { credentials: 'same-origin', cache: 'no-store', headers: { accept: 'text/event-stream' }, signal: controller.signal });
      if ([401, 403].includes(response.status)) { await response.body?.cancel(); this.dispose(); return; }
      if (!this.available() || !response.ok || !response.headers.get('content-type')?.startsWith('text/event-stream') || !response.body) { await response.body?.cancel(); return; }
      const reader = response.body.getReader(); this.reader = reader;
      const decoder = new TextDecoder('utf-8', { fatal: true }); let buffer = '';
      try {
        while (this.available() && !controller.signal.aborted) {
          const { value, done } = await reader.read(); if (done) break; alive();
          buffer += decoder.decode(value, { stream: true }).replaceAll('\r\n', '\n');
          if (buffer.length > MAX_BYTES + 1024) throw new Error('Drawing stream exceeds the frame limit.');
          let end;
          while ((end = buffer.indexOf('\n\n')) !== -1) {
            const message = buffer.slice(0, end); buffer = buffer.slice(end + 2);
            const lines = message.split('\n'); if (!lines.includes('event: ink')) continue;
            const data = lines.filter(line => line.startsWith('data: ')).map(line => line.slice(6)).join('\n');
            try { await this.receive(JSON.parse(data)); } catch { /* Invalid frames are ignored without logging their contents. */ }
          }
        }
      } finally { if (this.reader === reader) this.reader = undefined; await reader.cancel().catch(() => {}); reader.releaseLock(); }
    } catch { /* Reconnect without replaying expired previews. */ }
    finally {
      if (watchdog) clearTimeout(watchdog); controller.abort();
      if (this.connection === controller) this.connection = undefined;
      if (this.available()) this.reconnect = unref(setTimeout(() => { this.reconnect = undefined; void this.connect(); }, 2000));
    }
  }
  dispose() {
    if (this.closed) return; this.closed = true;
    clearInterval(this.cleanup); if (this.timer) clearTimeout(this.timer); if (this.reconnect) clearTimeout(this.reconnect);
    this.connection?.abort(); void this.reader?.cancel().catch(() => {}); this.requests.abort();
    const active = this.local.size > 0; this.local.clear(); this.pending.clear(); this.terminal.length = 0; this.received.clear(); this.remote.clear(); this.acknowledged.clear(); this.changed(); if (active) this.activity();
  }
}

let current: LiveInkChannel | null = null;
const configuration = new Set<() => void>();
export function configureLiveInk(channel: LiveInkChannel | null) { if (current === channel) return; current?.dispose(); current = channel; for (const listener of configuration) listener(); }
export const getLiveInk = () => current;
export const liveInkGestureActive = () => current?.hasLocalGesture() ?? false;
const subscribeConfiguration = (listener: () => void) => { configuration.add(listener); return () => { configuration.delete(listener); }; };
const noSubscribe = () => () => {};
const noChannel = () => null;
export function useLiveInk(scope: LiveInkScope) {
  const channel = useSyncExternalStore(subscribeConfiguration, getLiveInk, noChannel);
  const { surface, documentId } = scope;
  const snapshot = useCallback(() => channel?.getRemote({ surface, documentId }) ?? empty, [channel, surface, documentId]);
  const remote = useSyncExternalStore(channel?.subscribe ?? noSubscribe, snapshot, () => empty);
  const preview = useCallback((gestureId: string, stroke: LiveInkStrokeData) => channel?.preview({ surface, documentId }, gestureId, stroke), [channel, surface, documentId]);
  const finish = useCallback((gestureId: string, cancelled = false) => channel?.finish({ surface, documentId }, gestureId, cancelled), [channel, surface, documentId]);
  return { remote, preview, finish };
}
