const KEYWORDS = new Set([
  'alguien', 'disponible', 'pedido', 'recoger', 'repartidor', 'pueda',
  'traer', 'traerme', 'para', 'algun', 'algún', 'mandadito', 'mandaditos',
  'comprarme', 'solicito', 'servicio', 'paqueteria', 'paquetería', 'recolecta', 'puede',
  'traiga', 'necesito', 'ocupo', 'disp', 'de', 'pase', 'dispo', 'tartán',
  'tartan', 'ursulo', 'úrsulo', 'carnes', 'pulguita', 'reforma', 'mike', 'envias',
  'envías', 'calle', 'entre', 'mandar', 'del', 'frente', 'detras', 'detrás',
  'esquina', 'entrega', 'me', 'llevar', 'lleven', 'comprar', 'manda', 'envio', 'envío',
]);

const UNIQUE_KEYWORDS = new Set([
  'recibe', 'col', 'centro', 'union', 'unión', 'colonia', 'villa', 'palmas', 'valle', 'chamizal',
]);

const PHRASES = ['la pulguita'];
const WORD_REGEX = /[a-záéíóúüñ]+/gi;
const NUM_REGEX = /\b\d{2,3}\b/;

export function filtrarPalabras(texto, options = {}) {
  if (!texto) return false;
  if (options.enabled === false) return true;
  const lower = String(texto).toLowerCase();
  for (const phrase of PHRASES) {
    if (lower.includes(phrase)) return true;
  }
  let count = 0;
  WORD_REGEX.lastIndex = 0;
  let match;
  while ((match = WORD_REGEX.exec(lower)) !== null) {
    const word = match[0];
    if (UNIQUE_KEYWORDS.has(word)) return true;
    if (KEYWORDS.has(word) && ++count >= 2) return true;
  }
  return NUM_REGEX.test(lower);
}
