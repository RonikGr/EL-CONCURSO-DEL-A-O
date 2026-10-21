// Pantalla de la tele en las secciones de respuestas (Test, Verdad o mentira, Dos verdades, Votación, Estimación).
// Solo espectáculo: se maneja desde el mando.
import { fill, h } from '../shared/dom.js';
import { getColor, getIcon } from '../shared/appearance.js';
import { ANSWER_PROMPT, optionStyle } from '../shared/options.js';
import { ordinal } from '../shared/format.js';
import { APHASE, isTiming } from '../core/answers.js';

export function createAnswerStage() {
  const root = h('section', { class: 'answer-stage' });
  let raf = 0;
  let countdownEl = null;

  function stopCountdown() {
    cancelAnimationFrame(raf);
    countdownEl = null;
  }

  function tick(a) {
    if (!countdownEl) return;
    const left = Math.max(0, a.deadline - performance.now());
    countdownEl.textContent = String(Math.ceil(left / 1000));
    countdownEl.classList.toggle('hurry', left < 5000);
    raf = requestAnimationFrame(() => tick(a));
  }

  function render(view) {
    const a = view.answer;
    stopCountdown();
    if (!a) return;
    delete root.dataset.light; // la luz roja/verde es solo de Reflejos: que no se quede al cambiar de sección
    if (isTiming(a.kind)) return renderTiming(view);
    const started = a.phase !== APHASE.READY && performance.now() >= a.tOpen;
    root.dataset.phase = a.phase === APHASE.OPEN && !started ? 'ready' : a.phase;
    root.dataset.kind = a.kind;

    const progress = view.itemCount ? `Pregunta ${view.itemIndex + 1} de ${view.itemCount}` : '';
    const header = h('p', { class: 'stage-q' }, [view.section.name, progress].filter(Boolean).join(' · '));
    const question = h('p', { class: `answer-question ${a.phase === APHASE.READY ? 'big' : ''}` }, a.text);
    const image = a.image ? h('img', { class: 'answer-image', src: a.image, alt: '' }) : null;

    let body;
    let footer = null;
    if (a.phase === APHASE.READY || !started) {
      body = h('p', { class: 'answer-prompt' }, a.phase === APHASE.READY ? `Preparad los móviles · ${ANSWER_PROMPT[a.kind]}` : 'Preparados…');
    } else if (a.phase === APHASE.REVEALED) {
      body = revealed(a);
    } else {
      body = choices(a);
      countdownEl = a.phase === APHASE.OPEN ? h('span', { class: 'countdown' }) : null;
      footer = h(
        'div',
        { class: 'answer-footer' },
        a.phase === APHASE.OPEN ? countdownEl : h('span', { class: 'times-up' }, '¡Tiempo!'),
        h('span', { class: 'answered-count' }, `${a.answeredIds.length} de ${a.eligibleIds.length} han respondido`),
      );
    }

    fill(root, header, question, image, body, footer);
    if (countdownEl) tick(a);
  }

  // ------------------------------------------------------------------ Contador y Reflejos

  /** Bucle de pintado (reloj, cuenta atrás) que se para solo al repintar. */
  function loop(el, fn) {
    countdownEl = el;
    const step = () => {
      if (countdownEl !== el) return;
      fn(performance.now());
      raf = requestAnimationFrame(step);
    };
    step();
  }

  function renderTiming(view) {
    const a = view.answer;
    const t = performance.now();
    const header = h('p', { class: 'stage-q' }, [view.section.name, a.kind === 'reflejos' ? `Ronda ${a.round} de ${a.rounds}` : view.itemCount ? `Ronda ${view.itemIndex + 1} de ${view.itemCount}` : ''].filter(Boolean).join(' · '));
    root.dataset.kind = a.kind;
    delete root.dataset.light;
    const counter = h('span', { class: 'answered-count' }, `${a.answeredIds.length} de ${a.eligibleIds.length} ${a.kind === 'contador' ? 'han parado' : 'han pulsado'}`);

    if (a.kind === 'contador') {
      const target = h('p', { class: 'target' }, '🎯 ', secs(a.target, 2));
      const modeText = { visible: 'Veréis el reloj', blind: '¡A ciegas! El reloj no se ve', hide: `El reloj desaparece a los ${secs(a.hideAfter, 0)}` }[a.mode];
      if (a.phase === APHASE.READY) {
        root.dataset.phase = 'ready';
        return fill(root, header, h('p', { class: 'answer-question big' }, a.text), target, h('p', { class: 'answer-prompt' }, `${modeText} · Preparad los móviles`));
      }
      if (a.phase === APHASE.REVEALED) {
        root.dataset.phase = 'revealed';
        return fill(root, header, target, rankingList(a, (e) => secs(e.value, 2), (e) => `a ${secs(e.diff, 2)}`));
      }
      root.dataset.phase = a.phase;
      const clock = h('p', { class: 'big-clock' });
      fill(root, header, target, clock, h('div', { class: 'answer-footer' }, a.phase === APHASE.OPEN ? counter : [h('span', { class: 'times-up' }, '¡Tiempo!'), counter]));
      if (a.phase === APHASE.OPEN) {
        loop(clock, (now) => {
          if (now < a.tOpen) {
            clock.textContent = String(Math.ceil((a.tOpen - now) / 1000));
            clock.classList.add('counting');
            return;
          }
          clock.classList.remove('counting');
          const elapsed = (now - a.tOpen) / 1000;
          const hidden = a.mode === 'blind' || (a.mode === 'hide' && elapsed >= a.hideAfter);
          clock.textContent = hidden ? '??,??' : elapsed.toFixed(2).replace('.', ',');
          clock.classList.toggle('hidden-clock', hidden);
        });
      } else {
        clock.textContent = '??,??';
      }
      return;
    }

    // Reflejos
    const who = a.duel ? h('p', { class: 'answer-prompt' }, a.duelPick.length === 2 ? `Duelo: ${a.duelPick[0].name} contra ${a.duelPick[1].name}` : 'Duelo: el presentador elige a los dos') : null;
    if (a.phase === APHASE.READY) {
      root.dataset.phase = 'ready';
      return fill(root, header, h('p', { class: 'answer-question big' }, a.text), who, h('p', { class: 'answer-prompt' }, 'Si pulsáis en rojo, quedáis fuera de la ronda'));
    }
    if (a.phase === APHASE.REVEALED) {
      root.dataset.phase = 'revealed';
      return fill(root, header, h('p', { class: 'answer-question' }, '¿Quién tiene mejores reflejos?'), rankingList(a, (e) => (e.early ? '¡En rojo!' : `${Math.round(e.value)} ms`), () => ''));
    }
    root.dataset.phase = a.phase;
    const green = a.tGreen != null && t >= a.tGreen;
    root.dataset.light = a.phase === APHASE.OPEN && t >= a.tOpen ? (green ? 'green' : 'red') : '';
    const big = h('p', { class: 'light-text' }, a.phase !== APHASE.OPEN ? '¡Fin de la ronda!' : t < a.tOpen ? 'Preparados…' : green ? '¡YA!' : 'Espera…');
    fill(root, header, who, big, h('div', { class: 'answer-footer' }, counter));
  }

  return { root, render, stop: stopCountdown };
}

