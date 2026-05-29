import { Router } from 'express';
import { ensureAccount, listAccounts, getConfig, defaultBotConfig } from '../services/account-service.js';
import { cleanGroupPayload, normalizeGroupDoc } from '../bot/utils/group-normalizer.js';
import { normalizeAccountId, publicSafeAccount, publicSafeConfig, now } from '../core/utils.js';

export function createMainRouter({ collections, registry }) {
  const router = Router();

  router.param('accountId', async (req, res, next, accountIdRaw) => {
    try {
      const accountId = normalizeAccountId(accountIdRaw);
      const userId = req.panelUser?.uid;
      const account = await collections.accounts.findOne({ accountId, userId });
      if (!account) {
        return res.status(403).json({ error: 'Cuenta no encontrada o acceso denegado' });
      }
      req.resolvedAccountId = accountId;
      next();
    } catch (err) {
      next(err);
    }
  });

  function resolveAccountId(req) {
    if (!req.resolvedAccountId) throw new Error('accountId requerido');
    return req.resolvedAccountId;
  }

  router.get('/api/health', (req, res) => res.json({ ok: true, version: '2.0.0' }));

  router.get('/api/accounts', async (req, res) => {
    const accounts = await listAccounts(collections, req.panelUser?.uid);
    res.json(accounts.map(publicSafeAccount));
  });

  router.post('/api/accounts', async (req, res) => {
    try {
      const account = await ensureAccount(collections, req.body.accountId, req.body.label, req.panelUser?.uid);
      await registry.get(account.accountId);
      res.json(publicSafeAccount(account));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.get('/api/accounts/:accountId/status', async (req, res) => {
    const runtime = await registry.get(resolveAccountId(req));
    const counter = await collections.counters.findOne({ accountId: runtime.accountId, name: 'OrdenesRecibidas' });
    const status = runtime.getPublicStatus();
    status.ordenesRecibidas = counter?.seq ?? status.ordenesRecibidas;
    res.json(status);
  });

  router.post('/api/accounts/:accountId/start', async (req, res) => {
    try { res.json(await registry.start(resolveAccountId(req))); }
    catch (err) { res.status(500).json({ error: err.message }); }
  });

  router.post('/api/accounts/:accountId/stop', async (req, res) => {
    try { res.json(await registry.stop(resolveAccountId(req), 'manual_stop')); }
    catch (err) { res.status(500).json({ error: err.message }); }
  });

  router.post('/api/accounts/:accountId/logout', async (req, res) => {
    try { res.json(await registry.logout(resolveAccountId(req))); }
    catch (err) { res.status(500).json({ error: err.message }); }
  });

  router.get('/api/accounts/:accountId/config', async (req, res) => {
    const accountId = resolveAccountId(req);
    const config = await getConfig(collections, accountId) || defaultBotConfig(accountId);
    res.json(publicSafeConfig(config));
  });

  router.put('/api/accounts/:accountId/config', async (req, res) => {
    try {
      const accountId = resolveAccountId(req);
      const current = await getConfig(collections, accountId) || defaultBotConfig(accountId);
      const body = req.body || {};
      const set = { updatedAt: now() };
      if (body.modo !== undefined) {
        if (!['normal', 'watch', 'ia'].includes(body.modo)) return res.status(400).json({ error: 'Modo inválido' });
        set.modo = body.modo;
      }
      if (body.respuestas !== undefined) set.respuestas = !!body.respuestas;
      if (body.activo !== undefined) set.activo = !!body.activo;
      if (body.normal) set.normal = { ...current.normal, ...body.normal };
      if (body.ia) {
        const ia = { ...current.ia, ...body.ia };
        if (String(ia.apiKey || '').includes('*')) ia.apiKey = current.ia?.apiKey || '';
        ia.commands = Array.isArray(ia.commands) ? ia.commands.map((c) => String(c).trim()).filter(Boolean) : ['/chat'];
        if (!['all', 'required', 'optional'].includes(ia.commandMode)) ia.commandMode = 'required';
        set.ia = ia;
      }
      if (body.connectionNotification) {
        set.connectionNotification = {
          enabled: !!body.connectionNotification.enabled,
          groupId: String(body.connectionNotification.groupId || '').trim(),
          message: String(body.connectionNotification.message || '').trim()
        };
      }
      await collections.configs.updateOne({ accountId }, { $set: set }, { upsert: true });
      const runtime = await registry.get(accountId);
      await runtime.reloadConfig();
      const updated = await getConfig(collections, accountId);
      res.json(publicSafeConfig(updated));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.post('/api/accounts/:accountId/respuestas/toggle', async (req, res) => {
    const accountId = resolveAccountId(req);
    const config = await getConfig(collections, accountId);
    const next = !config?.respuestas;
    await collections.configs.updateOne({ accountId }, { $set: { respuestas: next, updatedAt: now() } });
    const runtime = await registry.get(accountId);
    await runtime.reloadConfig();
    res.json({ respuestas: next });
  });

  router.get('/api/accounts/:accountId/grupos', async (req, res) => {
    const accountId = resolveAccountId(req);
    const rows = await collections.groups.find({ accountId }).sort({ grupo: 1, nombre: 1 }).toArray();
    res.json(rows.map(normalizeGroupDoc));
  });

  router.get('/api/accounts/:accountId/grupos/categories', async (req, res) => {
    const accountId = resolveAccountId(req);
    const rows = await collections.groups.distinct('grupo', { accountId });
    res.json(rows.filter(Boolean).sort());
  });

  router.post('/api/accounts/:accountId/grupos', async (req, res) => {
    try {
      const accountId = resolveAccountId(req);
      const doc = cleanGroupPayload(req.body, accountId);
      await collections.groups.insertOne({ ...doc, createdAt: now(), updatedAt: now() });
      const runtime = await registry.get(accountId);
      await runtime.reloadGroups();
      res.json({ ok: true, grupo: doc });
    } catch (err) {
      const code = /duplicate/i.test(err.message) || err.code === 11000 ? 409 : 400;
      res.status(code).json({ error: err.message });
    }
  });

  // IMPORTANT: rutas estáticas ANTES de /:groupId para evitar colisión en Express
  router.post('/api/accounts/:accountId/grupos/toggle_independent', async (req, res) => {
    try {
      const accountId = resolveAccountId(req);
      const active = await collections.groups.countDocuments({ accountId, independiente: true, responder: true }) > 0;
      const newState = !active;
      const result = await collections.groups.updateMany({ accountId, independiente: true }, { $set: { responder: newState, updatedAt: now() } });
      const runtime = await registry.get(accountId);
      await runtime.reloadGroups();
      res.json({ ok: true, independientesActivos: newState, matched: result.matchedCount });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/api/accounts/:accountId/grupos/:groupId', async (req, res) => {
    const accountId = resolveAccountId(req);
    const groupId = decodeURIComponent(req.params.groupId);
    const doc = await collections.groups.findOne({ accountId, groupId });
    if (!doc) return res.status(404).json({ error: 'grupo no encontrado' });
    res.json(normalizeGroupDoc(doc));
  });

  router.put('/api/accounts/:accountId/grupos/:groupId', async (req, res) => {
    try {
      const accountId = resolveAccountId(req);
      const groupId = decodeURIComponent(req.params.groupId);
      const existing = await collections.groups.findOne({ accountId, groupId });
      if (!existing) return res.status(404).json({ error: 'grupo no encontrado' });
      const doc = cleanGroupPayload({ ...existing, ...req.body, groupId }, accountId);
      delete doc.createdAt;
      await collections.groups.updateOne({ accountId, groupId }, { $set: { ...doc, updatedAt: now() } }, { upsert: false });
      const runtime = await registry.get(accountId);
      await runtime.reloadGroups();
      const updated = await collections.groups.findOne({ accountId, groupId });
      res.json({ ok: true, grupo: normalizeGroupDoc(updated) });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.delete('/api/accounts/:accountId/grupos/:groupId', async (req, res) => {
    const accountId = resolveAccountId(req);
    const groupId = decodeURIComponent(req.params.groupId);
    const result = await collections.groups.deleteOne({ accountId, groupId });
    const runtime = await registry.get(accountId);
    await runtime.reloadGroups();
    res.json({ ok: result.deletedCount > 0 });
  });

  router.post('/api/accounts/:accountId/grupos/:groupId/reset-contador', async (req, res) => {
    const accountId = resolveAccountId(req);
    const groupId = decodeURIComponent(req.params.groupId);
    await collections.groups.updateOne({ accountId, groupId }, { $set: { contador: 0, updatedAt: now() } });
    const runtime = await registry.get(accountId);
    await runtime.reloadGroups();
    res.json({ ok: true });
  });

  router.get('/api/accounts/:accountId/logs/console', async (req, res) => {
    const runtime = await registry.get(resolveAccountId(req));
    const rows = await runtime.logger.read({ limit: req.query.limit, level: req.query.level, q: req.query.q });
    res.json(rows);
  });

  router.delete('/api/accounts/:accountId/logs/console', async (req, res) => {
    const runtime = await registry.get(resolveAccountId(req));
    await runtime.logger.clear();
    res.json({ ok: true });
  });

  router.get('/api/accounts/:accountId/logs/stream', async (req, res) => {
    const accountId = resolveAccountId(req);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    });
    res.write(`event: ready\ndata: ${JSON.stringify({ ok: true })}\n\n`);
    const off = registry.eventBus.on(`logs:${accountId}`, (entry) => {
      res.write(`event: log\ndata: ${JSON.stringify(entry)}\n\n`);
    });
    req.on('close', off);
  });

  router.get('/api/accounts/:accountId/chats/groups', async (req, res) => {
    const runtime = await registry.get(resolveAccountId(req));
    const configured = await collections.groups.find({ accountId: runtime.accountId }).toArray();
    const configuredMap = new Map(configured.map((g) => [g.groupId, g]));
    
    const chatGroups = await collections.chatGroups.find({ accountId: runtime.accountId }).toArray();
    const chatGroupsMap = new Map(chatGroups.map((g) => [g.groupId, g]));

    const rows = await runtime.chatStore.listGroups({ q: req.query.q });
    const enriched = rows.map((g) => {
      const conf = configuredMap.get(g.groupId);
      const cached = chatGroupsMap.get(g.groupId);
      return {
        ...g,
        subject: conf?.nombre || g.subject || cached?.subject || g.groupId,
        pictureUrl: cached?.pictureUrl || conf?.pictureUrl || g.pictureUrl || null,
        configured: !!conf
      };
    });
    res.json(enriched);
  });

  router.get('/api/accounts/:accountId/chats/groups/:groupId/messages', async (req, res) => {
    const runtime = await registry.get(resolveAccountId(req));
    const rows = await runtime.chatStore.readMessages(decodeURIComponent(req.params.groupId), { limit: req.query.limit });
    res.json(rows);
  });

  router.get('/api/accounts/:accountId/chats/groups/:groupId/info', async (req, res) => {
    const runtime = await registry.get(resolveAccountId(req));
    const groupId = decodeURIComponent(req.params.groupId);
    const group = runtime.chatStore.groups.get(groupId) || { groupId };
    const configured = await collections.groups.findOne({ accountId: runtime.accountId, groupId });
    const cached = await collections.chatGroups.findOne({ accountId: runtime.accountId, groupId });
    
    res.json({
      ...group,
      subject: configured?.nombre || group.subject || cached?.subject || groupId,
      pictureUrl: cached?.pictureUrl || group.pictureUrl || null,
      configured: configured ? normalizeGroupDoc(configured) : null
    });
  });

  router.get('/api/accounts/:accountId/events/chats', async (req, res) => {
    const accountId = resolveAccountId(req);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    });
    res.write(`event: ready\ndata: ${JSON.stringify({ ok: true })}\n\n`);
    const offMsg = registry.eventBus.on(`chat-message:${accountId}`, (entry) => res.write(`event: message\ndata: ${JSON.stringify(entry)}\n\n`));
    const offGroup = registry.eventBus.on(`chat-groups:${accountId}`, (entry) => res.write(`event: group\ndata: ${JSON.stringify(entry)}\n\n`));
    req.on('close', () => { offMsg(); offGroup(); });
  });

  return router;
}
