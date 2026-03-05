// src/bot/modes.js — Modos de operación del bot (optimizados para velocidad)
import { filtrarPalabras } from './filters.js';

// Objeto de opciones vacío reutilizable (evita crear uno nuevo por mensaje)
const EMPTY_OPTS = Object.freeze({});

/**
 * Modo Watch: Solo observa y registra mensajes de grupos.
 * Fire-and-forget: no bloquea nada.
 */
export function ModeWatch(msg, { logsColl }) {
  const { key, pushName, messageTimestamp, participant } = msg;
  if (!key.remoteJid.endsWith('@g.us')) return;

  const text = msg.message.conversation || msg.message.extendedTextMessage?.text || '';

  // Fire-and-forget — no await, no bloqueo
  logsColl.insertOne({
    timestamp: Date.now(),
    messageTimestamp: messageTimestamp || Math.floor(Date.now() / 1000),
    groupId: key.remoteJid,
    groupName: 'watch',
    participant: participant || key.participant || key.remoteJid,
    pushName: pushName || '',
    text,
    messageId: key.id,
  }).catch(() => null);
}

/**
 * Modo Flash: Responde a todo de forma ultra-rápida.
 * Envío fire-and-forget, contadores en segundo plano.
 */
export function ModeFlash(msg, ctx) {
  const {
    socket, configuracionGrupos,
    countersColl, gruposColl, configColl,
    docId, state,
  } = ctx;

  const groupId = msg.key.remoteJid;
  if (groupId.charCodeAt(groupId.length - 5) !== 64) return; // fast check for @g.us

  const msgContent = msg.message;
  const text = msgContent.conversation || msgContent.extendedTextMessage?.text || '';
  const isImage = !!msgContent.imageMessage;

  // Ignorar "yo" y mensajes vacíos
  if (!text && !isImage) return;
  if (text.length <= 3 && text.toLowerCase() === 'yo') return;

  const cfg = configuracionGrupos[groupId];
  if (!cfg || !cfg.responder) return;

  const isIndependent = cfg.independiente;
  if (!isIndependent && !state.respuestasActivas) return;

  // Lock de grupo independiente
  const hasLimit = cfg.limite !== null && cfg.limite !== undefined;
  if (isIndependent && hasLimit) {
    if (state.independentLockGroupId && state.independentLockGroupId !== groupId) return;
    if (!state.independentLockGroupId) state.independentLockGroupId = groupId;
  }

  // ENVIAR RESPUESTA — fire-and-forget (no await)
  const opts = cfg.duracion > 0
    ? { isEphemeral: true, ephemeralExpiration: cfg.duracion }
    : EMPTY_OPTS;

  socket.sendMessage(groupId, cfg.respuesta, opts).catch(() => null);

  // Contadores en memoria (inmediato, sin I/O)
  state.OrdenesRecibidas++;
  cfg.contador = (cfg.contador || 0) + 1;

  // BD en segundo plano — fire-and-forget
  countersColl.updateOne(
    { _id: 'OrdenesRecibidas' }, { $inc: { seq: 1 } }, { upsert: true },
  ).catch(() => null);
  gruposColl.updateOne(
    { groupId, configRef: docId },
    { $inc: { contador: 1 }, $set: { updatedAt: new Date() } },
  ).catch(() => null);

  // Verificar límite (pura lógica en memoria, sin I/O)
  if (hasLimit && cfg.contador >= cfg.limite) {
    cfg.responder = false;
    if (isIndependent) {
      gruposColl.updateOne(
        { groupId, configRef: docId },
        { $set: { responder: false, updatedAt: new Date() } },
      ).catch(() => null);
      if (state.independentLockGroupId === groupId) state.independentLockGroupId = null;
    } else {
      state.respuestasActivas = false;
      configColl.updateOne(
        { id: docId }, { $set: { respuestas: false } },
      ).catch(() => null);
    }
  }
}

