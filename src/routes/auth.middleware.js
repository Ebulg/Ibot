import crypto from 'crypto';
import { ObjectId } from 'mongodb';

const COOKIE_NAME = 'ibot_panel_session';
const DAY_MS = 24 * 60 * 60 * 1000;
const SESSION_DAYS = Number(process.env.PANEL_SESSION_DAYS || 7);
const ITERATIONS = 120000;
const KEYLEN = 32;
const DIGEST = 'sha256';

function panelSecret() {
  return process.env.PANEL_SECRET || process.env.PANEL_PASSWORD || 'ibot-local-secret-change-me';
}

export function parseCookies(header = '') {
  return Object.fromEntries(
    String(header || '')
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const idx = part.indexOf('=');
        if (idx === -1) return [part, ''];
        return [decodeURIComponent(part.slice(0, idx)), decodeURIComponent(part.slice(idx + 1))];
      }),
  );
}

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

function sign(payload) {
  return crypto.createHmac('sha256', panelSecret()).update(payload).digest('base64url');
}

export function createSessionCookie(user) {
  const exp = Date.now() + SESSION_DAYS * DAY_MS;
  const payload = base64url(JSON.stringify({ uid: String(user._id), username: user.username, exp }));
  return `${payload}.${sign(payload)}`;
}

export function verifySessionCookie(token) {
  if (!token || !token.includes('.')) return null;
  const [payload, signature] = token.split('.', 2);
  const expected = sign(payload);
  const a = Buffer.from(signature || '');
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data.exp || Date.now() > data.exp) return null;
    if (!ObjectId.isValid(data.uid)) return null;
    return data;
  } catch {
    return null;
  }
}

export function cookieOptions({ clear = false } = {}) {
  const parts = [
    `${COOKIE_NAME}=${clear ? '' : '%TOKEN%'}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (process.env.NODE_ENV === 'production' && process.env.COOKIE_SECURE === 'true') parts.push('Secure');
  if (clear) parts.push('Max-Age=0');
  else parts.push(`Max-Age=${SESSION_DAYS * 24 * 60 * 60}`);
  return parts.join('; ');
}

export function setSessionCookie(res, token) {
  res.setHeader('Set-Cookie', cookieOptions().replace('%TOKEN%', encodeURIComponent(token)));
}

export function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', cookieOptions({ clear: true }));
}

export function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.pbkdf2Sync(String(password), salt, ITERATIONS, KEYLEN, DIGEST).toString('hex');
  return { salt, hash, iterations: ITERATIONS, digest: DIGEST };
}

export function verifyPassword(password, user) {
  if (!user?.password?.salt || !user?.password?.hash) return false;
  const computed = crypto.pbkdf2Sync(String(password), user.password.salt, user.password.iterations || ITERATIONS, KEYLEN, user.password.digest || DIGEST).toString('hex');
  const a = Buffer.from(computed, 'hex');
  const b = Buffer.from(user.password.hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function createAuthRouter({ collections }) {
  return async function authRouter(req, res, next) {
    if (!req.path.startsWith('/api/auth')) return next();
    try {
      if (req.method === 'GET' && req.path === '/api/auth/status') {
        const total = await collections.users.countDocuments();
        const session = verifySessionCookie(parseCookies(req.headers.cookie)[COOKIE_NAME]);
        return res.json({ authenticated: !!session, user: session ? { username: session.username } : null, needsSetup: total === 0 });
      }
      if (req.method === 'POST' && req.path === '/api/auth/register') {
        const total = await collections.users.countDocuments();
        const publicRegistration = String(process.env.PANEL_ALLOW_PUBLIC_REGISTRATION || 'false').toLowerCase() === 'true';
        const session = verifySessionCookie(parseCookies(req.headers.cookie)[COOKIE_NAME]);
        if (total > 0 && !publicRegistration && !session) return res.status(403).json({ error: 'El registro público está cerrado. Inicia sesión para crear otro usuario.' });
        const username = String(req.body?.username || '').trim().toLowerCase();
        const password = String(req.body?.password || '');
        if (!/^[a-z0-9._-]{3,32}$/.test(username)) return res.status(400).json({ error: 'Usuario inválido. Usa 3 a 32 caracteres: letras, números, punto, guion o guion bajo.' });
        if (password.length < 8) return res.status(400).json({ error: 'La contraseña debe tener mínimo 8 caracteres.' });
        const doc = { username, password: hashPassword(password), role: total === 0 ? 'owner' : 'admin', createdAt: new Date(), updatedAt: new Date() };
        await collections.users.insertOne(doc);
        const user = await collections.users.findOne({ username });
        setSessionCookie(res, createSessionCookie(user));
        return res.json({ ok: true, user: { username: user.username, role: user.role } });
      }
      if (req.method === 'POST' && req.path === '/api/auth/login') {
        const username = String(req.body?.username || '').trim().toLowerCase();
        const password = String(req.body?.password || '');
        const user = await collections.users.findOne({ username });
        if (!user || !verifyPassword(password, user)) return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
        setSessionCookie(res, createSessionCookie(user));
        await collections.users.updateOne({ _id: user._id }, { $set: { lastLoginAt: new Date(), updatedAt: new Date() } });
        return res.json({ ok: true, user: { username: user.username, role: user.role } });
      }
      if (req.method === 'POST' && req.path === '/api/auth/logout') {
        clearSessionCookie(res);
        return res.json({ ok: true });
      }
      return res.status(404).json({ error: 'Ruta auth no encontrada' });
    } catch (err) {
      if (err?.code === 11000) return res.status(409).json({ error: 'Ese usuario ya existe.' });
      return res.status(500).json({ error: err.message || 'Error de autenticación' });
    }
  };
}

export function requirePanelAuth({ collections }) {
  return async function panelAuth(req, res, next) {
    if (['/login', '/login.html', '/register', '/register.html'].includes(req.path)) {
      return next();
    }
    const enabled = String(process.env.PANEL_AUTH_ENABLED || 'true').toLowerCase() !== 'false';
    if (!enabled) return next();
    const cookies = parseCookies(req.headers.cookie);
    const session = verifySessionCookie(cookies[COOKIE_NAME]);
    if (session) {
      req.panelUser = session;
      return next();
    }
    const total = await collections.users.countDocuments().catch(() => 1);
    const target = '/login.html';
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Sesión requerida', needsSetup: total === 0 });
    const wantsHtml = req.method === 'GET' && !req.path.includes('.');
    if (wantsHtml || req.accepts('html')) return res.redirect(target);
    return res.status(401).json({ error: 'Sesión requerida', needsSetup: total === 0 });
  };
}
