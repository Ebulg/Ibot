export class EventBus {
  constructor() {
    this.listeners = new Map();
  }

  on(event, listener) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event).add(listener);
    return () => this.off(event, listener);
  }

  off(event, listener) {
    this.listeners.get(event)?.delete(listener);
  }

  emit(event, payload) {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const listener of set) {
      try { listener(payload); } catch (err) { console.error('event listener error:', err); }
    }
  }
}
