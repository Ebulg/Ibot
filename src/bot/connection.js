// src/bot/connection.js — Conexión del bot WhatsApp (Baileys)
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
} from '@whiskeysockets/baileys';
import QRCode from 'qrcode';
import fs from 'fs';
import path from 'path';
import { connectDB } from '../db.js';
import { ModeWatch, ModeFlash, ModeNormal } from './modes.js';

// ─── Configuración ─────────────────────────────────────
const authUser = process.env.AUTH_USER || 'Tago';
const authPath = `auth/${authUser}`;
const GLOBAL_LIMIT = 1;

// ─── Estado en memoria ─────────────────────────────────
const state = {
  OrdenesRecibidas: 0,
  respuestasActivas: false,
  botActivo: false,
  botModo: 'normal',
  mensajeRecibido: 0,
  independentLockGroupId: null,
};

let configuracionGrupos = {};
let grupoIDs = new Set();
export const groupMessages = [];

let socket = null;

// ─── Colecciones de BD ─────────────────────────────────
const db = await connectDB();
const configColl = db.collection('config');
const gruposColl = db.collection('grupos');
const logsColl = db.collection('logs');
const countersColl = db.collection('counters');
const qrColl = db.collection('qr_history');

const docId = '6845a8c734160e0e48e49362';

// ─── Getters para estado ────────────────────────────────
export function getBotActivo() { return state.botActivo; }
export function getRespuestasActivas() { return state.respuestasActivas; }
export function getBotModo() { return state.botModo; }
export function getOrdenesRecibidas() { return state.OrdenesRecibidas; }

// ─── Helpers para parsear grupo ─────────────────────────
function parseGrupo(g) {
  return {
    nombre: g.nombre ?? 'Sin nombre',
    tipoMensaje: g.tipoMensaje ?? 'texto',
    responder: !!g.responder,
    respuesta: (g.respuesta?.text)
      ? g.respuesta
      : (typeof g.respuesta === 'string' ? { text: g.respuesta } : { text: '' }),
    duracion: g.duracion ?? 0,
    grupo: g.grupo ?? 'otros',
    independiente: !!g.independiente,
    limite: (g.limite === null || g.limite === undefined || g.limite === '')
      ? null
      : (Number.isFinite(Number(g.limite)) ? Number(g.limite) : null),
    contador: Number.isFinite(Number(g.contador)) ? Number(g.contador) : 0,
  };
}

// ─── Carga inicial de configuración ─────────────────────
async function loadInitialConfig() {
  const configDoc = await configColl.findOne({ id: docId });
  if (!configDoc) {
    console.warn('⚠️ Config no encontrada para id', docId);
  } else {
    state.respuestasActivas = !!configDoc.respuestas;
    state.botActivo = !!configDoc.activo;
    state.botModo = configDoc.modo || 'normal';
  }

  // Cargar grupos
  const grupos = await gruposColl.find({ configRef: docId }).toArray();
  configuracionGrupos = {};
  for (const g of grupos) {
    configuracionGrupos[g.groupId] = parseGrupo(g);
  }
  grupoIDs = new Set(Object.keys(configuracionGrupos));

  // Cargar contador global
  const counter = await countersColl.findOne({ _id: 'OrdenesRecibidas' });
  state.OrdenesRecibidas = counter?.seq ?? 0;

  console.log(
    `📋 Config cargada — Grupos: ${grupoIDs.size}`,
    `| Respuestas: ${state.respuestasActivas}`,
    `| Modo: ${state.botModo}`,
  );
}

await loadInitialConfig();

// ─── Change Streams ─────────────────────────────────────

// Stream de configuración global
const changeStreamConfig = configColl.watch([], { fullDocument: 'updateLookup' });
changeStreamConfig.on('change', async (change) => {
  try {
    const full = change.fullDocument;
    if (!full) return;

    if (typeof full.respuestas === 'boolean') {
      state.respuestasActivas = full.respuestas;
      console.log('🔄 respuestasActivas →', state.respuestasActivas);
    }
    if (typeof full.activo === 'boolean') {
      state.botActivo = full.activo;
      console.log('🔄 botActivo →', state.botActivo);
    }
    if (full.modo) {
      state.botModo = full.modo;
      console.log('🔄 botModo →', state.botModo);
    }
  } catch (err) {
    console.error('changeStreamConfig error:', err);
  }
});

