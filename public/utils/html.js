/**
 * Modul: HTML Utilities
 * Zweck: XSS-Schutz fuer innerHTML-basiertes Rendering
 * Abhaengigkeiten: keine
 */

const ESCAPE_MAP = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

const ESCAPE_RE = /[&<>"']/g;

/**
 * Escapet einen String fuer die sichere Einbettung in HTML.
 * Gibt fuer null/undefined einen Leerstring zurueck.
 *
 * @param {*} str - Beliebiger Wert (wird zu String konvertiert)
 * @returns {string} HTML-sicherer String
 */
export function esc(str) {
  if (str == null) return '';
  return String(str).replace(ESCAPE_RE, (ch) => ESCAPE_MAP[ch]);
}

const URL_RE = /https?:\/\/[^\s<>"']+/g;

export function linkify(str) {
  if (str == null) return '';
  const s = String(str);
  let result = '';
  let last = 0;
  for (const m of s.matchAll(URL_RE)) {
    result += esc(s.slice(last, m.index));
    const url = esc(m[0]);
    result += `<a href="${url}" target="_blank" rel="noopener noreferrer" class="item-link">${url}</a>`;
    last = m.index + m[0].length;
  }
  result += esc(s.slice(last));
  return result;
}
