// Pantalla de la tele en Palabras secretas: a quién le toca, el reloj, el modo de la tarjeta (sin la palabra: esa solo
// la ven quien hace adivinar y el equipo rival) y las que van saliendo. Al acabar, el resumen con los puntos.
import { fill, h } from '../shared/dom.js';
import { avatarOf, getColor } from '../shared/appearance.js';
import { WORD_MODES } from '../core/show.js';
import { WPHASE } from '../core/words.js';
import { sound } from './fx/audio.js';
import { kinetic } from './fx/motion.js';

const MARK = { ok: '✓', pass: '↷', foul: '✗' };

/** Reloj redondo (el mismo dibujo que el de la llamada del millonario). */
export function timerRing(cls = '') {
  const el = h('div', { class: `ring-timer ${cls}` });
  el.innerHTML = '<svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="44" class="track"/><circle cx="50" cy="50" r="44" class="bar" pathLength="100"/></svg><span></span>';
  return el;
}

/** Hace correr un reloj redondo hasta `endsAt` (de `total` ms), con tictac los últimos 5 s. @returns el intervalo */
export function runRing(el, endsAt, total) {
  let last = null;
  const step = () => {
    const left = Math.max(0, endsAt - performance.now());
    const n = Math.ceil(left / 1000);
    el.querySelector('span').textContent = String(n);
    el.querySelector('.bar').style.strokeDashoffset = String(100 - (left / total) * 100);
    el.classList.toggle('hurry', left < 5000);
    if (n !== last && last != null && n > 0 && n <= 5) sound.play('tick');
    last = n;
  };
  step();
  return setInterval(step, 100);
}

export function createWordsStage() {
  const root = h('section', { class: 'words-stage' });
  let tick = 0;

  function stop() {
    clearInterval(tick);
    tick = 0;
  }

  function render(view) {
    stop();
    const w = view.words;
    if (!w) return;
    root.dataset.phase = w.phase;
    const team = w.team;
    root.style.setProperty('--tc', getColor(team?.color ?? w.actor?.color).bg);
    const header = h('p', { class: 'stage-q' }, `${view.section.name} · Turno ${w.turn} de ${w.turns}`);
    const who = w.actor
      ? h(
          'div',
          { class: 'words-who' },
          h('span', { class: 'mini-avatar emoji', style: { '--pc': getColor(w.actor.color).bg } }, avatarOf(w.actor)),
          h('div', {}, h('strong', {}, w.actor.name), team ? h('small', {}, team.name) : null),
        )
      : h('p', { class: 'answer-prompt' }, 'No hay nadie conectado a quien le toque');
    const results = w.results.length
      ? h(
          'ol',
          { class: 'words-results' },
          w.results.map((r) => h('li', { class: r.result }, h('span', { class: 'wr-mark' }, MARK[r.result]), h('span', { class: 'wr-word' }, r.word), h('span', { class: 'wr-mode' }, r.icon))),
        )
      : null;

    if (w.phase === WPHASE.READY) {
      return fill(
        root,
        header,
        kinetic('h2', 'words-title display', '¡Le toca!'),
        who,
        h('p', { class: 'answer-prompt' }, `${w.seconds} segundos para que ${team ? 'su equipo adivine' : 'los demás adivinen'} todas las que pueda. Empieza al pulsar «¡Empezar!» en su móvil.`),
        h(
          'ul',
          { class: 'words-modes' },
          Object.values(WORD_MODES).map((m) => h('li', {}, h('span', { class: 'wm-icon' }, m.icon), h('strong', {}, m.label), h('small', {}, m.rule))),
        ),
        team ? h('p', { class: 'muted' }, 'El equipo contrario ve la tarjeta en su móvil: si hace trampa, ¡que pite!') : null,
      );
    }

    if (w.phase === WPHASE.DONE) {
      return fill(
        root,
        header,
        kinetic('h2', 'words-title display', '¡Tiempo!'),
        who,
        h('p', { class: 'words-score' }, `${w.score} ${w.score === 1 ? 'palabra' : 'palabras'}`),
        w.score ? h('p', { class: 'result-verdict' }, `+${w.score * w.points} ${team ? `para ${team.name}` : ''}`.trim()) : null,
        results,
      );
    }

    // En juego: reloj, modo de la tarjeta y lo que va saliendo
    const ring = timerRing('words-ring');
    const card = w.card;
    fill(
      root,
      header,
      h(
        'div',
        { class: 'words-live' },
        ring,
        h(
          'div',
          { class: 'words-now' },
          who,
          card ? h('p', { class: `words-mode mode-${card.mode}` }, h('span', {}, card.icon), ` ${card.label}`) : null,
          card ? h('p', { class: 'words-rule' }, card.rule) : null,
          h('p', { class: 'words-score' }, `✓ ${w.score}`),
        ),
      ),
      results,
    );
    if (w.endsAt) tick = runRing(ring, w.endsAt, w.seconds * 1000);
  }

  return { root, render, stop };
}
