// Ventana «Música»: tus canciones para cada momento, para todo el concurso o solo para una sección. Cada hueco dice
// dónde suena; se rellena arrastrando el .mp3 encima o con «Examinar…».
import { h } from '../shared/dom.js';
import { EFFECT_SLOTS, MILLIONAIRE_SLOTS, MUSIC_SLOTS, SECTION_SLOTS, sectionSlot, slotInfo } from './fx/tracks.js';
import { browseButton, dropZone, openPanel } from './panelDialog.js';
import { CUE_FIELDS, cueFieldsOf, cueValue } from '../core/millionaireMusic.js';
import { sound } from './fx/audio.js';
import { cueOverridesText, cueSettings, getCues, isAdjusted, resetCues, setCuePoint } from './fx/cueSettings.js';

/** Puntos de una canción del millonario para escucharlos (y comprobar que los empalmes no se notan). */
function cuePreviews(track) {
  const c = getCues()[track];
  const list = [['Desde el principio', { from: 0, loop: c.loop }]];
  if (c.loop) list.push([track === 'call' ? 'Empalme de la espera' : 'Empalme del bucle', { from: c.loop[1] - 4, loop: c.loop }]);
  if (c.lock) list.push(['Respuesta definitiva', { from: c.lock, loop: c.suspense }], ['Empalme del suspense', { from: c.suspense[1] - 4, loop: c.suspense }], ['Acierto', { from: c.reveal }]);
  if (c.voteEnd) list.push(['Los 15 s de votación', { from: c.voteEnd - 15 }]);
  if (c.clockEnd) list.push(['«Ya»: los 30 s', { from: c.clockEnd - 30 }], ['Final del reloj', { from: c.clockEnd - 4 }]);
  return list;
}

const AUDIO = 'audio/*,.mp3,.m4a,.ogg,.wav';
const PRE_ROLL = 2; // s que suenan antes del punto al probarlo («2, 1, ¡ahora!»)

/**
 * Cómo se prueba cada punto: desde un poco antes, con una cuenta «2, 1, ¡ahora!» que acaba justo en el punto (ahí
 * tiene que sonar el golpe o notarse el empalme). Los bucles se oyen dando la vuelta.
 */
