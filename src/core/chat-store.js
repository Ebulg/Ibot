import { safeJsonParse } from './utils.js';

export class ChatStore {
  constructor({ accountId, collections, eventBus }) {
    this.accountId = accountId;
    this.collections = collections;
    this.eventBus = eventBus;
    this.groups = new Map();
    this.initialized = false;
  }

  async init() {
    if (this.initialized) return;
    try {
      const docs = await this.collections.chatGroups.find({ accountId: this.accountId }).toArray();
      this.groups = new Map(docs.map((g) => [g.groupId, g]));
      this.initialized = true;
    } catch (err) {
      // Ignorar errores o reintentar en próxima llamada
    }
  }

  upsertGroup(groupId, data = {}) {
    const existing = this.groups.get(groupId) || { groupId, accountId: this.accountId };
    const merged = {
      ...existing,
      ...data,
      groupId,
      accountId: this.accountId,
      updatedAt: Date.now(),
    };
    this.groups.set(groupId, merged);

    // Persist to MongoDB in background
    this.collections.chatGroups.updateOne(
      { accountId: this.accountId, groupId },
      { $set: merged, $setOnInsert: { createdAt: Date.now() } },
      { upsert: true }
    ).catch(() => null);

    this.eventBus?.emit(`chat-groups:${this.accountId}`, merged);
    return merged;
  }

  mediaPreview(mediaType) {
    const map = {
      image: 'Se envió una foto',
      video: 'Se envió un video',
      audio: 'Se envió un audio',
      sticker: 'Se envió un sticker',
      document: 'Se envió un documento',
      contact: 'Se envió un contacto',
      location: 'Se envió una ubicación',
    };
    return map[mediaType] || 'Se envió un mensaje multimedia';
  }

  recordMessage(message) {
    const entry = {
      ts: Date.now(),
      iso: new Date().toISOString(),
      accountId: this.accountId,
      id: message.id || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      groupId: message.groupId,
      groupName: message.groupName || this.groups.get(message.groupId)?.subject || message.groupId,
      senderId: message.senderId || '',
      senderName: message.senderName || '',
      fromMe: !!message.fromMe,
      text: message.text || '',
      mediaType: message.mediaType || null,
      preview: message.text || (message.mediaType ? this.mediaPreview(message.mediaType) : ''),
    };

    // Save to MongoDB in background
    this.collections.chatMessages.updateOne(
      { accountId: this.accountId, id: entry.id },
      { $set: entry, $setOnInsert: { createdAt: new Date() } },
      { upsert: true }
    ).catch(() => null);

    this.upsertGroup(entry.groupId, {
      subject: entry.groupName,
      lastMessagePreview: entry.preview,
      lastMessageAt: entry.ts,
    });

    this.eventBus?.emit(`chat-message:${this.accountId}`, entry);
    return entry;
  }

  recordOutgoing({ groupId, groupName, text }) {
    return this.recordMessage({ groupId, groupName, senderId: 'bot', senderName: 'Bot', fromMe: true, text });
  }

  async listGroups({ q } = {}) {
    await this.init();
    const query = String(q || '').toLowerCase();
    const rows = Array.from(this.groups.values()).filter((g) => {
      if (!query) return true;
      return [g.subject, g.groupId, g.description].some((v) => String(v || '').toLowerCase().includes(query));
    });
    rows.sort((a, b) => Number(b.lastMessageAt || 0) - Number(a.lastMessageAt || 0));
    return rows;
  }

  async readMessages(groupId, { limit = 200 } = {}) {
    await this.init();
    const max = Math.min(Math.max(Number(limit) || 200, 1), 1000);
    const rows = await this.collections.chatMessages
      .find({ accountId: this.accountId, groupId })
      .sort({ ts: -1 })
      .limit(max)
      .toArray();
    return rows.reverse();
  }

  async clear() {
    await this.collections.chatMessages.deleteMany({ accountId: this.accountId });
    await this.collections.chatGroups.deleteMany({ accountId: this.accountId });
    this.groups = new Map();
  }
}
