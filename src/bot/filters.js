// src/bot/filters.js — Filtrado de palabras clave (optimizado)

const KEYWORDS = new Set([
  'alguien', 'disponible', 'pedido', 'recoger', 'repartidor', 'pueda',
  'traer', 'traerme', 'para', 'algun', 'algún', 'mandadito', 'mandaditos',
  'comprarme', 'solicito', 'servicio', 'paqueteria', 'recolecta', 'puede',
  'traiga', 'necesito', 'ocupo', 'disp', 'de', 'pase', 'dispo', 'tartán',
  'tartan', 'ursulo', 'carnes', 'pulguita', 'reforma', 'mike', 'la pulguita',
  'envias', 'calle', 'entre', 'mandar', 'del', 'frente', 'detras', 'esquina',
  'entrega', 'me', 'llevar',
]);

const UNIQUE_KEYWORDS = new Set([
  'recibe', 'col', 'centro', 'union', 'colonia', 'villa', 'palmas', 'valle', 'chamizal',
]);

// Pre-compiled regex (compiled once, reused always)
const WORD_REGEX = /[a-záéíóúüñ]+/gi;
const NUM_REGEX = /\b\d{2,3}\b/;

/**
 * Filtra un texto buscando coincidencias con palabras clave.
 * Retorna true si: 2+ keywords, 1 unique keyword, o un número de 2-3 dígitos.
 */
export function filtrarPalabras(texto) {
  if (!texto) return false;

  const lower = texto.toLowerCase();
  let count = 0;

  // Single pass: extract words and check
  let match;
  WORD_REGEX.lastIndex = 0; // reset regex state
  while ((match = WORD_REGEX.exec(lower)) !== null) {
    const word = match[0];
    if (UNIQUE_KEYWORDS.has(word)) return true;
    if (KEYWORDS.has(word)) {
      if (++count >= 2) return true;
    }
  }

  // Only check for numbers if keywords didn't match (avoids second regex)
  return NUM_REGEX.test(texto);
}
