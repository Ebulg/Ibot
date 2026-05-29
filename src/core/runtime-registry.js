import { EventBus } from './event-bus.js';
import { BotRuntime } from '../bot/bot-runtime.js';
import { ensureAccount } from '../services/account-service.js';
import { normalizeAccountId } from './utils.js';

export class RuntimeRegistry {
  constructor({ collections, defaultAccountId = null }) {
    this.collections = collections;
    this.defaultAccountId = defaultAccountId ? normalizeAccountId(defaultAccountId) : null;
    this.eventBus = new EventBus();
    this.runtimes = new Map();
  }

  async resolveAccountId(accountIdRaw) {
    if (accountIdRaw) return normalizeAccountId(accountIdRaw);
    if (this.defaultAccountId) return this.defaultAccountId;
    const first = await this.collections.accounts.findOne({}, { sort: { createdAt: 1 } });
    if (first?.accountId) return normalizeAccountId(first.accountId);
    throw new Error('No hay cuentas de WhatsApp creadas. Crea una cuenta desde Home.');
  }

  async get(accountIdRaw) {
    const accountId = await this.resolveAccountId(accountIdRaw);
    if (this.runtimes.has(accountId)) return this.runtimes.get(accountId);
    const existing = await this.collections.accounts.findOne({ accountId });
    if (!existing) await ensureAccount(this.collections, accountId, accountId);
    const runtime = new BotRuntime({ accountId, collections: this.collections, eventBus: this.eventBus });
    await runtime.init();
    this.runtimes.set(accountId, runtime);

    // Auto-start if session credentials exist on DB and bot is not already running
    const hasSession = await runtime.hasSavedSession();
    if (hasSession && !['connected', 'connecting', 'qr', 'starting', 'reconnecting'].includes(runtime.status)) {
      runtime.start().catch((err) => {
        console.error(`[registry] Error auto-starting runtime for ${accountId}:`, err);
      });
    }

    return runtime;
  }

  async start(accountId) {
    const runtime = await this.get(accountId);
    await runtime.start();
    return runtime.getPublicStatus();
  }

  async stop(accountId, reason = 'manual_stop') {
    const runtime = await this.get(accountId);
    await runtime.stop(reason);
    return runtime.getPublicStatus();
  }

  async logout(accountId) {
    const runtime = await this.get(accountId);
    await runtime.logout();
    return runtime.getPublicStatus();
  }

  async stopAll(reason = 'stop_all') {
    const list = Array.from(this.runtimes.values());
    await Promise.allSettled(list.map((runtime) => runtime.stop(reason)));
  }
}
