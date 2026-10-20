// Zona central de la tele (estado de la pregunta) y pantalla completa del ganador.
import { fill, h } from '../shared/dom.js';
import { getColor, getIcon } from '../shared/appearance.js';
import { formatDeltaMs, formatSeconds, ordinal } from '../shared/format.js';
import { PHASE } from '../core/game.js';
import { MIN_PLAYERS } from '../core/players.js';

const kbd = (key) => h('kbd', {}, key);

/**
 * @param actions {open, correct, wrong, next, restart}
 */
export function createStage(actions) {
  const root = h('section', { class: 'stage', 'aria-live': 'polite' });
  const overlay = h('div', { class: 'result-overlay', hidden: true, role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Resultado' });
  let timerEl = null;
  let raf = 0;

  function stopTimer() {
    cancelAnimationFrame(raf);
    timerEl = null;
  }

  function tickTimer(tOpen) {
    if (!timerEl) return;
    timerEl.textContent = formatSeconds(performance.now() - tOpen, 1);
    raf = requestAnimationFrame(() => tickTimer(tOpen));
  }

  function render(room) {
    const view = room.gameView();
    const settings = room.settings;
    stopTimer();
    overlay.hidden = view.phase !== PHASE.RESULT;

    const label = h('p', { class: 'stage-q' }, `Pregunta ${view.qid}`);
    switch (view.phase) {
      case PHASE.IDLE:
        root.dataset.phase = 'idle';
        fill(
          root,
          label,
          h('p', { class: 'stage-title' }, 'Pregunta en el aire'),
          h(
            'div',
            { class: 'stage-actions' },
            h('button', { class: 'btn primary huge', disabled: !room.canPlay, onclick: actions.open }, 'Abrir turno ', kbd('Espacio')),
          ),
          room.canPlay ? null : h('p', { class: 'stage-hint' }, `Hacen falta al menos ${MIN_PLAYERS} jugadores conectados.`),
        );
        break;

      case PHASE.OPEN: {
        const started = performance.now() >= view.tOpen;
        root.dataset.phase = started ? 'open' : 'ready';
        timerEl = started ? h('p', { class: 'stage-timer' }) : null;
        fill(
          root,
          label,
          h('p', { class: 'stage-title' }, started ? '¡Pulsad!' : 'Preparados…'),
          timerEl,
          h(
            'div',
            { class: 'stage-actions' },
            h('button', { class: 'btn', onclick: actions.restart }, 'Reiniciar pregunta ', kbd('R')),
            h('button', { class: 'btn', onclick: actions.next }, 'Saltar pregunta'),
          ),
        );
        if (timerEl) tickTimer(view.tOpen);
        break;
      }

      case PHASE.RESULT:
        // La tele la ocupa el overlay; debajo se deja el último estado.
        root.dataset.phase = 'result';
        renderResult(view, settings);
        break;

      case PHASE.CLOSED:
        root.dataset.phase = 'closed';
        fill(
          root,
          label,
          h('p', { class: 'stage-title' }, 'Nadie más puede responder'),
          h(
            'div',
            { class: 'stage-actions' },
            h('button', { class: 'btn primary huge', onclick: actions.next }, 'Siguiente pregunta ', kbd('Espacio')),
            h('button', { class: 'btn', onclick: actions.restart }, 'Reiniciar ', kbd('R')),
          ),
        );
        break;
    }
  }

  function renderResult(view, settings) {
    const winner = view.winner;
    if (!winner) return;
    const color = getColor(winner.color);
    overlay.style.setProperty('--win', color.bg);
    overlay.style.setProperty('--win-fg', color.fg);

    const first = view.ranking[0];
    const followers = view.ranking.slice(1);
    const judgedCorrect = view.judged === 'correct';

    fill(
      overlay,
      h('p', { class: 'result-q' }, `Pregunta ${view.qid}`),
      h('div', { class: 'result-avatar emoji', 'aria-hidden': 'true' }, getIcon(winner.icon).glyph),
      h('h2', { class: 'result-name' }, winner.name),
      h('p', { class: 'result-time' }, first ? formatSeconds(first.reactionMs) : ''),
      judgedCorrect ? h('p', { class: 'result-verdict' }, `¡Correcto! +${settings.pointsForCorrect}`) : null,
      followers.length
        ? h(
            'ol',
            { class: 'followers' },
            followers.map((r) =>
              h(
                'li',
                { class: r.nearTie ? 'near-tie' : '', style: { '--fc': getColor(r.player.color).bg } },
                h('span', { class: 'f-place' }, ordinal(r.place)),
                h('span', { class: 'f-icon emoji' }, getIcon(r.player.icon).glyph),
                h('span', { class: 'f-name' }, r.player.name),
                h('span', { class: 'f-delta' }, formatDeltaMs(r.deltaMs)),
                r.nearTie ? h('span', { class: 'f-tie' }, 'casi empate') : null,
              ),
            ),
          )
        : null,
      h(
        'div',
        { class: 'result-actions' },
        judgedCorrect
          ? null
          : [
              h('button', { class: 'btn ok huge', onclick: actions.correct }, `Acierto +${settings.pointsForCorrect} `, kbd('A')),
              h(
                'button',
                { class: 'btn bad huge', onclick: actions.wrong },
                'Fallo: rebote al resto ',
                settings.pointsForWrong ? `(${settings.pointsForWrong > 0 ? '+' : ''}${settings.pointsForWrong}) ` : '',
                kbd('F'),
              ),
            ],
        h('button', { class: `btn huge ${judgedCorrect ? 'primary' : ''}`, onclick: actions.next }, 'Siguiente pregunta ', kbd('Espacio')),
        h('button', { class: 'btn', onclick: actions.restart }, 'Reiniciar ', kbd('R')),
      ),
    );
  }

  return { root, overlay, render };
}
