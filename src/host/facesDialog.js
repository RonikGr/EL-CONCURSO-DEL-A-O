// Ventana «Caras»: fotos de los jugadores con los nombres con los que se les reconoce.
import { h } from '../shared/dom.js';
import { browseButton, dropZone, openPanel } from './panelDialog.js';

/**
 * @param store   FaceStore
 * @param players () => jugadores de la sala (para decir quién ya juega con su cara)
 * @param toast   avisos
 */
export function openFacesDialog({ store, players, toast }) {
  const add = (files) => store.add(files).then((n) => n || toast('Elige fotos (.jpg, .png…).'));
  const panel = openPanel({
    title: '🙂 Caras de los jugadores',
    onClose: () => store.removeEventListener('change', panel.refresh),
    render: () => [
      h(
        'p',
        { class: 'muted' },
        'Una foto por persona. Los nombres salen del nombre del archivo, separados por comas («Rodri, Rodrigo.jpg»), y aquí se pueden cambiar. ',
        'Quien entre con uno de esos nombres (da igual mayúsculas y tildes) jugará con su cara; si no, elegirá icono y color. ',
        'Las fotos se guardan solo en este portátil.',
      ),
      dropZone(
        h('div', { class: 'drop-area' }, h('span', {}, 'Suelta aquí las fotos o '), browseButton('Examinar…', { accept: 'image/*', onFiles: add })),
        add,
      ),
      store.faces.length
        ? h(
            'ul',
            { class: 'face-grid' },
            store.faces.map((f) => {
              const who = players().filter((p) => p.face === f.id);
              const input = h('input', { class: 'face-names', value: f.names.join(', '), 'aria-label': 'Nombres', placeholder: 'Nombres, separados por comas' });
              input.addEventListener('change', () =>
                store.rename(
                  f.id,
                  input.value
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean),
                ),
              );
              return h(
                'li',
                { class: who.length ? 'in-game' : '' },
                h('img', { src: f.img, alt: '' }),
                input,
                h('small', { class: 'muted' }, who.length ? `✓ Juega: ${who.map((p) => p.name).join(', ')}` : 'Nadie con este nombre todavía'),
                h('button', { class: 'ms-remove', type: 'button', title: 'Quitar', 'aria-label': `Quitar la foto de ${f.names[0] ?? ''}`, onclick: () => store.remove(f.id) }, '×'),
              );
            }),
          )
        : h('p', { class: 'muted small' }, 'Aún no hay fotos.'),
    ],
  });
  store.addEventListener('change', panel.refresh);
  return panel;
}
