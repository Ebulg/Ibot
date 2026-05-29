import fs from 'fs';
import path from 'path';
import makeWASocket, { DisconnectReason, fetchLatestBaileysVersion, makeCacheableSignalKeyStore } from '@whiskeysockets/baileys';
import QRCode from 'qrcode';
import { FileLogStore } from '../core/file-log-store.js';
import { ChatStore } from '../core/chat-store.js';
import { WriteBehindQueue } from '../core/write-behind-queue.js';
import { ensureDir, now } from '../core/utils.js';
import { getAccountSessionPath } from '../services/account-service.js';
import { normalizeGroupDoc } from './utils/group-normalizer.js';
import { extractMessage } from './utils/message-extractor.js';
import { handleNormal } from './modes/normal.js';
import { handleWatch } from './modes/watch.js';
import { handleIa } from './modes/ia.js';
import { useMongoDBAuthState } from './utils/mongo-auth-state.js';

export class BotRuntime {
  constructor({ accountId, collections, eventBus }) {
    this.accountId = accountId;
    this.collections = collections;
    this.eventBus = eventBus;
    this.sessionPath = getAccountSessionPath(accountId);
    this.authPath = path.join(this.sessionPath, 'auth');
    this.logger = new FileLogStore({ accountId, sessionPath: this.sessionPath, eventBus });
    this.chatStore = new ChatStore({ accountId, collections, eventBus });
    this.queue = new WriteBehindQueue({ collections, accountId, logger: this.logger });
    this.groupsById = new Map();
    this.groupMetadataCache = new Map();
    this.aiMemory = new Map();
    this.socket = null;
    this.config = null;
    this.status = 'stopped';
    this.qr = null;
    this.isStarting = false;
    this.isStopping = false;
    this.reconnectTimer = null;
    this.generation = 0;
    this.watchers = [];
    this.pollTimer = null;
    this.state = {
      ordenesRecibidas: 0,
      mensajesRespondidos: 0,
      independentLockGroupId: null,
      aiCooldowns: new Map(),
      notificationSent: false,
    };
  }

  async init() {
    await ensureDir(this.sessionPath);
    await ensureDir(this.authPath);
    await this.logger.init();
    await this.chatStore.init();
    await this.reloadConfig();
    await this.reloadGroups();
    await this.loadCounter();
    this.startWatchers();
  }

  async loadCounter() {
    const counter = await this.collections.counters.findOne({ accountId: this.accountId, name: 'OrdenesRecibidas' });
    this.state.ordenesRecibidas = Number(counter?.seq || 0);
  }

  async reloadConfig() {
    const oldRespuestas = this.config?.respuestas;
    const config = await this.collections.configs.findOne({ accountId: this.accountId });
    this.config = config || { accountId: this.accountId, activo: false, respuestas: false, modo: 'normal' };
    if (this.config.modo === 'flash') this.config.modo = 'normal';

    if (!oldRespuestas && this.config.respuestas) {
      this.state.mensajesRespondidos = 0;
      this.logger.info('runtime', 'Respuestas globales activadas; reiniciando contador global de mensajes a 0');
    }
    return this.config;
  }

  async reloadGroups() {
    const groups = await this.collections.groups.find({ accountId: this.accountId }).toArray();
    this.groupsById.clear();
    for (const g of groups) {
      const parsed = normalizeGroupDoc(g);
      this.groupsById.set(parsed.groupId, parsed);
      if (parsed.metadata) this.groupMetadataCache.set(parsed.groupId, parsed.metadata);
    }
    this.logger.info('runtime', 'Grupos cargados en memoria', { total: this.groupsById.size });
  }

