process.env.UV_THREADPOOL_SIZE = '64';
import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { connectDB, closeDB, getCollections, ensureIndexes } from './src/db/mongo.js';
import { RuntimeRegistry } from './src/core/runtime-registry.js';
import { createMainRouter } from './src/routes/main.routes.js';
import { createAuthRouter, requirePanelAuth } from './src/routes/auth.middleware.js';
import rateLimit from 'express-rate-limit';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const port = Number(process.env.PORT || 4310);
const publicDir = path.join(__dirname, 'public');

const app = express();
app.disable('x-powered-by');

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: { error: 'Demasiadas peticiones, por favor intenta más tarde.' },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api/', apiLimiter);

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cache-Control', 'no-store');
  next();
});

const db = await connectDB();
await ensureIndexes(db);
const collections = getCollections(db);
const registry = new RuntimeRegistry({ collections });

app.use('/css', express.static(path.join(publicDir, 'css')));
app.get('/js/auth.js', (req, res) => res.sendFile(path.join(publicDir, 'js', 'auth.js')));
app.use(createAuthRouter({ collections }));
app.get('/login.html', (req, res) => res.sendFile(path.join(publicDir, 'login.html')));
app.get('/register.html', (req, res) => res.sendFile(path.join(publicDir, 'register.html')));

app.use(requirePanelAuth({ collections }));
app.use(express.static(publicDir, { extensions: ['html'] }));
app.use(createMainRouter({ collections, registry }));

app.get('/*splat', (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

const server = app.listen(port, async () => {
  console.log(`Ibot v2 listo en http://localhost:${port}`);
  console.log(`Base MongoDB: ${process.env.MONGODB_DB || 'Ibotv2'} | Multicuenta sin cuenta forzada por defecto`);
  
  const accountsToStart = await collections.configs.find({ activo: true }).toArray();
  for (const config of accountsToStart) {
    console.log(`[Auto-start] Iniciando cuenta: ${config.accountId}`);
    registry.start(config.accountId).catch(err => {
        console.error(`Error auto-arrancando ${config.accountId}:`, err.message);
    });
  }
});

async function shutdown(signal) {
  console.log(`Recibido ${signal}. Cerrando Ibot v2...`);
  server.close(async () => {
    await registry.stopAll('server_shutdown');
    await closeDB();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (err) => console.error('Unhandled rejection:', err));
process.on('uncaughtException', (err) => console.error('Uncaught exception:', err));
