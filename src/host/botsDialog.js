// Ventana «🤖 Pruebas»: concursantes de prueba para probar el concurso con un solo ordenador (host/bots.js).
import { h } from '../shared/dom.js';
import { MAX_PLAYERS } from '../core/players.js';
import { openPanel } from './panelDialog.js';

/**
 * @param room HostRoom
 * @param run  las órdenes de la tele (con su aviso si algo no se puede)
 */
export function openBotsDialog({ room, run }) {
  const btn = (label, onclick, cls = '') => h('button', { class: `btn ${cls}`, type: 'button', onclick }, label);
  const panel = openPanel({
    title: '🤖 Concursantes de prueba',
    onClose: () => room.removeEventListener('change', refresh),
    render: () => {
      const { count, auto } = room.view().bots;
      const free = MAX_PLAYERS - room.roster.list().length;
      return [
        h(
          'p',
          { class: 'muted' },
          'Para probar sin móviles: entran en los huecos libres (con equipo, icono y color) y juegan solos al azar: pulsan, responden, ',
          'votan, eligen en el millonario, ordenan su equipo si son portavoces y cuentan en Libre. Salen en la tele como «🤖 Lola».',
        ),
        h('p', { class: 'bots-count' }, count ? `${count} ${count === 1 ? 'concursante' : 'concursantes'} de prueba en la sala` : 'Ninguno en la sala', ` · ${free} ${free === 1 ? 'hueco libre' : 'huecos libres'}`),
        h(
          'div',
          { class: 'import-actions' },
          btn('🤖 +1', () => run('botsAdd', { count: 1 })),
          btn('🤖 +5', () => run('botsAdd', { count: 5 })),
          btn('🤖 Llenar los huecos', () => run('botsAdd', { count: MAX_PLAYERS }), 'primary'),
          count ? btn('Quitarlos', () => run('botsRemove'), 'danger') : null,
        ),
        h('h3', {}, 'Cómo responden'),
        h(
          'div',
          { class: 'import-actions' },
          btn(auto ? '✓ Responden solos' : 'Responden solos: no', () => run('botsAuto', { on: !auto }), auto ? 'primary' : ''),
          btn('🤖 ¡Responded ya!', () => run('botsAct')),
        ),
        h(
          'p',
          { class: 'muted small' },
          'Solos: en cada pregunta, cuando toca, con un poco de retraso (como personas). «¡Responded ya!»: lo hacen al momento. ',
          'Tú sigues llevando el concurso como siempre (teclado o mando). Se quedan si recargas la tele; «Quitarlos» los saca.',
        ),
      ];
    },
  });
  // Solo si cambia lo que se ve (la sala avisa de cambios a cada latido: repintar tanto se «comería» los clics)
  let last = '';
  const refresh = () => {
    const { count, auto } = room.view().bots;
    const sig = `${count}|${auto}|${room.roster.list().length}`;
    if (sig !== last) panel.refresh();
    last = sig;
  };
  refresh();
  room.addEventListener('change', refresh);
  return panel;
}