// Stream de grupos
const changeStreamGrupos = gruposColl.watch([], { fullDocument: 'updateLookup' });
changeStreamGrupos.on('change', async (change) => {
  try {
    let full = change.fullDocument;

    // Fallback si no vino fullDocument
    if (!full) {
      const docKey = change.documentKey?._id;
      if (docKey) {
        full = await gruposColl.findOne({ _id: docKey, configRef: docId });
      } else {
        console.warn('changeStreamGrupos: sin fullDocument ni documentKey');
        return;
      }
    }
    if (!full) return;

    // Merge con lo existente para no perder campos
    const existing = configuracionGrupos[full.groupId] || {};
    configuracionGrupos[full.groupId] = {
      nombre: full.nombre ?? existing.nombre,
      tipoMensaje: full.tipoMensaje ?? existing.tipoMensaje,
      responder: full.responder !== undefined ? !!full.responder : !!existing.responder,
      respuesta: full.respuesta !== undefined
        ? (full.respuesta?.text ? full.respuesta : (typeof full.respuesta === 'string' ? { text: full.respuesta } : full.respuesta))
        : existing.respuesta,
      duracion: full.duracion ?? existing.duracion,
      grupo: full.grupo ?? existing.grupo,
      independiente: full.independiente !== undefined ? !!full.independiente : !!existing.independiente,
      limite: full.limite === undefined
        ? (existing.limite ?? null)
        : (full.limite === null ? null : Number(full.limite)),
      contador: full.contador !== undefined ? Number(full.contador) : Number(existing.contador || 0),
    };

    // Si fue delete, recargar todo
    if (change.operationType === 'delete') {
      const all = await gruposColl.find({ configRef: docId }).toArray();
      configuracionGrupos = {};
      for (const g of all) {
        configuracionGrupos[g.groupId] = parseGrupo(g);
      }
    }

    grupoIDs = new Set(Object.keys(configuracionGrupos));
    console.log('🔄 grupo actualizado:', full.groupId);
  } catch (err) {
    console.error('changeStreamGrupos error:', err);
  }
});

// ─── Iniciar Bot ────────────────────────────────────────
export async function iniciarBot() {
  try {
    const { state: authState, saveCreds } = await useMultiFileAuthState(authPath);
    const { version, isLatest } = await fetchLatestBaileysVersion();
    console.log(`🤖 Baileys v${version.join('.')} (latest: ${isLatest}) — auth: ${authPath}`);

    socket = makeWASocket({
      connectTimeoutMs: 120000,
      auth: authState,
      version,
    });

    socket.ev.on('creds.update', saveCreds);

    // Manejo de conexión
    socket.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
      try {
        if (qr) {
          const lastQRCode = await QRCode.toDataURL(qr);
          await qrColl.insertOne({ configRef: docId, qr: lastQRCode, createdAt: new Date() });
          await configColl.updateOne(
            { id: docId },
            { $set: { qr: lastQRCode, estado: 'qr_generado' } },
          );
          console.log('📱 QR generado y guardado');
          return;
        }

        if (!qr && connection === 'connecting') {
          await configColl.updateOne({ id: docId }, { $set: { estado: 'procesando' } });
          console.log('⏳ Estado: procesando (esperando sesión)');
          return;
        }

        if (connection === 'close') {
          const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== 401;
          console.log('🔌 Conexión cerrada, reconectar:', shouldReconnect);
          await configColl.updateOne(
            { id: docId },
            { $set: { estado: 'desconectado', qr: null, activo: false } },
          );
          state.botActivo = false;
          if (shouldReconnect) {
            setTimeout(
              () => iniciarBot().catch((err) => console.error('Reinicio fallido:', err)),
              2000,
            );
          }
          return;
        }

        if (connection === 'open') {
          console.log('✅ Bot conectado');
          state.botActivo = true;
          await qrColl.deleteMany({ configRef: docId });
          await configColl.updateOne(
            { id: docId },
            { $set: { estado: 'listo', qr: null, activo: true } },
          );
        }
      } catch (err) {
        console.error('connection.update error:', err);
      }
    });

    // Contexto compartido para los modos
    const modeCtx = {
      socket,
      configuracionGrupos,
      get respuestasActivas() { return state.respuestasActivas; },
      countersColl,
      gruposColl,
      configColl,
      logsColl,
      docId,
      state,
      groupMessages,
      GLOBAL_LIMIT,
    };

    // Manejo de mensajes entrantes — non-blocking
    socket.ev.on('messages.upsert', (m) => {
      const msgs = m.messages;
      if (!msgs) return;

      for (let i = 0; i < msgs.length; i++) {
        const msg = msgs[i];
        if (!msg.message || msg.key.fromMe) continue;

        try {
          if (state.botModo === 'watch') {
            ModeWatch(msg, { logsColl });
          } else if (state.botModo === 'flash') {
            ModeFlash(msg, modeCtx);
          } else {
            ModeNormal(msg, modeCtx);
          }
        } catch (err) {
          // Sync error — log and continue with next message
          console.error('message handler error:', err);
        }
      }
    });


    console.log('🚀 Bot inicializado');
  } catch (err) {
    console.error('Error iniciando bot:', err);
    throw err;
  }
}

// ─── Apagar Bot ─────────────────────────────────────────
export async function apagar() {
  try {
    if (socket) {
      try {
        if (typeof socket.logout === 'function') await socket.logout();
      } catch (logoutErr) {
        console.warn('Error en socket.logout:', logoutErr);
      }
      try {
        if (typeof socket.end === 'function') socket.end();
      } catch (endErr) {
        console.warn('Error en socket.end:', endErr);
      }
      socket = null;
    }

    state.botActivo = false;
    state.respuestasActivas = false;

    await configColl.updateOne(
      { id: docId },
      { $set: { estado: 'apagado', qr: null, activo: false, respuestas: false } },
    ).catch(() => null);

    // Eliminar carpeta de autenticación
    try {
      const dirToRemove = path.resolve(authPath);
      await fs.promises.rm(dirToRemove, { recursive: true, force: true });
      console.log(`🗑️ Auth eliminado: ${dirToRemove}`);
    } catch (rmErr) {
      console.error('Error borrando carpeta auth:', rmErr);
    }

    console.log('🛑 Bot apagado correctamente');
  } catch (err) {
    console.error('Error al apagar bot:', err);
  }
}
