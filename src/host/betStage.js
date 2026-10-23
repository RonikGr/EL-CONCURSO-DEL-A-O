// Pantalla de la tele en La gran apuesta: primero quién ha apostado ya (sin decir cuánto), luego la pregunta y quién
// ha respondido, y al revelar la buena en verde y lo que gana o pierde cada uno.
import { fill, h } from '../shared/dom.js';
import { getColor } from '../shared/appearance.js';
import { BPHASE } from '../core/bet.js';
import { kinetic } from './fx/motion.js';

const LETTERS = ['A', 'B', 'C', 'D'];

export function createBetStage() {
  const root = h('section', { class: 'bet-stage' });

  function stop() {}

  function render(view) {
    const b = view.bet;
    if (!b) return;
    root.dataset.phase = b.phase;
    const header = h('p', { class: 'stage-q' }, [view.section.name, b.rounds > 1 ? `Apuesta ${b.round} de ${b.rounds}` : ''].filter(Boolean).join(' · '));
    const revealed = b.phase === BPHASE.REVEALED;

    const owners = h(
      'ul',
      { class: 'bet-owners' },
      b.owners.map((o) => {
        let status;
        if (revealed) status = [h('span', { class: 'bo-bet' }, `💰 ${o.bet ?? 0}`), h('span', { class: `bo-result ${o.result > 0 ? 'win' : o.result < 0 ? 'lose' : ''}` }, o.result > 0 ? `+${o.result}` : String(o.result ?? 0))];
        else if (b.phase === BPHASE.BETTING) status = h('span', { class: `bo-status ${o.hasBet ? 'done' : ''}` }, o.hasBet ? '✓ Ha apostado' : '💰 Apostando…');
        else status = h('span', { class: `bo-status ${o.hasAnswer ? 'done' : ''}` }, o.hasAnswer ? '✓ Ha respondido' : '🤔 Pensando…');
        return h(
          'li',
          { style: { '--tc': getColor(o.color).bg } },
          h('strong', {}, o.name),
          o.spokesperson && !revealed ? h('small', {}, `Decide ${o.spokesperson}`) : null,
          revealed && o.answer != null ? h('span', { class: `bo-answer ${o.answer === b.correct ? 'ok' : 'ko'}` }, LETTERS[o.answer]) : null,
          status,
        );
      }),
    );

    if (b.phase === BPHASE.BETTING) {
      return fill(
        root,
        header,
        kinetic('h2', 'bet-title display', 'La gran apuesta'),
        h('p', { class: 'answer-prompt' }, 'Apostad en el móvil cuántos puntos os jugáis. Si acertáis la pregunta, los ganáis; si falláis, los perdéis.'),
        owners,
      );
    }

    fill(
      root,
      header,
      h('h2', { class: 'bet-question' }, b.question),
      h(
        'ol',
        { class: 'bet-options' },
        b.options.map((o, i) => h('li', { class: revealed && i === b.correct ? 'correct' : revealed ? 'dim' : '' }, h('span', { class: 'bl' }, `${LETTERS[i]}:`), ` ${o}`)),
      ),
      owners,
    );
  }

  return { root, render, stop };
}
