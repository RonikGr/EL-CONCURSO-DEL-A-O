// Pantalla siempre encendida (Wake Lock API) mientras la página está a la vista: que el móvil no se apague
// a mitad de concurso. El navegador la suelta al ocultar la página, así que se pide otra vez al volver.
// Sin soporte (o sin HTTPS) no pasa nada: simplemente se apagará como siempre.
let lock = null;

async function request() {
  if (lock || !('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
  try {
    lock = await navigator.wakeLock.request('screen');
    lock.addEventListener('release', () => (lock = null));
  } catch {
    // denegado (batería baja, sin gesto en algunos navegadores…): se reintenta en el siguiente toque
  }
}

export function keepScreenAwake() {
  request();
  document.addEventListener('visibilitychange', request);
  // Algunos navegadores solo lo conceden tras un toque.
  addEventListener('pointerdown', request, { passive: true });
}