const secs = (n, decimals) => `${Number(n).toFixed(decimals).replace('.', ',')} s`;

/** Clasificación de una sección de tiempo (Contador o Reflejos). */
function rankingList(a, valueText, diffText) {
  const entries = a.results.entries;
  if (!entries.length) return h('p', { class: 'reveal-line' }, 'Nadie ha pulsado');
  return h(
    'ol',
    { class: 'estimates' },
    entries.map((e) =>
      h(
        'li',
        { class: e.place == null ? 'over' : e.place === 1 ? 'first' : '', style: { '--pc': getColor(e.player.color).bg } },
        h('span', { class: 'f-place' }, e.place ? ordinal(e.place) : '—'),
        avatar(e.player),
        h('span', { class: 'es-name' }, e.player.name),
        h('span', { class: 'es-value' }, valueText(e)),
        h('span', { class: 'es-diff' }, diffText(e)),
        h('strong', { class: 'es-points' }, e.points ? `+${e.points}` : ''),
      ),
    ),
  );
}

// ---------------------------------------------------------------------------------------- Mientras se responde

function choices(a) {
  if (a.kind === 'votacion') {
    return h(
      'ul',
      { class: 'candidates' },
      a.candidates.map((p) => h('li', { style: { '--pc': getColor(p.color).bg, '--pc-fg': getColor(p.color).fg } }, avatar(p), h('span', {}, p.name))),
    );
  }
  if (a.kind === 'estimacion') {
    return h('p', { class: 'answer-prompt' }, `Escribid vuestra respuesta${a.unit ? ` (en ${a.unit})` : ''}${a.noOver ? ' · ¡sin pasaros!' : ''}`);
  }
  return h(
    'ol',
    { class: `options n${a.options.length}` },
    a.options.map((label, i) => optionTile(a.kind, i, label)),
  );
}

function optionTile(kind, i, label, extra = {}) {
  const s = optionStyle(kind, i);
  return h(
    'li',
    { class: `option ${extra.class ?? ''}`, style: { '--ob': s.bg, '--of': s.fg } },
    h('span', { class: 'option-shape' }, s.shape),
    h('span', { class: 'option-label' }, label),
    extra.count != null ? h('span', { class: 'option-count' }, String(extra.count)) : null,
  );
}

