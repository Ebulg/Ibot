window.FormUtils = {
  getGroupFormData: function(elements, selectedGroup = '') {
    return {
      groupId: (elements.fieldGroupIdInput.value || elements.fieldGroupIdHidden.value || selectedGroup).trim(),
      nombre: elements.fieldNombre.value.trim() || 'Sin nombre',
      grupo: elements.fieldGrupo.value.trim() || 'otros',
      tipoMensaje: elements.fieldTipo.value,
      responder: elements.fieldResponder.value === '1',
      respuesta: { text: elements.fieldRespuesta.value || '' },
      duracion: Number(elements.fieldDuracion.value) || 0,
      independiente: !!elements.fieldIndependiente.checked,
      limite: elements.fieldLimite.value === '' ? null : Number(elements.fieldLimite.value),
      contador: Number(elements.fieldContador.value || 0),
    };
  },

  fillGroupForm: function(elements, group) {
    elements.fieldGroupIdHidden.value = group.groupId || '';
    elements.fieldGroupIdInput.value = group.groupId || '';
    elements.fieldGroupIdInput.disabled = !!group.groupId;
    
    elements.fieldNombre.value = group.nombre || '';
    elements.fieldGrupo.value = group.grupo || 'otros';
    elements.fieldTipo.value = group.tipoMensaje || 'texto';
    elements.fieldResponder.value = group.responder ? '1' : '0';
    elements.fieldRespuesta.value = group.respuesta?.text || '';
    elements.fieldDuracion.value = group.duracion || '0';
    elements.fieldIndependiente.checked = !!group.independiente;
    elements.fieldLimite.value = group.limite !== null ? group.limite : '';
    elements.fieldContador.value = group.contador || 0;
  }
};
