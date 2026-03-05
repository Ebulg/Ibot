// src/routes/api.js — Rutas de la API REST
import { Router } from 'express';

/**
 * Crea el router de API con acceso a las colecciones de BD.
 * @param {object} deps - Dependencias inyectadas
 */
export function createApiRouter({ configColl, gruposColl, logsColl, countersColl, qrColl, DOC_ID }) {
  const router = Router();

  // ─── Estado general + QR ──────────────────────────────
  router.get('/toggle-cargar', async (req, res) => {
    try {
      const estado = await configColl.findOne({ id: DOC_ID });
      const counter = await countersColl.findOne({ _id: 'OrdenesRecibidas' });

      let qr = estado?.qr ?? null;
      if (!qr) {
        const lastQrDoc = await qrColl
          .find({ configRef: DOC_ID })
          .sort({ createdAt: -1 })
          .limit(1)
          .toArray();
        if (lastQrDoc.length) qr = lastQrDoc[0].qr;
      }

      res.json({
        estado: estado?.activo || false,
        permiso: estado?.respuestas || false,
        modo: estado?.modo || 'normal',
        msjAnswer: counter?.seq ?? 0,
        qr,
        estadoText: estado?.estado ?? null,
      });
    } catch (err) {
      console.error('toggle-cargar error:', err);
      res.status(500).json({ error: err.message || 'error interno' });
    }
  });

  // ─── Toggle respuestas ────────────────────────────────
  router.post('/toggle-respuesta', async (req, res) => {
    try {
      const estadoActual = await configColl.findOne({ id: DOC_ID });
      if (!estadoActual) return res.status(500).json({ error: 'config no encontrada' });

      const nuevoEstado = !estadoActual.respuestas;
      await configColl.updateOne({ id: DOC_ID }, { $set: { respuestas: nuevoEstado } });
      res.json({ permiso: nuevoEstado });
    } catch (err) {
      console.error('toggle-respuesta error:', err);
      res.status(500).json({ error: err.message || 'error interno' });
    }
  });

  // ─── Toggle modo ──────────────────────────────────────
  router.post('/toggle-mode', async (req, res) => {
    try {
      const { mode } = req.body;
      if (!['normal', 'flash', 'watch'].includes(mode)) {
        return res.status(400).json({ error: 'Modo inválido' });
      }
      await configColl.updateOne({ id: DOC_ID }, { $set: { modo: mode } });
      res.json({ ok: true, mode });
    } catch (err) {
      console.error('toggle-mode error:', err);
      res.status(500).json({ error: err.message || 'error interno' });
    }
  });

  // ─── Grupos: CRUD ─────────────────────────────────────

  // Listar todos
  router.get('/api/grupos', async (req, res) => {
    try {
      const grupos = await gruposColl.find({ configRef: DOC_ID }).toArray();
      res.json(grupos);
    } catch (err) {
      console.error('GET /api/grupos error:', err);
      res.status(500).json({ error: err.message || 'error interno' });
    }
  });

  // Obtener uno
  router.get('/api/grupos/:groupId', async (req, res) => {
    try {
      const { groupId } = req.params;
      const g = await gruposColl.findOne({ groupId, configRef: DOC_ID });
      if (!g) return res.status(404).json({ error: 'grupo no encontrado' });
      res.json(g);
    } catch (err) {
      console.error('GET /api/grupos/:groupId error:', err);
      res.status(500).json({ error: err.message || 'error interno' });
    }
  });

  // Crear
  router.post('/api/grupos', async (req, res) => {
    try {
      const {
        groupId, nombre, grupo, tipoMensaje, responder, respuesta,
        duracion, independiente, limite, contador,
      } = req.body;

      if (!groupId) return res.status(400).json({ error: 'groupId requerido' });

      const exists = await gruposColl.findOne({ groupId, configRef: DOC_ID });
      if (exists) return res.status(409).json({ error: 'grupo ya existe. Usa PUT para actualizar' });

      const doc = {
        configRef: DOC_ID,
        groupId,
        nombre: nombre ?? 'Sin nombre',
        grupo: grupo ?? 'otros',
        tipoMensaje: tipoMensaje ?? 'texto',
        responder: !!responder,
        respuesta: typeof respuesta === 'string' ? { text: respuesta } : (respuesta ?? { text: '' }),
        duracion: Number(duracion ?? 0),
        independiente: !!independiente,
        limite: (limite === null || limite === undefined || limite === '') ? null : Number(limite),
        contador: Number(contador ?? 0),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await gruposColl.insertOne(doc);
      res.json({ ok: true, grupo: doc });
    } catch (err) {
      console.error('POST /api/grupos error:', err);
      res.status(500).json({ error: err.message || 'error interno' });
    }
  });

  // Actualizar
  router.put('/api/grupos/:groupId', async (req, res) => {
    try {
      const { groupId } = req.params;
      const {
        nombre, grupo, tipoMensaje, responder, respuesta,
        duracion, independiente, limite, contador,
      } = req.body;

      const setObj = { updatedAt: new Date() };
      if (nombre !== undefined) setObj.nombre = nombre;
      if (grupo !== undefined) setObj.grupo = grupo;
      if (tipoMensaje !== undefined) setObj.tipoMensaje = tipoMensaje;
      if (responder !== undefined) setObj.responder = !!responder;
      if (respuesta !== undefined) {
        setObj.respuesta = typeof respuesta === 'string' ? { text: respuesta } : respuesta;
      }
      if (duracion !== undefined) setObj.duracion = Number(duracion);
      if (independiente !== undefined) setObj.independiente = !!independiente;
      if (limite !== undefined) setObj.limite = (limite === '' || limite === null) ? null : Number(limite);
      if (contador !== undefined) setObj.contador = Number(contador);

      const result = await gruposColl.updateOne(
        { groupId, configRef: DOC_ID },
        { $set: setObj },
      );

      if (result.matchedCount === 0) return res.status(404).json({ error: 'grupo no encontrado' });

      const updated = await gruposColl.findOne({ groupId, configRef: DOC_ID });
      res.json({ ok: true, grupo: updated });
    } catch (err) {
      console.error('PUT /api/grupos/:groupId error:', err);
      res.status(500).json({ error: err.message || 'error interno' });
    }
  });

  // Reiniciar contador
  router.post('/api/grupos/:groupId/reset-contador', async (req, res) => {
    try {
      const { groupId } = req.params;
      const result = await gruposColl.updateOne(
        { groupId, configRef: DOC_ID },
        { $set: { contador: 0, updatedAt: new Date() } },
      );
      if (result.matchedCount === 0) return res.status(404).json({ error: 'grupo no encontrado' });

      const g = await gruposColl.findOne({ groupId, configRef: DOC_ID });
      res.json({ ok: true, grupo: g });
    } catch (err) {
      console.error('reset-contador error:', err);
      res.status(500).json({ error: err.message || 'error interno' });
    }
  });

  // Toggle grupos independientes
  router.post('/api/grupos/toggle_independent', async (req, res) => {
    try {
      const anyActive = await gruposColl.countDocuments({
        configRef: DOC_ID, independiente: true, responder: true,
      }) > 0;
      const newState = !anyActive;

      const result = await gruposColl.updateMany(
        { configRef: DOC_ID, independiente: true },
        { $set: { responder: newState, updatedAt: new Date() } },
      );

      res.json({ ok: true, independientesActivos: newState, matched: result.matchedCount });
    } catch (err) {
      console.error('toggle_independent error:', err);
      res.status(500).json({ error: err.message || 'error interno' });
    }
  });

  // Eliminar grupo
  router.delete('/api/grupos/:groupId', async (req, res) => {
    try {
      const { groupId } = req.params;
      const result = await gruposColl.deleteOne({ groupId, configRef: DOC_ID });
      if (result.deletedCount === 0) return res.status(404).json({ error: 'grupo no encontrado' });
      res.json({ ok: true });
    } catch (err) {
      console.error('DELETE /api/grupos/:groupId error:', err);
      res.status(500).json({ error: err.message || 'error interno' });
    }
  });

  // ─── Logs ─────────────────────────────────────────────
  router.get('/api/logs', async (req, res) => {
    try {
      const { groupId, limit = 50, skip = 0 } = req.query;
      const q = groupId ? { groupId } : {};
      const docs = await logsColl
        .find(q)
        .sort({ timestamp: -1 })
        .skip(Number(skip))
        .limit(Number(limit))
        .toArray();
      res.json(docs);
    } catch (err) {
      console.error('GET /api/logs error:', err);
      res.status(500).json({ error: err.message || 'error interno' });
    }
  });

  // ─── Counters ─────────────────────────────────────────
  router.get('/api/counters/OrdenesRecibidas', async (req, res) => {
    try {
      const c = await countersColl.findOne({ _id: 'OrdenesRecibidas' });
      res.json({ seq: c?.seq ?? 0 });
    } catch (err) {
      console.error('GET /api/counters error:', err);
      res.status(500).json({ error: err.message || 'error interno' });
    }
  });

  return router;
}