// ---------------------------------------------------------------------------------------- Revelado

function revealed(a) {
  const res = a.results;
  if (a.kind === 'votacion') return revealVote(a, res);
  if (a.kind === 'estimacion') return revealEstimate(a, res);

  const total = Math.max(1, ...a.counts);
  const winners = res.entries.filter((e) => e.correct);
  return h(
    'div',
    { class: 'reveal' },
    h(
      'ol',
      { class: `options n${a.options.length} revealed` },
      a.options.map((label, i) =>
        optionTile(a.kind, i, label, {
          class: i === a.correct ? 'correct' : 'wrong',
          count: a.counts[i],
        }),
      ),
    ),
    h(
      'div',
      { class: 'bars' },
      a.options.map((_, i) =>
        h(
          'span',
          { class: `bar ${i === a.correct ? 'correct' : ''}`, style: { '--ob': optionStyle(a.kind, i).bg, '--h': `${(a.counts[i] / total) * 100}%` } },
          h('span', {}, String(a.counts[i])),
        ),
      ),
    ),
    // Solo si el protagonista está jugando (si no, nadie suma por engañar).
    a.kind === 'dosVerdades' && a.subject?.id
      ? h('p', { class: 'reveal-line' }, `${a.subject.name} ha engañado a ${res.fooled ?? 0} ${res.fooled === 1 ? 'persona' : 'personas'}`)
      : null,
    winners.length
      ? h(
          'ul',
          { class: 'scorers' },
          winners.map((e) => h('li', { style: { '--pc': getColor(e.player.color).bg } }, avatar(e.player), e.player.name, h('strong', {}, `+${e.points}${e.doubled ? ' (×2)' : ''}`))),
        )
      : h('p', { class: 'reveal-line' }, 'Nadie ha acertado'),
  );
}

function revealVote(a, res) {
  const rows = [...a.candidates].map((p) => ({ p, votes: a.counts[p.id] ?? 0 })).sort((x, y) => y.votes - x.votes);
  const max = Math.max(1, ...rows.map((r) => r.votes));
  const winnerIds = new Set(res.winners.map((w) => w.id));
  return h(
    'div',
    { class: 'reveal' },
    res.winners.length
      ? h('p', { class: 'vote-winner' }, res.winners.map((w) => `${getIcon(w.icon).glyph} ${w.name}`).join(' · '))
      : h('p', { class: 'reveal-line' }, 'Nadie ha votado'),
    h(
      'ol',
      { class: 'vote-bars' },
      rows.map((r) =>
        h(
          'li',
          { class: winnerIds.has(r.p.id) ? 'winner' : '', style: { '--pc': getColor(r.p.color).bg, '--w': `${(r.votes / max) * 100}%` } },
          avatar(r.p),
          h('span', { class: 'vb-name' }, r.p.name),
          h('span', { class: 'vb-bar' }, h('span', {})),
          h('span', { class: 'vb-votes' }, `${r.votes} ${r.votes === 1 ? 'voto' : 'votos'}`),
        ),
      ),
    ),
    res.winners.length ? h('p', { class: 'reveal-line' }, `Suman ${a.points[0]} quienes votaron con la mayoría`) : null,
  );
}

function revealEstimate(a, res) {
  const fmt = (n) => `${n.toLocaleString('es-ES')}${a.unit ? ` ${a.unit}` : ''}`;
  return h(
    'div',
    { class: 'reveal' },
    h('p', { class: 'estimate-answer' }, fmt(a.correct)),
    h(
      'ol',
      { class: 'estimates' },
      res.entries.map((e) =>
        h(
          'li',
          { class: e.over ? 'over' : e.place === 1 ? 'first' : '', style: { '--pc': getColor(e.player.color).bg } },
          h('span', { class: 'f-place' }, e.place ? ordinal(e.place) : '—'),
          avatar(e.player),
          h('span', { class: 'es-name' }, e.player.name),
          h('span', { class: 'es-value' }, fmt(e.value)),
          h('span', { class: 'es-diff' }, e.over ? 'se pasó' : `a ${e.diff.toLocaleString('es-ES')}`),
          h('strong', { class: 'es-points' }, e.points ? `+${e.points}` : ''),
        ),
      ),
    ),
  );
}

const avatar = (p) =>
  h('span', { class: 'mini-avatar emoji', style: { '--pc': getColor(p.color).bg, '--pc-fg': getColor(p.color).fg }, 'aria-hidden': 'true' }, getIcon(p.icon).glyph);
