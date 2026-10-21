// Comodines del millonario (tele y móviles): 50:50, Público y Llamada, con su icono redondo.
import { h } from './dom.js';

export const JOKER_NAMES = { fifty: '50:50', audience: 'Público', call: 'Llamada' };

/** Iconos de los comodines (dibujados aquí: aro metálico, aro de color y el dibujo en blanco). */
export function jokerIcon(kind, { used = false } = {}) {
  const ring = { fifty: '#3fa9f5', audience: '#e0306a', call: '#f2c200' }[kind];
  const glyph = {
    fifty: '<text x="50" y="58" text-anchor="middle" font-size="24" font-weight="900" fill="#fff" font-family="Outfit Variable, sans-serif">50:50</text>',
    audience:
      '<g fill="#fff"><circle cx="35" cy="38" r="7"/><circle cx="65" cy="38" r="7"/><circle cx="50" cy="34" r="8"/>' +
      '<path d="M24 66c0-10 5-17 11-17s11 7 11 17z"/><path d="M54 66c0-10 5-17 11-17s11 7 11 17z"/><path d="M37 70c0-13 6-22 13-22s13 9 13 22z"/></g>',
    call:
      '<path fill="#fff" d="M39 30c3-2 6-1 7 2l4 9c1 3 0 5-2 7l-4 3c3 6 7 10 13 13l3-4c2-2 4-3 7-2l9 4c3 1 4 4 2 7l-4 6c-2 3-6 4-10 3-17-5-29-17-34-34-1-4 0-8 3-10z"/>',
  }[kind];
  const svg = `<svg viewBox="0 0 100 100" aria-hidden="true">
    <defs>
      <radialGradient id="metal-${kind}" cx="50%" cy="35%" r="65%"><stop offset="0" stop-color="#f4f6fb"/><stop offset=".6" stop-color="#9aa3b5"/><stop offset="1" stop-color="#4a5163"/></radialGradient>
      <pattern id="dots-${kind}" width="4" height="4" patternUnits="userSpaceOnUse"><rect width="4" height="4" fill="#1b1d24"/><circle cx="2" cy="2" r=".8" fill="#2c2f38"/></pattern>
    </defs>
    <circle cx="50" cy="50" r="48" fill="url(#metal-${kind})"/>
    <circle cx="50" cy="50" r="40" fill="${ring}"/>
    <circle cx="50" cy="50" r="35" fill="url(#dots-${kind})"/>
    ${glyph}
    ${used ? '<path d="M24 24L76 76M76 24L24 76" stroke="#ff2d3d" stroke-width="9" stroke-linecap="round"/>' : ''}
  </svg>`;
  const el = h('span', { class: `joker-icon ${used ? 'used' : ''}`, title: JOKER_NAMES[kind] });
  el.innerHTML = svg;
  return el;
}

