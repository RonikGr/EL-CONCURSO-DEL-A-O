// Movimiento del espectáculo: títulos que entran letra a letra, cifras que ruedan como un cuentakilómetros,
// listas que se reordenan (FLIP) y revelados con suspense (del último al primero).
// Con «reducir movimiento» activado en el sistema, todo aparece directamente.
import { h } from '../../shared/dom.js';

export const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
export const EASE_OUT = 'cubic-bezier(0.16, 1, 0.3, 1)';
export const EASE_SPRING = 'cubic-bezier(0.34, 1.56, 0.64, 1)';

/**
 * Título cinético: cada letra entra por separado (CSS `.kinetic .kl`, retraso con --i).
 * Las palabras no se parten al cambiar de línea.
 */
export function kinetic(tag, cls, text, { step = 38 } = {}) {
  const el = h(tag, { class: `${cls} kinetic`, 'aria-label': text });
  let i = 0;
  for (const part of String(text).split(/(\s+)/)) {
    if (!part) continue;
    if (/^\s+$/.test(part)) {
      el.append(' ');
      continue;
    }
    const word = h('span', { class: 'kw', 'aria-hidden': 'true' });
    for (const ch of part) word.append(h('span', { class: 'kl', style: { '--d': `${i++ * step}ms` } }, ch));
    el.append(word);
  }
  return el;
}

/**
 * Cifra de cuentakilómetros: cada dígito es una tira 0–9 que rueda desde el valor anterior.
 * @param to    valor final
 * @param from  valor desde el que rueda (por defecto, sin animación)
 */
export function odometer(to, from = to, { delay = 0, duration = 1400 } = {}) {
  const el = h('span', { class: 'odo', 'aria-label': String(to) });
  const sign = to < 0 ? '−' : '';
  const toDigits = String(Math.abs(Math.round(to)));
  const fromDigits = String(Math.abs(Math.round(from)))
    .padStart(toDigits.length, '0')
    .slice(-toDigits.length);
  if (sign) el.append(h('span', { class: 'odo-sign', 'aria-hidden': 'true' }, sign));
  const strips = [];
  [...toDigits].forEach((d, i) => {
    const a = Number(fromDigits[i]);
    let b = Number(d);
    // Siempre hacia delante (como un cuentakilómetros) y, si el número cambió, al menos una vuelta en las unidades.
    if (b < a || (to !== from && i === toDigits.length - 1 && b === a)) b += 10;
    const strip = h('span', { class: 'odo-strip' });
    for (let n = 0; n < 20; n++) strip.append(h('span', {}, String(n % 10)));
    strip.style.transform = `translateY(${-a * 5}%)`;
    strips.push({ strip, b, i });
    el.append(h('span', { class: 'odo-digit', 'aria-hidden': 'true' }, strip));
  });
  if (to === from || reducedMotion) {
    strips.forEach(({ strip, b }) => (strip.style.transform = `translateY(${-(b % 10) * 5}%)`));
    return el;
  }
  // Las de la izquierda tardan un poco más: el número "se asienta" de derecha a izquierda.
  strips.forEach(({ strip, b, i }) => {
    const extra = (strips.length - 1 - i) * 120;
    strip.style.transition = `transform ${duration + extra}ms ${EASE_OUT} ${delay}ms`;
  });
  requestAnimationFrame(() => requestAnimationFrame(() => strips.forEach(({ strip, b }) => (strip.style.transform = `translateY(${-b * 5}%)`))));
  return el;
}

/**
 * Reordena los hijos de `list` según `orderedKeys` (atributo data-key) animando cada uno desde su sitio anterior.
 */
export function flipReorder(list, orderedKeys, { duration = 900 } = {}) {
  const items = new Map([...list.children].map((li) => [li.dataset.key, li]));
  const before = new Map([...items].map(([k, li]) => [k, li.getBoundingClientRect()]));
  for (const key of orderedKeys) if (items.has(key)) list.append(items.get(key));
  if (reducedMotion) return;
  for (const [key, li] of items) {
    const a = before.get(key);
    const b = li.getBoundingClientRect();
    const dx = a.left - b.left;
    const dy = a.top - b.top;
    if (!dx && !dy) continue;
    // Los que suben pasan por delante.
    li.style.zIndex = dy > 0 ? '2' : '1';
    li.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration, easing: EASE_SPRING }).finished.then(
      () => (li.style.zIndex = ''),
      () => {},
    );
  }
}

/**
 * Revelado con suspense: los elementos de la lista aparecen del último al primero; el primero se hace esperar más.
 * Devuelve los instantes (ms) en que aparece cada uno, en el orden de la lista, para sincronizar sonidos.
 */
export function suspense(items, { start = 300, gap = 520, finalPause = 1100 } = {}) {
  const n = items.length;
  const times = [];
  items.forEach((el, i) => {
    const rank = n - 1 - i; // el último sale primero
    const t = reducedMotion ? 0 : start + rank * gap + (i === 0 && n > 1 ? finalPause : 0);
    times.push(t);
    el.classList.add('suspense');
    el.style.setProperty('--d', `${t}ms`);
  });
  return times;
}

/** Entrada de pantalla: barrido con desenfoque (como un telón de niebla). */
export function enterScreen(el) {
  if (reducedMotion) return;
  el.animate(
    [
      { opacity: 0, filter: 'blur(18px)', transform: 'scale(1.035)', clipPath: 'inset(0 0 100% 0 round 2rem)' },
      { opacity: 1, filter: 'blur(0)', transform: 'none', clipPath: 'inset(0 0 0% 0 round 2rem)' },
    ],
    { duration: 900, easing: EASE_OUT },
  );
}

/** Ejecuta `fn` tras `ms` solo si `el` sigue en la página (la pantalla no ha cambiado). */
export function later(el, ms, fn) {
  setTimeout(() => el.isConnected && fn(), ms);
}

/** Transición del revelado: la pantalla se oscurece un instante y la cruza un destello de luz. */
export function revealSweep(el) {
  if (reducedMotion) return;
  el.animate(
    [
      { filter: 'brightness(0.35) blur(6px)', transform: 'scale(0.985)' },
      { filter: 'none', transform: 'none' },
    ],
    { duration: 750, easing: EASE_OUT },
  );
  const sweep = h('div', { class: 'reveal-sweep', 'aria-hidden': 'true' });
  el.append(sweep);
  sweep.addEventListener('animationend', () => sweep.remove());
}
