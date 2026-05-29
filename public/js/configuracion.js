let current = null;

async function load() {
  bindPanelLogout();
  const rows = await fillAccounts();
  const hasAccounts = rows.length > 0;
  $('#noAccounts').style.display = hasAccounts ? 'none' : 'block';
  $('#configContent').style.display = hasAccounts ? 'grid' : 'none';
  if (!hasAccounts) return;
  current = await IbotApi.config();
  $('#modo').value = current.modo || 'normal';
  
  const respEl = $('#respuestas');
  if (respEl) respEl.checked = !!current.respuestas;

  $('#globalLimit').value = current.normal?.globalLimit ?? 1;
  $('#filterEnabled').checked = current.normal?.filterEnabled !== false;
  
  const ia = current.ia || {};
  $('#iaEnabled').value = String(ia.enabled === true);
  $('#iaModel').value = ia.model || 'glm-5.1';
  $('#iaBaseUrl').value = ia.baseUrl || 'https://api.z.ai/api/paas/v4';
  $('#iaApiKey').value = '';
  $('#iaTemperature').value = ia.temperature ?? 0.6;
  $('#iaMaxTokens').value = ia.maxTokens ?? 500;
  $('#iaCommandMode').value = ia.commandMode || 'required';
  $('#iaCommands').value = (ia.commands || ['/chat', '/gpt']).join(',');
  $('#iaCooldown').value = ia.perGroupCooldownMs ?? 3000;
  $('#iaSystemPrompt').value = ia.systemPrompt || '';
  $('#iaFallback').value = ia.fallbackText || '';
  $('#iaOnlyConfigured').checked = ia.onlyConfiguredGroups !== false;
  $('#iaIgnoreMedia').checked = ia.ignoreMedia !== false;

  // Populate groups dropdown for connection notifications
  const userGroups = await IbotApi.groups().catch(() => []);
  const selectGroup = $('#connNotifyGroup');
  if (selectGroup) {
    selectGroup.innerHTML = '<option value="">Selecciona un grupo...</option>' + 
      userGroups.map(g => `<option value="${escapeHtml(g.groupId)}">${escapeHtml(g.nombre || g.groupId)}</option>`).join('');
  }

  const connNotify = current.connectionNotification || {};
  $('#connNotifyEnabled').checked = !!connNotify.enabled;
  $('#connNotifyGroup').value = connNotify.groupId || '';
  $('#connNotifyMessage').value = connNotify.message || '';
}

function payload() {
  const apiKey = $('#iaApiKey').value.trim();
  const ia = {
    enabled: $('#iaEnabled').value === 'true',
    model: $('#iaModel').value.trim() || 'glm-5.1',
    baseUrl: $('#iaBaseUrl').value.trim() || 'https://api.z.ai/api/paas/v4',
    temperature: Number($('#iaTemperature').value || 0.6),
    maxTokens: Number($('#iaMaxTokens').value || 500),
    commandMode: $('#iaCommandMode').value,
    commands: $('#iaCommands').value.split(',').map((s) => s.trim()).filter(Boolean),
    perGroupCooldownMs: Number($('#iaCooldown').value || 0),
    systemPrompt: $('#iaSystemPrompt').value,
    fallbackText: $('#iaFallback').value,
    onlyConfiguredGroups: $('#iaOnlyConfigured').checked,
    ignoreMedia: $('#iaIgnoreMedia').checked,
  };
  if (apiKey) ia.apiKey = apiKey;

  const respEl = $('#respuestas');
  const respuestasVal = respEl ? respEl.checked : (current ? !!current.respuestas : false);

  const connectionNotification = {
    enabled: $('#connNotifyEnabled').checked,
    groupId: $('#connNotifyGroup').value,
    message: $('#connNotifyMessage').value.trim()
  };

  return { 
    modo: $('#modo').value, 
    respuestas: respuestasVal, 
    normal: { 
      globalLimit: Number($('#globalLimit').value || 0), 
      filterEnabled: $('#filterEnabled').checked 
    }, 
    ia,
    connectionNotification
  };
}

async function save() {
  try { 
    await IbotApi.saveConfig(payload()); 
    toast('Configuración guardada'); 
    await load(); 
  } catch (e) { 
    toast(e.message); 
  }
}

const saveMain = $('#saveMain');
if (saveMain) saveMain.onclick = save;

const saveAll = $('#saveAll');
if (saveAll) saveAll.onclick = save;

const saveConnNotify = $('#saveConnNotify');
if (saveConnNotify) saveConnNotify.onclick = save;

const reloadBtn = $('#reloadBtn');
if (reloadBtn) reloadBtn.onclick = load;

load();
