import { configureLiveInk, getLiveInk, LiveInkChannel } from '@/ink/live';
import type { VaultSession } from './vault/crypto';
import { getVaultSession } from './vault/privacy';
import { getCloudRuntime, type CloudRuntime } from './runtime';

interface Options { runtime: CloudRuntime; session: VaultSession; fetcher?: typeof fetch }

/** Owns the ephemeral drawing channel for one unlocked cloud runtime. */
export class CloudInkConnection {
  private channel: LiveInkChannel | null = null;
  private generation = 0;
  private started = false;
  private disposed = false;
  private waitingForAuthentication = false;
  private readonly unsubscribe: () => void;
  constructor(private readonly options: Options) {
    this.unsubscribe = options.runtime.subscribe(() => this.statusChanged());
  }
  private active() { return !this.disposed && getCloudRuntime() === this.options.runtime && getVaultSession() === this.options.session; }
  start() {
    if (this.started || !this.active()) return;
    this.started = true;
    if (this.options.runtime.getSnapshot().issue?.kind === 'session') { this.waitingForAuthentication = true; return; }
    this.open();
  }
  private open() {
    if (!this.active() || !this.started || this.channel) return;
    const generation = ++this.generation, fetcher = this.options.fetcher ?? fetch;
    const authenticatedFetch: typeof fetch = async (input, init) => {
      const response = await fetcher(input, init);
      // An old request must never expire a newer channel, account or unlocked vault.
      if ([401, 403].includes(response.status) && this.active() && this.generation === generation && getLiveInk() === this.channel) this.options.runtime.notifySessionExpired('/api/live/ink');
      return response;
    };
    this.channel = new LiveInkChannel({ session: this.options.session, fetcher: authenticatedFetch, isActive: () => this.active() && this.generation === generation });
    configureLiveInk(this.channel); this.channel.start();
  }
  private stop() {
    this.generation++;
    const channel = this.channel; this.channel = null;
    channel?.dispose(); if (channel && getLiveInk() === channel) configureLiveInk(null);
  }
  private statusChanged() {
    if (!this.active()) { this.dispose(); return; }
    if (this.options.runtime.getSnapshot().issue?.kind === 'session') {
      this.waitingForAuthentication = true; this.stop(); return;
    }
    // Only the runtime's verified same-account recovery clears a session issue.
    if (this.waitingForAuthentication) { this.waitingForAuthentication = false; this.open(); }
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.unsubscribe(); this.stop();
  }
}
