// Pantalla de juego del Pulsador en la tele: pregunta en grande, estado del turno y ganador a pantalla completa.
import { fill, h } from '../shared/dom.js';
import { getColor, getIcon } from '../shared/appearance.js';
import { formatDeltaMs, formatSeconds, ordinal } from '../shared/format.js';
import { PHASE } from '../core/game.js';
import { MIN_PLAYERS } from '../core/players.js';

const kbd = (key) => h('kbd', {}, key);

/**
 * @param actions {open, correct, wrong, nextItem, restart, showQuestion, showAnswer}
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

  function questionBlock(view, big) {
    const item = view.item;
    const progress = view.itemCount ? `Pregunta ${view.itemIndex + 1} de ${view.itemCount}` : `Pregunta ${view.itemIndex + 1}`;
    const showText = item?.showOnTv && view.shown.question && item.question;
    return [
      h('p', { class: 'stage-q' }, `${view.section.name} · ${progress}`),
      showText ? h('p', { class: `stage-question ${big ? 'big' : ''}` }, item.question) : null,
      item?.song && !showText ? h('p', { class: 'stage-question song' }, '🎵 ¿Qué canción es?') : null,
      view.shown.answer && item?.answer ? h('p', { class: 'stage-answer' }, item.answer) : null,
    ];
  }

  function render(view) {
    const game = view.game;
    stopTimer();
    overlay.hidden = !game || game.phase !== PHASE.RESULT || view.peekScoreboard;
    if (!game) return;

    switch (game.phase) {
      case PHASE.IDLE:
        root.dataset.phase = 'idle';
        fill(
          root,
          questionBlock(view, true),
          view.shown.question ? null : h('p', { class: 'stage-title' }, 'Pregunta en el aire'),
          h(
            'div',
            { class: 'stage-actions' },
            h('button', { class: 'btn primary huge', disabled: !view.canStart, onclick: actions.open }, 'Abrir turno ', kbd('Espacio')),
            view.item?.showOnTv && !view.shown.question && view.item.question
              ? h('button', { class: 'btn', onclick: actions.showQuestion }, 'Mostrar pregunta ', kbd('P'))
              : null,
          ),
          view.canStart ? null : h('p', { class: 'stage-hint' }, `Hacen falta al menos ${MIN_PLAYERS} jugadores conectados.`),
        );
        break;

      case PHASE.OPEN: {
        const started = performance.now() >= game.tOpen;
        root.dataset.phase = started ? 'open' : 'ready';
        timerEl = started ? h('p', { class: 'stage-timer' }) : null;
        fill(
          root,
          questionBlock(view, false),
          h('p', { class: 'stage-title' }, started ? '¡Pulsad!' : 'Preparados…'),
          timerEl,
          h(
            'div',
            { class: 'stage-actions' },
            h('button', { class: 'btn', onclick: actions.restart }, 'Reiniciar pregunta ', kbd('R')),
            h('button', { class: 'btn', onclick: actions.nextItem }, 'Saltar pregunta'),
          ),
        );
        if (timerEl) tickTimer(game.tOpen);
        break;
      }

      case PHASE.RESULT:
        // La tele la ocupa el overlay; debajo se deja la pregunta.
        root.dataset.phase = 'result';
        fill(root, questionBlock(view, true));
        renderResult(view);
        break;

      case PHASE.CLOSED:
        root.dataset.phase = 'closed';
        fill(
          root,
          questionBlock(view, false),
          h('p', { class: 'stage-title' }, 'Nadie más puede responder'),
          h(
            'div',
            { class: 'stage-actions' },
            view.item?.answer && !view.shown.answer ? h('button', { class: 'btn', onclick: actions.showAnswer }, 'Mostrar respuesta ', kbd('V')) : null,
            h('button', { class: 'btn primary huge', onclick: actions.nextItem }, 'Siguiente pregunta ', kbd('Espacio')),
            h('button', { class: 'btn', onclick: actions.restart }, 'Reiniciar ', kbd('R')),
          ),
        );
        break;
    }
  }

  function renderResult(view) {
    const game = view.game;
    const winner = game.winner;
    if (!winner) return;
    const color = getColor(winner.color);
    overlay.style.setProperty('--win', color.bg);
    overlay.style.setProperty('--win-fg', color.fg);

    const first = game.ranking[0];
    const followers = game.ranking.slice(1);
    const judgedCorrect = game.judged === 'correct';
    const team = view.teams.find((t) => t.id === winner.teamId);

    fill(
      overlay,
      h('p', { class: 'result-q' }, `${view.section.name} · Pregunta ${view.itemIndex + 1}`),
      h('div', { class: 'result-avatar emoji', 'aria-hidden': 'true' }, getIcon(winner.icon).glyph),
      h('h2', { class: 'result-name' }, winner.name),
      team ? h('p', { class: 'result-team' }, team.name) : null,
      h('p', { class: 'result-time' }, first ? formatSeconds(first.reactionMs) : ''),
      judgedCorrect ? h('p', { class: 'result-verdict' }, `¡Correcto! +${view.pointsForCorrect}`) : null,
      view.shown.answer && view.item?.answer ? h('p', { class: 'result-answer' }, view.item.answer) : null,
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
              h('button', { class: 'btn ok huge', onclick: actions.correct }, `Acierto +${view.pointsForCorrect} `, kbd('A')),
              h(
                'button',
                { class: 'btn bad huge', onclick: actions.wrong },
                'Fallo: rebote al resto ',
                view.pointsForWrong ? `(${view.pointsForWrong > 0 ? '+' : ''}${view.pointsForWrong}) ` : '',
                kbd('F'),
              ),
            ],
        view.item?.answer && !view.shown.answer ? h('button', { class: 'btn', onclick: actions.showAnswer }, 'Mostrar respuesta ', kbd('V')) : null,
        h('button', { class: `btn huge ${judgedCorrect ? 'primary' : ''}`, onclick: actions.nextItem }, 'Siguiente pregunta ', kbd('Espacio')),
        h('button', { class: 'btn', onclick: actions.restart }, 'Reiniciar ', kbd('R')),
      ),
    );
  }

  return { root, overlay, render };
}
