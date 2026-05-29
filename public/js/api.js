const IbotApi = (() => {
  let accountId = localStorage.getItem('ibot_account') || '';
  const getAccount = () => accountId;
  const setAccount = (id) => {
    accountId = id || '';
    if (accountId) localStorage.setItem('ibot_account', accountId);
    else localStorage.removeItem('ibot_account');
  };
  async function request(url, opts = {}) {
    const res = await fetch(url, {
      credentials: 'same-origin',
      ...opts,
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    });
    if (res.status === 401) {
      const text = await res.text().catch(() => '');
      try {
        const data = text ? JSON.parse(text) : null;
        location.href = data?.needsSetup ? '/register.html' : '/login.html';
      } catch { location.href = '/login.html'; }
      throw new Error('Sesión requerida');
    }
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!res.ok) throw new Error(data?.error || data?.message || res.statusText);
    return data;
  }
  const api = (path) => {
    if (!accountId) throw new Error('Primero crea o selecciona una cuenta de WhatsApp.');
    return `/api/accounts/${encodeURIComponent(accountId)}${path}`;
  };
  return {
    getAccount, setAccount, request, api,
    authStatus: () => request('/api/auth/status'),
    logoutPanel: () => request('/api/auth/logout', { method: 'POST' }),
    accounts: () => request('/api/accounts'),
    createAccount: (body) => request('/api/accounts', { method: 'POST', body: JSON.stringify(body) }),
    status: () => request(api('/status')),
    start: () => request(api('/start'), { method: 'POST' }),
    stop: () => request(api('/stop'), { method: 'POST' }),
    logout: () => request(api('/logout'), { method: 'POST' }),
    config: () => request(api('/config')),
    saveConfig: (body) => request(api('/config'), { method: 'PUT', body: JSON.stringify(body) }),
    toggleRespuestas: () => request(api('/respuestas/toggle'), { method: 'POST' }),
    groups: () => request(api('/grupos')),
    categories: () => request(api('/grupos/categories')),
    createGroup: (body) => request(api('/grupos'), { method: 'POST', body: JSON.stringify(body) }),
    updateGroup: (id, body) => request(api(`/grupos/${encodeURIComponent(id)}`), { method: 'PUT', body: JSON.stringify(body) }),
    deleteGroup: (id) => request(api(`/grupos/${encodeURIComponent(id)}`), { method: 'DELETE' }),
    resetGroup: (id) => request(api(`/grupos/${encodeURIComponent(id)}/reset-contador`), { method: 'POST' }),
    toggleIndependent: () => request(api('/grupos/toggle_independent'), { method: 'POST' }),
    logs: (params = '') => request(api(`/logs/console${params}`)),
    clearLogs: () => request(api('/logs/console'), { method: 'DELETE' }),
    chatGroups: (q = '') => request(api(`/chats/groups${q ? `?q=${encodeURIComponent(q)}` : ''}`)),
    chatMessages: (groupId) => request(api(`/chats/groups/${encodeURIComponent(groupId)}/messages?limit=300`)),
    chatInfo: (groupId) => request(api(`/chats/groups/${encodeURIComponent(groupId)}/info`)),
  };
})();
function $(s, root = document) { return root.querySelector(s); }
function $all(s, root = document) { return Array.from(root.querySelectorAll(s)); }
function escapeHtml(value) { return String(value ?? '').replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c])); }
function create(tag, props = {}) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'className') el.className = value;
    else if (key === 'innerHTML') el.innerHTML = value;
    else if (key === 'textContent' || key === 'innerText') el.textContent = value;
    else if (key === 'style') el.setAttribute('style', value);
    else el[key] = value;
  }
  return el;
}
function toast(msg) {
  const t = $('#toast') || document.body.appendChild(create('div', { id: 'toast', className: 'toast' }));
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2800);
}
async function fillAccounts(selectId = 'accountSelect') {
  const rows = await IbotApi.accounts().catch(() => []);
  if (!rows.length) {
    IbotApi.setAccount('');
    return rows;
  }
  // Enforce main bot account globally
  IbotApi.setAccount(rows[0].accountId);

  const sel = document.getElementById(selectId);
  if (sel) {
    sel.innerHTML = rows.map((a) => `<option value="${escapeHtml(a.accountId)}">${escapeHtml(a.label || a.accountId)}</option>`).join('');
    sel.value = IbotApi.getAccount();
    sel.onchange = () => { IbotApi.setAccount(sel.value); location.reload(); };
  }
  return rows;
}
function bindPanelLogout() {
  const btn = document.getElementById('panelLogoutBtn');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    await IbotApi.logoutPanel().catch(() => null);
    location.href = '/login.html';
  });
}
