// Ventana «Música»: tus canciones para cada momento, para todo el concurso o solo para una sección. Cada hueco dice
// dónde suena; se rellena arrastrando el .mp3 encima o con «Examinar…».
import { h } from '../shared/dom.js';
import { EFFECT_SLOTS, MUSIC_SLOTS, SECTION_SLOTS, sectionSlot, slotInfo } from './fx/tracks.js';
import { browseButton, dropZone, openPanel } from './panelDialog.js';

const AUDIO = 'audio/*,.mp3,.m4a,.ogg,.wav';

/**
 * @param store    TrackStore
 * @param sections () => secciones del concurso cargado [{name, label}]
 */
export function openMusicDialog({ store, sections, toast }) {
  const tracks = () => store.summary();
  const add = (slot) => (files) => store.add(slot, files).then((n) => n || toast('Elige archivos de audio (.mp3).'));

  const slotRow = (slot, label, help, fallback) => {
    const list = tracks()[slot] ?? [];
    return dropZone(
      h(
        'li',
        { class: 'music-slot' },
        h('div', { class: 'ms-head' }, h('strong', {}, label), h('small', { class: 'muted' }, help)),
        h(
          'div',
          { class: 'ms-tracks' },
          list.length
            ? list.map((t) =>
                h(
                  'span',
                  { class: 'ms-track' },
                  '🎵 ',
                  t.name,
                  h('button', { class: 'ms-remove', type: 'button', title: 'Quitar', 'aria-label': `Quitar ${t.name}`, onclick: () => store.remove(t.id) }, '×'),
                ),
              )
            : h('span', { class: 'muted small' }, fallback),
        ),
        h('div', { class: 'ms-actions' }, browseButton('Examinar…', { accept: AUDIO, onFiles: add(slot) })),
      ),
      add(slot),
    );
  };

  const panel = openPanel({
    title: '🎵 Música',
    onClose: () => store.removeEventListener('change', panel.refresh),
    render: () => {
      const all = tracks();
      const countIn = (prefix) => Object.entries(all).filter(([k]) => k.startsWith(prefix)).reduce((n, [, l]) => n + l.length, 0);
      return [
        h(
          'p',
          { class: 'muted' },
          'Arrastra tus canciones (.mp3) encima de cada hueco o pulsa «Examinar…». Si pones varias en un hueco, se van alternando. ',
          'Un hueco vacío usa la música generada. Las canciones se guardan solo en este portátil.',
        ),
        h(
          'details',
          { class: 'music-group', 'data-key': 'general', open: true },
          h('summary', {}, h('h3', {}, 'Para todo el concurso')),
          h(
            'ul',
            { class: 'music-slots' },
            MUSIC_SLOTS.map((s) => slotRow(s.id, s.label, s.help, 'Música generada')),
          ),
          h('h4', { class: 'music-sub' }, 'Efectos (suenan una vez, la música baja mientras)'),
          h(
            'ul',
            { class: 'music-slots' },
            EFFECT_SLOTS.map((s) => slotRow(s.id, s.label, s.help, 'Efecto generado')),
          ),
        ),
        sections().length ? h('h3', { class: 'music-sub' }, 'Solo para una sección') : null,
        sections().map((sec) => {
          const n = countIn(`${sec.name}|`);
          return h(
            'details',
            { class: 'music-group', 'data-key': sec.name },
            h('summary', {}, h('h3', {}, sec.name), h('span', { class: 'muted small' }, `${sec.label}${n ? ` · ${n} ${n === 1 ? 'canción' : 'canciones'}` : ''}`)),
            h(
              'p',
              { class: 'muted small' },
              'Escalera: en «Jugando», «Pregunta abierta» y «Suspense», si pones varias canciones, la 1ª suena en la 1ª pregunta, la 2ª en la 2ª… (por orden de nombre: «1 - …», «2 - …») y la última sigue para el resto.',
            ),
            h(
              'ul',
              { class: 'music-slots' },
              SECTION_SLOTS.map((id) => {
                const info = slotInfo(id);
                return slotRow(sectionSlot(sec.name, id), `${info.label} · ${sec.name}`, info.help.replace('cada sección', 'esta sección'), `La general de «${info.label}»`);
              }),
            ),
            h('h4', { class: 'music-sub' }, `Efectos de «${sec.name}»`),
            h(
              'ul',
              { class: 'music-slots' },
              EFFECT_SLOTS.map((s) => slotRow(sectionSlot(sec.name, s.id), `${s.label} · ${sec.name}`, s.help, `El general de «${s.label}»`)),
            ),
          );
        }),
      ];
    },
  });
  store.addEventListener('change', panel.refresh);
  return panel;
}
