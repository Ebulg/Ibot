// src/bot/index.js — Re-exports del módulo bot
export {
  iniciarBot,
  apagar,
  getBotActivo,
  getRespuestasActivas,
  getBotModo,
  getOrdenesRecibidas,
  groupMessages,
} from './connection.js';

export { ModeWatch, ModeFlash, ModeNormal } from './modes.js';
export { filtrarPalabras } from './filters.js';