  startWatchers() {
    if (this.watchers.length || this.pollTimer) return;
    const watchCollection = (collection, name, onChange) => {
      try {
        const stream = collection.watch([{ $match: { 'fullDocument.accountId': this.accountId } }], { fullDocument: 'updateLookup' });
        stream.on('change', onChange);
        stream.on('error', (err) => {
          this.logger.warn('mongo', `Change stream ${name} falló; usando polling`, { error: err.message });
          this.startPollingFallback();
        });
        stream.on('close', () => this.logger.warn('mongo', `Change stream ${name} cerrado`));
        this.watchers.push(stream);
      } catch (err) {
        this.logger.warn('mongo', `No se pudo iniciar change stream ${name}; usando polling`, { error: err.message });
        this.startPollingFallback();
      }
    };

    watchCollection(this.collections.configs, 'configs', async (change) => {
      if (change.fullDocument?.accountId !== this.accountId) return;
      await this.reloadConfig();
      this.logger.info('config', 'Configuración recargada', { modo: this.config.modo, respuestas: this.config.respuestas });
    });

    try {
      const stream = this.collections.groups.watch([], { fullDocument: 'updateLookup' });
      stream.on('change', async (change) => {
        const full = change.fullDocument;
        if (full && full.accountId !== this.accountId) return;
        if (change.operationType === 'delete' || !full) {
          await this.reloadGroups();
          return;
        }
        const parsed = normalizeGroupDoc(full);
        this.groupsById.set(parsed.groupId, parsed);
        this.logger.info('groups', 'Grupo actualizado en memoria', { groupId: parsed.groupId });
      });
      stream.on('error', (err) => {
        this.logger.warn('mongo', 'Change stream groups falló; usando polling', { error: err.message });
        this.startPollingFallback();
      });
      this.watchers.push(stream);
    } catch (err) {
      this.logger.warn('mongo', 'No se pudo iniciar change stream groups; usando polling', { error: err.message });
      this.startPollingFallback();
    }
  }

