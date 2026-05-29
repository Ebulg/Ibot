function $(s, root = document) { return root.querySelector(s); }
async function authRequest(path, body) {
  const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { error: text }; }
  if (!res.ok) throw new Error(data?.error || res.statusText);
  return data;
}
async function authStatus() {
  const res = await fetch('/api/auth/status');
  return res.json();
}
function showMsg(message, danger = false) {
  const el = $('#authMsg');
  if (!el) return;
  el.textContent = message || '';
  el.style.color = danger ? 'var(--danger)' : 'var(--muted)';
}
async function initLogin() {
  const st = await authStatus().catch(() => null);
  if (st?.authenticated) location.href = '/';
  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#loginBtn');
    btn.disabled = true;
    showMsg('Iniciando sesión...');
    try {
      await authRequest('/api/auth/login', { username: $('#username').value, password: $('#password').value });
      location.href = '/';
    } catch (err) {
      showMsg(err.message, true);
    } finally {
      btn.disabled = false;
    }
  });
}
async function initRegister() {
  const st = await authStatus().catch(() => null);
  if (st?.authenticated && !st?.needsSetup) showMsg('Crearás un usuario adicional para el panel.');
  $('#registerForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const password = $('#password').value;
    const confirm = $('#confirm').value;
    if (password !== confirm) return showMsg('Las contraseñas no coinciden.', true);
    const btn = $('#registerBtn');
    btn.disabled = true;
    showMsg('Creando usuario...');
    try {
      await authRequest('/api/auth/register', { username: $('#username').value, password });
      location.href = '/';
    } catch (err) {
      showMsg(err.message, true);
    } finally {
      btn.disabled = false;
    }
  });
}
async function logoutPanel() {
  await authRequest('/api/auth/logout', {}).catch(() => null);
  location.href = '/login.html';
}
