// Cuenta atrás 3-2-1 de la tele antes de abrir una pregunta: el número grande cambia (con su sonido) hasta `tOpen`.
import { sound } from './audio.js';

/**
 * @param el     elemento donde se pinta el número
 * @param tOpen  instante de apertura (performance.now())
 * @returns función para pararla
 */
export function startCountdown(el, tOpen) {
  let last = null;
  let raf = 0;
  const step = () => {
    const left = tOpen - performance.now();
    if (left <= 0) return;
    const n = Math.ceil(left / 1000);
    if (n !== last) {
      last = n;
      el.textContent = String(n);
      // reinicia la animación de "latido" del número
      el.classList.remove('beat');
      void el.offsetWidth;
      el.classList.add('beat');
      sound.play('count');
    }
    raf = requestAnimationFrame(step);
  };
  step();
  return () => cancelAnimationFrame(raf);
}
