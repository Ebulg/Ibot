// public/js/utils.js — Funciones compartidas entre todas las páginas

/**
 * Selector de elementos (shorthand para querySelector)
 */
const $ = (sel) => document.querySelector(sel);

/**
 * Crear un elemento HTML con propiedades
 */
function create(tag, props = {}) {
  return Object.assign(document.createElement(tag), props);
}

/**
 * Escapar HTML para prevenir XSS
 */
function escapeHtml(str) {
  if (!str) return '';
  return str.toString().replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[c]);
}

/**
 * Actualizar apariencia de un pill (on/off toggle badge)
 */
function setPill(el, active, labels) {
  if (active) {
    el.classList.remove('off');
    el.classList.add('on');
    el.textContent = labels.on;
  } else {
    el.classList.remove('on');
    el.classList.add('off');
    el.textContent = labels.off;
  }
}
