import path from 'path';
import { normalizeAccountId, now } from '../core/utils.js';

export function getStorageRoot() {
  return process.env.STORAGE_DIR || 'storage/accounts';
}

export function getAccountSessionPath(accountId) {
  return path.join(getStorageRoot(), normalizeAccountId(accountId));
}

export function defaultBotConfig(accountId) {
  return {
    accountId,
    activo: false,
    respuestas: false,
    estado: 'inicial',
    qr: null,
    modo: 'normal',
    normal: {
      globalLimit: 1,
      filterEnabled: true,
      ignoreOwnMessages: true,
    },
    ia: {
      enabled: false,
      provider: 'zai',
      apiKey: '',
      baseUrl: process.env.ZAI_BASE_URL || 'https://api.z.ai/api/paas/v4',
      model: process.env.ZAI_MODEL || 'glm-5.1',
      commandMode: 'required',
      commands: ['/chat', '/gpt'],
      systemPrompt: 'Eres un asistente útil, breve y profesional dentro de un grupo de WhatsApp. Responde en español salvo que el usuario pida otro idioma.',
      temperature: 0.6,
      maxTokens: 500,
      timeoutMs: 20000,
      perGroupCooldownMs: 3000,
      historyLimit: 8,
      fallbackText: 'No pude generar una respuesta en este momento.',
      onlyConfiguredGroups: true,
      ignoreMedia: true,
      ignoreOwnMessages: true,
    },
    logs: {
      maxConsoleLines: 1000,
      maxChatMessages: 3000,
    },
    connectionNotification: {
      enabled: false,
      groupId: '',
      message: '¡Bot de WhatsApp en línea!'
    },
    createdAt: now(),
    updatedAt: now(),
  };
}

export async function ensureDefaultAccount(collections) {
  const accountId = normalizeAccountId(process.env.DEFAULT_ACCOUNT_ID || process.env.AUTH_USER || 'tago');
  const label = process.env.DEFAULT_ACCOUNT_LABEL || process.env.AUTH_USER || 'Tago';
  await ensureAccount(collections, accountId, label);
  return accountId;
}

export async function ensureAccount(collections, accountIdRaw, labelRaw, userId = null) {
  const normalizedId = normalizeAccountId(accountIdRaw);
  const prefix = userId ? `${userId}-` : '';
  const accountId = (userId && !normalizedId.startsWith(prefix)) ? `${prefix}${normalizedId}` : normalizedId;
  const label = labelRaw || accountIdRaw || accountId;
  const sessionPath = getAccountSessionPath(accountId);

  const setOnInsert = {
    accountId,
    label,
    status: 'stopped',
    phoneJid: null,
    phoneName: null,
    sessionPath,
    createdAt: now(),
  };
  if (userId) {
    setOnInsert.userId = userId;
  }

  await collections.accounts.updateOne(
    { accountId },
    {
      $setOnInsert: setOnInsert,
      $set: { updatedAt: now() },
    },
    { upsert: true },
  );
  const defaultConfig = defaultBotConfig(accountId);
  delete defaultConfig.updatedAt;
  await collections.configs.updateOne(
    { accountId },
    { $setOnInsert: defaultConfig, $set: { updatedAt: now() } },
    { upsert: true },
  );
  await collections.counters.updateOne(
    { accountId, name: 'OrdenesRecibidas' },
    { $setOnInsert: { accountId, name: 'OrdenesRecibidas', seq: 0, createdAt: now() } },
    { upsert: true },
  );
  return collections.accounts.findOne({ accountId });
}

export async function listAccounts(collections, userId = null) {
  const filter = userId ? { userId } : {};
  return collections.accounts.find(filter).sort({ createdAt: 1 }).toArray();
}

export async function getConfig(collections, accountId) {
  return collections.configs.findOne({ accountId: normalizeAccountId(accountId) });
}