  startPollingFallback() {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => {
      Promise.all([this.reloadConfig(), this.reloadGroups()]).catch((err) => {
        this.logger.warn('mongo', 'Polling de configuración falló', { error: err.message });
      });
    }, 5000);
    this.pollTimer.unref?.();
  }

  async updateStatus(status, extra = {}) {
    this.status = status;
    await this.collections.accounts.updateOne(
      { accountId: this.accountId },
      { $set: { status, updatedAt: now(), ...extra } },
    ).catch(() => null);
    await this.collections.configs.updateOne(
      { accountId: this.accountId },
      { $set: { estado: status, updatedAt: now(), ...(extra.qr !== undefined ? { qr: extra.qr } : {}) } },
    ).catch(() => null);
    this.eventBus.emit(`status:${this.accountId}`, this.getPublicStatus());
  }

  async start() {
    if (this.socket && ['connected', 'connecting', 'qr', 'starting', 'reconnecting'].includes(this.status)) {
      return this.getPublicStatus();
    }
    if (this.isStarting) return this.getPublicStatus();
    this.isStarting = true;
    this.isStopping = false;
    const myGeneration = ++this.generation;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;

    try {
      await this.reloadConfig();
      await this.reloadGroups();
      await this.collections.configs.updateOne({ accountId: this.accountId }, { $set: { activo: true, updatedAt: now() } });
      this.config.activo = true;
      await this.updateStatus('starting', { qr: null });

      const { state, saveCreds } = await useMongoDBAuthState(this.collections.whatsappSessions, this.accountId);
      const versionInfo = await fetchLatestBaileysVersion().catch(() => ({ version: undefined, isLatest: false }));
      const version = versionInfo.version;
      this.logger.info('baileys', 'Iniciando socket', { version, latest: versionInfo.isLatest });

      // Create a dummy logger to suppress verbose Baileys logging and avoid disk/console clutter.
      const childLogger = {
        trace: () => {},
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
        child: () => childLogger
      };

      const sock = makeWASocket({
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, childLogger),
        },
        logger: childLogger,
        version,
        connectTimeoutMs: 120000,
        browser: ['IbotV2', 'Chrome', '2.0.0'],
        markOnlineOnConnect: false,
        syncFullHistory: false,
        shouldSyncHistoryMessage: () => false,
        printQRInTerminal: false,
        cachedGroupMetadata: async (jid) => this.groupMetadataCache.get(jid),
      });

      this.socket = sock;
      sock.ev.on('creds.update', saveCreds);
      sock.ev.on('connection.update', (update) => this.handleConnectionUpdate(update, myGeneration).catch((err) => {
        this.logger.error('connection', 'Error procesando connection.update', { error: err.message });
      }));
      sock.ev.on('messages.upsert', (payload) => this.handleMessages(payload).catch((err) => {
        this.logger.error('messages', 'Error procesando messages.upsert', { error: err.message });
      }));
      await this.updateStatus('connecting');
      this.logger.info('runtime', 'Socket inicializado');
      return this.getPublicStatus();
    } catch (err) {
      await this.updateStatus('error', { lastError: err.message });
      this.logger.error('runtime', 'No se pudo iniciar bot', { error: err.message });
      throw err;
    } finally {
      this.isStarting = false;
    }
  }

  async handleConnectionUpdate({ connection, lastDisconnect, qr }, generation) {
    if (generation !== this.generation) return;
    if (qr) {
      const dataUrl = await QRCode.toDataURL(qr);
      this.qr = dataUrl;
      await this.collections.qrHistory.insertOne({ accountId: this.accountId, qr: dataUrl, createdAt: now() }).catch(() => null);
      await this.updateStatus('qr', { qr: dataUrl });
      this.logger.info('connection', 'QR generado');
      return;
    }
    if (connection === 'connecting') {
      await this.updateStatus('connecting');
      return;
    }
    if (connection === 'open') {
      this.qr = null;
      await this.collections.qrHistory.deleteMany({ accountId: this.accountId }).catch(() => null);
      await this.updateStatus('connected', { qr: null, phoneJid: this.socket?.user?.id || null, phoneName: this.socket?.user?.name || null });
      this.logger.info('connection', 'WhatsApp conectado', { user: this.socket?.user });
      this.sendConnectionNotification().catch((err) => {
        this.logger.error('connection', 'Error enviando notificación de conexión', { error: err.message });
      });
      return;
    }
    if (connection === 'close') {
      this.state.notificationSent = false;
      const code = lastDisconnect?.error?.output?.statusCode;
      const loggedOut = code === DisconnectReason.loggedOut || code === 401;
      this.logger.warn('connection', 'Conexión cerrada', { code, loggedOut });
      if (this.isStopping || loggedOut) {
        if (loggedOut) {
            this.logger.warn('connection', 'Sesión invalidada (401). Se requiere nuevo inicio de sesión.');
            await this.logout();
            return;
        }
        await this.updateStatus('stopped', { qr: null });
        return;
      }
      await this.updateStatus('disconnected', { qr: null });
      await this.scheduleReconnect();
    }
  }

  async scheduleReconnect() {
    if (this.reconnectTimer || this.isStopping) return;
    const active = (await this.collections.configs.findOne({ accountId: this.accountId }))?.activo;
    if (!active) return;
    await this.updateStatus('reconnecting');
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.stopSocketOnly().finally(() => this.start().catch((err) => {
        this.logger.error('runtime', 'Reconexion fallida', { error: err.message });
      }));
    }, 2500);
    this.reconnectTimer.unref?.();
  }

  async sendConnectionNotification() {
    if (this.state.notificationSent) return;
    const notifyConfig = this.config?.connectionNotification;
    if (notifyConfig?.enabled && notifyConfig.groupId && notifyConfig.message) {
      this.logger.info('connection', 'Enviando notificación de conexión', { groupId: notifyConfig.groupId });
      await this.socket.sendMessage(notifyConfig.groupId, { text: notifyConfig.message });
      this.state.notificationSent = true;
    }
  }

  async handleMessages(payload) {
    const msgs = payload?.messages || [];
    for (const msg of msgs) {
      if (!msg?.message) continue;
      const extracted = extractMessage(msg);
      if (!extracted.isGroup) continue;
      if (this.config?.modo === 'watch') {
        this.recordChatMessage(extracted);
      }
      this.refreshGroupMetadata(extracted.groupId).catch(() => null);
      const ctx = this.createModeContext();
      try {
        if (this.config.modo === 'watch') handleWatch(extracted, ctx);
        else if (this.config.modo === 'ia') await handleIa(extracted, ctx);
        else handleNormal(extracted, ctx);
      } catch (err) {
        this.logger.error('messages', 'Error en modo de bot', { groupId: extracted.groupId, error: err.message });
      }
    }
  }

  recordChatMessage(extracted) {
    const cfg = this.groupsById.get(extracted.groupId);
    const cached = this.chatStore.groups.get(extracted.groupId);
    this.chatStore.recordMessage({
      id: extracted.id,
      groupId: extracted.groupId,
      groupName: cfg?.nombre || cached?.subject || extracted.groupId,
      senderId: extracted.senderId,
      senderName: extracted.senderName,
      fromMe: extracted.fromMe,
      text: extracted.text,
      mediaType: extracted.mediaType,
    });
  }

  async refreshGroupMetadata(groupId) {
    if (!this.socket || this.groupMetadataCache.has(groupId)) return;
    try {
      const meta = await this.socket.groupMetadata(groupId);
      const normalized = {
        subject: meta.subject || groupId,
        description: meta.desc || '',
        owner: meta.owner || '',
        creation: meta.creation || null,
        participantCount: meta.participants?.length || meta.size || 0,
      };
      this.groupMetadataCache.set(groupId, normalized);
      let pictureUrl = null;
      try { pictureUrl = await this.socket.profilePictureUrl(groupId, 'image'); } catch {}
      await this.chatStore.upsertGroup(groupId, { ...normalized, pictureUrl });
    } catch (err) {
      this.logger.debug('metadata', 'No se pudo obtener metadata del grupo', { groupId, error: err.message });
    }
  }

  createModeContext() {
    return {
      accountId: this.accountId,
      socket: this.socket,
      collections: this.collections,
      config: this.config,
      groupsById: this.groupsById,
      state: this.state,
      logger: this.logger,
      chatStore: this.chatStore,
      queue: this.queue,
      aiMemory: this.aiMemory,
    };
  }

  async stopSocketOnly() {
    const sock = this.socket;
    this.socket = null;
    if (!sock) return;
    try { sock.ev.removeAllListeners?.(); } catch {}
    try { sock.end?.(); } catch {}
  }

  async stop(reason = 'manual_stop') {
    this.isStopping = true;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    ++this.generation;
    await this.stopSocketOnly();
    await this.queue.flush().catch(() => null);
    this.qr = null;
    
    if (reason !== 'server_shutdown') {
      this.config.activo = false;
      this.config.respuestas = false;
      await this.collections.configs.updateOne(
        { accountId: this.accountId },
        { $set: { activo: false, respuestas: false, qr: null, estado: 'stopped', updatedAt: now() } },
      ).catch(() => null);
    } else {
      await this.collections.configs.updateOne(
        { accountId: this.accountId },
        { $set: { qr: null, estado: 'stopped', updatedAt: now() } },
      ).catch(() => null);
    }

    await this.updateStatus('stopped', { qr: null, stopReason: reason });
    this.isStopping = false;
    this.logger.info('runtime', 'Bot detenido sin borrar sesión', { reason });
  }

  async logout() {
    this.isStopping = true;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    ++this.generation;
    const sock = this.socket;
    this.socket = null;
    try { await sock?.logout?.(); } catch (err) { this.logger.warn('runtime', 'logout de Baileys falló', { error: err.message }); }
    await this.stopSocketOnly();
    await this.collections.whatsappSessions.deleteMany({ accountId: this.accountId }).catch(() => null);
    await this.collections.configs.updateOne(
      { accountId: this.accountId },
      { $set: { activo: false, respuestas: false, qr: null, estado: 'logged_out', updatedAt: now() } },
    ).catch(() => null);
    await this.updateStatus('logged_out', { qr: null });
    this.isStopping = false;
    this.logger.warn('runtime', 'Sesión cerrada y auth eliminado');
  }

  getPublicStatus() {
    return {
      accountId: this.accountId,
      status: this.status,
      qr: this.qr || this.config?.qr || null,
      modo: this.config?.modo || 'normal',
      activo: !!this.config?.activo,
      respuestas: !!this.config?.respuestas,
      ordenesRecibidas: this.state.ordenesRecibidas,
      gruposConfigurados: this.groupsById.size,
    };
  }

  async hasSavedSession() {
    const doc = await this.collections.whatsappSessions.findOne({ accountId: this.accountId, key: 'creds' });
    return !!doc?.data;
  }
}