function fieldPreview(track, field) {
  const c = getCues()[track];
  const at = (p, extra = {}) => ({ cue: { from: Math.max(0, p - PRE_ROLL), ...extra }, point: p });
  switch (field) {
    case 'loop.0':
    case 'loop.1':
      return { ...at(c.loop[1], { loop: c.loop }), what: 'el empalme (no se tiene que notar)' };
    case 'suspense.0':
    case 'suspense.1':
      return { ...at(c.suspense[1], { loop: c.suspense }), what: 'el empalme (no se tiene que notar)' };
    case 'lock':
      return { ...at(c.lock, { loop: c.suspense }), what: 'el golpe' };
    case 'gainDb':
      return { cue: { from: c.loop?.[0] ?? 0, loop: c.loop }, point: null };
    default:
      return { ...at(cueValue(c, field)), what: field === 'end' ? 'el final' : 'el golpe' };
  }
}

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

  const preview = (track, cue) => {
    const key = `prueba:${performance.now()}`;
    sound.previewCue({ ...cue, track, key });
    return key;
  };

  // Cuenta atrás de la prueba de un punto («2…», «1…», «¡Ahora!»), siguiendo por dónde va la canción de verdad (la
  // primera vez tarda un poco en arrancar). Una línea por canción, la misma en cada repintado (al cambiar un valor se
  // repinta la ventana y la cuenta sigue en ella).
  let countTimer = 0;
  const statusOf = new Map();
  const tryPoint = (track, field, status) => {
    const { cue, point, what } = fieldPreview(track, field);
    clearInterval(countTimer);
    const key = preview(track, cue);
    status.classList.remove('now');
    if (point == null) return (status.textContent = '');
    status.textContent = '…';
    let last = -Infinity;
    countTimer = setInterval(() => {
      const pos = sound.cuePosition(key);
      if (pos == null) return; // aún no suena
      // llega al punto (o el bucle ya ha dado la vuelta)
      if (pos >= point - 0.02 || pos < last) {
        clearInterval(countTimer);
        status.textContent = `¡Ahora! Aquí tiene que sonar ${what}`;
        status.classList.add('now');
        return;
      }
      last = pos;
      status.textContent = `${Math.ceil(point - pos)}…`;
    }, 20);
  };

  /** «Ajustar tiempos» de una canción: cada punto con su valor, ±0,1 s y «▶» para oírlo. */
  const cueEditor = (s) => {
    if (!statusOf.has(s.track)) {
      statusOf.set(s.track, h('p', { class: 'cue-status', 'aria-live': 'polite' }, 'Pulsa ▶ y escucha: en «¡Ahora!» tiene que sonar el golpe (o no notarse el empalme).'));
    }
    const status = statusOf.get(s.track);
    const row = (field) => {
      const value = cueValue(getCues()[s.track], field);
      const gain = field === 'gainDb';
      const step = gain ? 1 : 0.1;
      const set = (v) => {
        setCuePoint(s.track, field, v);
        if (!gain) tryPoint(s.track, field, status); // al moverlo, se oye enseguida cómo queda
      };
      const input = h('input', { type: 'number', step: gain ? '0.5' : '0.01', value: String(value), 'aria-label': CUE_FIELDS[field] });
      input.addEventListener('change', () => set(Number(input.value)));
      const adjusted = isAdjusted(s.track, field);
      return h(
        'li',
        { class: `cue-row ${adjusted ? 'adjusted' : ''}` },
        h('span', { class: 'cue-label' }, CUE_FIELDS[field]),
        input,
        h('span', { class: 'cue-unit muted small' }, gain ? 'dB' : 's'),
        h('button', { class: 'btn small', type: 'button', title: gain ? 'Más bajo' : 'Antes', onclick: () => set(value - step) }, gain ? '−1' : '−0,1'),
        h('button', { class: 'btn small', type: 'button', title: gain ? 'Más alto' : 'Después', onclick: () => set(value + step) }, gain ? '+1' : '+0,1'),
        h('button', { class: 'btn small', type: 'button', title: 'Probar', onclick: () => tryPoint(s.track, field, status) }, '▶'),
        adjusted ? h('button', { class: 'btn small', type: 'button', title: 'Volver al de partida', onclick: () => resetCues(s.track, field) }, '↺') : null,
      );
    };
    const any = cueFieldsOf(s.track).some((f) => isAdjusted(s.track, f));
    return h(
      'details',
      { class: 'cue-editor', 'data-key': `tiempos-${s.track}` },
      h('summary', {}, '⏱ Ajustar tiempos', any ? h('span', { class: 'muted small' }, ' · ajustados a mano') : null),
      status,
      h('ul', { class: 'cue-rows' }, cueFieldsOf(s.track).map(row)),
    );
  };
  const millionaireRow = (s) => {
    const t = tracks()[s.id]?.[0];
    const add1 = (files) => store.add(s.id, files).then((n) => n || toast('Elige un archivo de audio (.mp3).'));
    return dropZone(
      h(
        'li',
        { class: 'music-slot' },
        h('div', { class: 'ms-head' }, h('strong', {}, s.label), h('small', { class: 'muted' }, s.help)),
        h(
          'div',
          { class: 'ms-tracks' },
          t
            ? h(
                'span',
                { class: 'ms-track' },
                '🎵 ',
                t.name,
                h('button', { class: 'ms-remove', type: 'button', title: 'Quitar', 'aria-label': `Quitar ${t.name}`, onclick: () => store.remove(t.id) }, '×'),
              )
            : h('span', { class: 'muted small' }, 'Música generada'),
        ),
        h('div', { class: 'ms-actions' }, browseButton(t ? 'Cambiar…' : 'Examinar…', { accept: AUDIO, onFiles: add1 })),
        t
          ? h(
              'div',
              { class: 'ms-previews' },
              cuePreviews(s.track).map(([label, cue]) => h('button', { class: 'btn small', type: 'button', onclick: () => preview(s.track, cue) }, `▶ ${label}`)),
            )
          : null,
        t ? cueEditor(s) : null,
      ),
      add1,
    );
  };

  const panel = openPanel({
    title: '🎵 Música',
    onClose: () => {
      store.removeEventListener('change', panel.refresh);
      cueSettings.removeEventListener('change', panel.refresh);
      clearInterval(countTimer);
      sound.previewCue(null);
    },
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
          { class: 'music-group', 'data-key': 'millonario', open: true },
          h(
            'summary',
            {},
            h('h3', {}, '¿Quién quiere ser millonario?'),
            h('span', { class: 'muted small' }, `Secciones de Test · ${MILLIONAIRE_SLOTS.filter((s) => tracks()[s.id]?.length).length}/7`),
          ),
          h(
            'p',
            { class: 'muted small' },
            'Las canciones del programa, sincronizadas: cada una salta a su punto en cada momento (el golpe de la llamada cae a los 30 s; el del público, al acabar la votación). ',
            'Con «▶» escuchas cada punto; si alguno no cae justo, «⏱ Ajustar tiempos» (se guarda en este portátil). ',
            h('button', { class: 'btn small', type: 'button', onclick: () => sound.previewCue(null) }, '■ Parar'),
            ' ',
            h(
              'button',
              {
                class: 'btn small',
                type: 'button',
                title: 'Copia los ajustes en texto: pásamelos y los dejo fijos para siempre',
                onclick: () =>
                  navigator.clipboard
                    ?.writeText(cueOverridesText())
                    .then(() => toast('Ajustes copiados.'))
                    .catch(() => toast('No se pudieron copiar.')),
              },
              '📋 Copiar ajustes',
            ),
          ),
          h(
            'ul',
            { class: 'music-slots' },
            MILLIONAIRE_SLOTS.map(millionaireRow),
          ),
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
  cueSettings.addEventListener('change', panel.refresh);
  return panel;
}
