let homeTimer = null;
let activeAccountId = IbotApi.getAccount() || '';

async function renderAccounts() {
  let accounts = await IbotApi.accounts().catch(() => []);
  
  if (!accounts.length) {
    try {
      const account = await IbotApi.createAccount({ accountId: 'principal', label: 'Mi Bot' });
      accounts = [account];
    } catch (err) {
      console.error('No se pudo crear el bot inicial', err);
    }
  }
  
  if (accounts.length > 0) {
    activeAccountId = accounts[0].accountId;
    IbotApi.setAccount(activeAccountId);
    document.getElementById('homeContent').style.display = 'block';
  } else {
    document.getElementById('homeContent').style.display = 'none';
  }

  return accounts;
}

function setStatusUI(s) {
  const status = s?.status || 'stopped';
  const isRunning = s?.activo || status === 'connected';

  const loadingOverlay = $('#loadingOverlay');
  if (loadingOverlay) {
    if (['starting', 'connecting', 'reconnecting'].includes(status)) {
      loadingOverlay.style.display = 'flex';
    } else {
      loadingOverlay.style.display = 'none';
    }
  }

  // 1. Neon State Box (Encendido/Apagado)
  const neonStateBox = $('#neonStateBox');
  const homeMainCard = $('#homeMainCard');
  if (isRunning) {
    neonStateBox.className = 'neon-state-box on';
    $('#estadoText').textContent = 'ENCENDIDO';
    homeMainCard.classList.add('bot-running');
    homeMainCard.classList.remove('bot-stopped');
  } else {
    neonStateBox.className = 'neon-state-box off';
    $('#estadoText').textContent = 'APAGADO';
    homeMainCard.classList.remove('bot-running');
    homeMainCard.classList.add('bot-stopped');
  }

  // 2. Runtime Status
  $('#runtimeText').textContent = status;

  // 3. Stats Panel Fields
  $('#groupsText').textContent = s?.gruposConfigurados ?? 0;
  $('#ordersMetric').textContent = s?.ordenesRecibidas ?? 0;
  
  const answersText = $('#answersText');
  if (answersText) {
    answersText.textContent = s?.respuestas ? 'ON' : 'OFF';
    answersText.style.color = s?.respuestas ? 'var(--success)' : 'var(--danger)';
  }

  // 4. Conditional Controls and QR Layout
  const qrWrapper = $('#qrWrapper');
  const controlGrid = $('#controlGrid');
  const loginBtnWrapper = $('#loginBtnWrapper');
  const logoutBtn = $('#logoutBtn');
  const runtimeStatusBox = $('.runtime-status-box');

  if (status === 'connected') {
    // Session is active: Connected to WhatsApp
    neonStateBox.style.display = 'flex';
    if (runtimeStatusBox) runtimeStatusBox.style.display = 'flex';
    loginBtnWrapper.style.display = 'none';
    qrWrapper.style.display = 'none';
    controlGrid.style.display = 'grid';
    logoutBtn.style.display = 'block';

    // Update power button for connected state (shows Apagar bot)
    const powerBtn = $('#powerBtn');
    powerBtn.textContent = 'Apagar bot';
    powerBtn.className = 'btn neon-btn-power btn-on';

    // Update answers toggle button
    const answersBtn = $('#answersBtn');
    answersBtn.textContent = s?.respuestas ? 'Desactivar respuestas' : 'Activar respuestas';
    answersBtn.className = s?.respuestas ? 'btn neon-btn-answers btn-on' : 'btn neon-btn-answers btn-off';
  } else {
    // Session is NOT active: Disconnected / Waiting for QR
    neonStateBox.style.display = 'none';
    if (runtimeStatusBox) runtimeStatusBox.style.display = 'none';
    controlGrid.style.display = 'none';
    logoutBtn.style.display = 'none';
    loginBtnWrapper.style.display = 'block';
    qrWrapper.style.display = 'block';

    // Handle QR box rendering
    const qrInstructions = $('#qrInstructions');
    const qrBox = $('#qrBox');
    
    if (s?.qr) {
      qrInstructions.style.display = 'none';
      qrBox.innerHTML = `<img src="${s.qr}" alt="QR WhatsApp"><div class="small" style="margin-top:8px;color:var(--muted)">Escanea el código QR con WhatsApp.</div>`;
    } else {
      qrInstructions.style.display = 'block';
      $('#qrPendingText').textContent = 'Sin QR pendiente.';
      qrBox.innerHTML = '';
    }
  }
}

async function loadHome() {
  try {
    const accounts = await renderAccounts();
    if (!accounts.length || !activeAccountId) return;
    
    const activeBot = accounts.find(a => a.accountId === activeAccountId);
    if (activeBot) {
      const cleanId = activeBot.accountId.includes('-') ? activeBot.accountId.split('-').slice(1).join('-') : activeBot.accountId;
      document.getElementById('activeBotName').textContent = activeBot.label || cleanId;
    }
    
    const s = await IbotApi.status();
    setStatusUI(s);
  } catch (err) {
    if (err.message === 'Sesión requerida') return;
    toast(err.message);
  }
}

function bindHome() {
  bindPanelLogout();
  
  // Dynamic Start (Iniciar sesión)
  $('#startBtn').onclick = async () => { 
    try { 
      await IbotApi.start(); 
      toast('Iniciando servicio de bot...'); 
      await loadHome(); 
    } catch (e) { toast(e.message); } 
  };
  
  // Dynamic Power (Apagar bot when connected)
  $('#powerBtn').onclick = async () => { 
    try { 
      await IbotApi.stop(); 
      toast('Bot apagado'); 
      await loadHome(); 
    } catch (e) { toast(e.message); } 
  };
  
  // Close WhatsApp Session (Cerrar sesión)
  $('#logoutBtn').onclick = async () => {
    if (!confirm('Esto cerrará la sesión de WhatsApp y pedirá QR nuevamente.')) return;
    try { 
      await IbotApi.logout(); 
      toast('Sesión de WhatsApp cerrada'); 
      await loadHome(); 
    } catch (e) { toast(e.message); }
  };
  
  // Toggle Answers (Activar/Desactivar respuestas)
  $('#answersBtn').onclick = async () => { 
    try { 
      await IbotApi.toggleRespuestas(); 
      await loadHome(); 
    } catch (e) { toast(e.message); } 
  };

  // Toggle View Panels: Control Panel vs Statistics Panel
  const mainPanelContent = $('#mainPanelContent');
  const statsPanelContent = $('#statsPanelContent');
  const bottomActionsRow = $('.bottom-actions-row');

  $('#statsBtn').onclick = () => {
    mainPanelContent.style.display = 'none';
    bottomActionsRow.style.display = 'none';
    statsPanelContent.style.display = 'block';
  };

  $('#backBtn').onclick = () => {
    statsPanelContent.style.display = 'none';
    mainPanelContent.style.display = 'block';
    bottomActionsRow.style.display = 'flex';
  };
}

bindHome();
loadHome();
homeTimer = setInterval(loadHome, 5000);