/**
 * Modo Normal: Filtra por palabras clave, responde, y registra.
 * OPTIMIZADO: sendMessage fire-and-forget, todos los DB ops en background.
 */
export function ModeNormal(msg, ctx) {
  const {
    socket, configuracionGrupos,
    countersColl, gruposColl, configColl, logsColl,
    docId, state, groupMessages, GLOBAL_LIMIT,
  } = ctx;

  const groupId = msg.key.remoteJid;
  if (groupId.charCodeAt(groupId.length - 5) !== 64) return; // fast @g.us check

  const msgContent = msg.message;
  const text = msgContent.conversation || msgContent.extendedTextMessage?.text || '';
  const isImage = !!msgContent.imageMessage;

  const cfg = configuracionGrupos[groupId];
  if (!cfg || !cfg.responder) return;

  const isIndependent = cfg.independiente;
  if (!isIndependent && !state.respuestasActivas) return;

  // Lock de grupo independiente
  const hasLimit = cfg.limite !== null && Number.isFinite(cfg.limite);
  if (isIndependent && hasLimit) {
    if (state.independentLockGroupId && state.independentLockGroupId !== groupId) return;
    if (!state.independentLockGroupId) state.independentLockGroupId = groupId;
  }

  // Verificar límite antes de filtrar (evita trabajo innecesario)
  if (isIndependent && hasLimit && cfg.contador >= cfg.limite) {
    cfg.responder = false;
    gruposColl.updateOne(
      { groupId, configRef: docId },
      { $set: { responder: false, updatedAt: new Date() } },
    ).catch(() => null);
    if (state.independentLockGroupId === groupId) state.independentLockGroupId = null;
    return;
  }

  // Filtrar por tipo y palabras clave
  const tipo = cfg.tipoMensaje;
  let shouldSend = false;

  if (isImage && (tipo === 'imagen' || tipo === 'ambas')) {
    shouldSend = true;
  } else if (text && (tipo === 'texto' || tipo === 'ambas')) {
    shouldSend = filtrarPalabras(text);
  }

  if (!shouldSend) return;

  // ENVIAR RESPUESTA — fire-and-forget (no await = mínima latencia)
  const opts = cfg.duracion > 0
    ? { isEphemeral: true, ephemeralExpiration: cfg.duracion }
    : EMPTY_OPTS;

  socket.sendMessage(groupId, cfg.respuesta, opts).catch(() => null);

  // ─── Todo lo de abajo es post-procesamiento en background ───

  // Contadores en memoria (inmediato)
  state.OrdenesRecibidas++;
  cfg.contador = (cfg.contador || 0) + 1;
  state.mensajeRecibido++;

  // In-memory log (sin límite excesivo)
  if (groupMessages.length < 500) {
    groupMessages.push({ groupId, text, timestamp: Date.now() });
  }

  // BD en background — fire-and-forget
  countersColl.updateOne(
    { _id: 'OrdenesRecibidas' }, { $inc: { seq: 1 } }, { upsert: true },
  ).catch(() => null);

  gruposColl.updateOne(
    { groupId, configRef: docId },
    { $inc: { contador: 1 }, $set: { updatedAt: new Date() } },
  ).catch(() => null);

  logsColl.insertOne({
    groupId, text, timestamp: Date.now(), processed: true,
  }).catch(() => null);

  // Verificar límites en memoria (ya incrementamos cfg.contador)
  if (hasLimit && cfg.contador >= cfg.limite) {
    cfg.responder = false;
    gruposColl.updateOne(
      { groupId, configRef: docId },
      { $set: { responder: false, updatedAt: new Date() } },
    ).catch(() => null);
    if (state.independentLockGroupId === groupId) state.independentLockGroupId = null;
  }

  // Límite global
  if (state.mensajeRecibido >= GLOBAL_LIMIT) {
    state.respuestasActivas = false;
    state.mensajeRecibido = 0;
    configColl.updateOne(
      { id: docId }, { $set: { respuestas: false } },
    ).catch(() => null);
  }
}
