// server.js — Punto de entrada del servidor
import 'dotenv/config';
import express from 'express';
import { connectDB } from './src/db.js';
import { iniciarBot, apagar, groupMessages } from './src/bot/index.js';
import { createApiRouter } from './src/routes/api.js';

const app = express();
const port = process.env.PORT || 4310;

app.use(express.static('public'));
app.use(express.json());

// ─── Conexión a BD ──────────────────────────────────────
const db = await connectDB();
const configColl = db.collection('config');
const gruposColl = db.collection('grupos');
const logsColl = db.collection('logs');
const countersColl = db.collection('counters');
const qrColl = db.collection('qr_history');

const DOC_ID = '6845a8c734160e0e48e49362';

// Asegurar documento config
await configColl.updateOne(
  { id: DOC_ID },
  { $setOnInsert: { id: DOC_ID, activo: false, respuestas: false, estado: 'inicial' } },
  { upsert: true },
);

// Estado inicial consistente
await configColl.updateOne(
  { id: DOC_ID },
  { $set: { activo: false, respuestas: false, qr: null } },
);

// ─── Toggle Bot ─────────────────────────────────────────
app.post('/toggle-bot', async (req, res) => {
  try {
    const estadoActual = await configColl.findOne({ id: DOC_ID });
    if (!estadoActual) return res.status(500).json({ error: 'config no encontrada' });

    if (!estadoActual.activo) {
      await iniciarBot();
    } else {
      await apagar();
    }

    await configColl.updateOne({ id: DOC_ID }, { $set: { activo: !estadoActual.activo } });
    res.json({ estado: !estadoActual.activo });
  } catch (err) {
    console.error('toggle-bot error:', err);
    res.status(500).json({ error: err.message || 'error interno' });
  }
});

// ─── Mensajes en memoria ────────────────────────────────
app.get('/group-messages', (req, res) => {
  res.json(groupMessages);
});

// ─── Montar rutas de API ────────────────────────────────
const apiRouter = createApiRouter({
  configColl, gruposColl, logsColl, countersColl, qrColl, DOC_ID,
});
app.use(apiRouter);

// ─── Arranque ───────────────────────────────────────────
app.listen(port, () => {
  console.log(`🌐 Servidor corriendo en http://localhost:${port}`);
});
