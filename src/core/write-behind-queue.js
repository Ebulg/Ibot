export class WriteBehindQueue {
  constructor({ collections, accountId, logger }) {
    this.collections = collections;
    this.accountId = accountId;
    this.logger = logger;
    this.pendingCounters = 0;
    this.pendingGroups = new Map();
    this.timer = null;
    this.delayMs = 250;
  }

  incOrder(groupId) {
    this.pendingCounters += 1;
    const current = this.pendingGroups.get(groupId) || 0;
    this.pendingGroups.set(groupId, current + 1);
    this.schedule();
  }

  schedule() {
    if (this.timer) return;
    this.timer = setTimeout(() => this.flush().catch((err) => {
      this.logger?.error('queue', 'Error persistiendo cola', { error: err.message });
    }), this.delayMs);
    this.timer.unref?.();
  }

  async flush() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const counterInc = this.pendingCounters;
    const groupIncs = new Map(this.pendingGroups.entries());
    this.pendingCounters = 0;
    this.pendingGroups.clear();

    const ops = [];
    if (counterInc > 0) {
      ops.push(this.collections.counters.updateOne(
        { accountId: this.accountId, name: 'OrdenesRecibidas' },
        { $inc: { seq: counterInc }, $set: { updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } },
        { upsert: true },
      ));
    }

    for (const [groupId, inc] of groupIncs.entries()) {
      ops.push(this.collections.groups.updateOne(
        { accountId: this.accountId, groupId },
        { $inc: { contador: inc }, $set: { updatedAt: new Date() } },
      ));
    }
    await Promise.allSettled(ops);
  }
}
