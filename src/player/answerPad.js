// Pantalla del móvil en las secciones de respuestas: opciones, votar a un jugador, escribir un número y comodines.
import { fill, h } from '../shared/dom.js';
import { getColor, getIcon } from '../shared/appearance.js';
import { ANSWER_PROMPT, optionStyle } from '../shared/options.js';
import { parseNumber } from '../core/show.js';

const JOKER_INFO = {
  fifty: { label: '50 %', help: 'Quita la mitad de las respuestas incorrectas' },
  double: { label: '×2', help: 'Si aciertas, puntos dobles' },
  audience: { label: 'Público', help: 'Ves qué están respondiendo los demás' },
};

/**
 * @param onAnswer(value)  envía la respuesta
 * @param onJoker(kind)    usa un comodín
 * @param toLocal(tHost)   instante del presentador → reloj local (o null sin sincronizar)
 */
export function createAnswerPad({ onAnswer, onJoker, toLocal }) {
  const root = h('section', { class: 'answer-pad', hidden: true });
  let signature = null;
  let pending = null; // respuesta enviada que el presentador aún no ha confirmado: {roundId, value}
  let timer = null;
  let current = null;
  let receivedAt = 0;

  /** Instante local de un momento del presentador; sin sincronizar, cuenta desde que llegó el estado. */
  function local(hostT, msFromReceipt) {
    return toLocal(hostT) ?? receivedAt + msFromReceipt;
  }

  function render(a, { stateReceivedAt }) {
    current = a;
    receivedAt = stateReceivedAt;
    if (pending && (pending.roundId !== a.roundId || a.you.answered)) pending = null;
    const started = a.phase !== 'ready' && performance.now() >= local(a.tOpen, a.opensInMs);
    const sig = JSON.stringify([a.roundId, a.phase, started, a.you, a.removed, a.jokers, a.audience, a.result, a.canAnswer, pending]);
    clearTimeout(timer);
    if (a.phase === 'open' && !started) timer = setTimeout(() => current && render(current, { stateReceivedAt: receivedAt }), local(a.tOpen, a.opensInMs) - performance.now());
    if (sig === signature) return;
    signature = sig;

    const answered = a.you.answered || !!pending;
    const chosen = a.you.answered ? a.you.value : pending?.value;
    let body;
    if (a.phase === 'ready' || !started) {
      body = [h('p', { class: 'ap-big' }, a.phase === 'ready' ? 'Prepárate' : 'Preparados…'), h('p', { class: 'ap-sub' }, ANSWER_PROMPT[a.kind])];
    } else if (a.phase === 'revealed') {
      body = resultView(a);
    } else if (!a.canAnswer) {
      body = [h('p', { class: 'ap-big' }, a.isSubject ? 'Es sobre ti 🤫' : 'Espera'), h('p', { class: 'ap-sub' }, a.isSubject ? 'Tú no votas: a ver a cuántos engañas.' : 'Esta pregunta empezó antes de que entraras.')];
    } else if (a.phase === 'closed') {
      body = [h('p', { class: 'ap-big' }, '¡Tiempo!'), h('p', { class: 'ap-sub' }, answered ? `Tu respuesta: ${describe(a, chosen)}` : 'No te ha dado tiempo a responder')];
    } else {
      body = [
        h('div', { class: 'ap-top' }, h('span', { class: 'ap-countdown', id: 'ap-countdown' }), h('p', { class: 'ap-question' }, a.text)),
        answerInputs(a, answered, chosen),
        answered ? h('p', { class: 'ap-sent' }, '✓ Respuesta enviada') : null,
        a.jokers && !answered ? jokerBar(a) : null,
      ];
    }
    fill(root, h('p', { class: 'ap-label' }, a.label), body);
    startCountdown(a);
  }

  function startCountdown(a) {
    const el = root.querySelector('#ap-countdown');
    if (!el || a.deadline == null) return;
    const end = local(a.deadline, a.remainingMs);
    const tick = () => {
      if (!el.isConnected) return;
      const left = Math.max(0, end - performance.now());
      el.textContent = String(Math.ceil(left / 1000));
      el.classList.toggle('hurry', left < 5000);
      if (left > 0) setTimeout(tick, 200);
    };
    tick();
  }

  function send(value) {
    if (!current || pending) return;
    pending = { roundId: current.roundId, value };
    onAnswer(current.roundId, value);
    render(current, { stateReceivedAt: receivedAt });
  }

  /** El presentador rechazó la respuesta (p. ej. llegó tarde): se puede volver a intentar si sigue abierta. */
  function rejectPending() {
    pending = null;
    if (current) render(current, { stateReceivedAt: receivedAt });
  }

  function answerInputs(a, answered, chosen) {
    if (a.kind === 'votacion') {
      return h(
        'div',
        { class: 'ap-candidates' },
        a.candidates.map((p) =>
          h(
            'button',
            {
              type: 'button',
              class: `ap-candidate ${chosen === p.id ? 'chosen' : ''}`,
              disabled: answered,
              style: { '--pc': getColor(p.color).bg, '--pc-fg': getColor(p.color).fg },
              onclick: () => send(p.id),
            },
            h('span', { class: 'ap-avatar emoji' }, getIcon(p.icon).glyph),
            h('span', {}, p.name),
          ),
        ),
      );
    }
    if (a.kind === 'estimacion') {
      if (answered) return h('p', { class: 'ap-big' }, describe(a, chosen));
      const input = h('input', { class: 'ap-number', type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: a.unit ? `en ${a.unit}` : 'Tu número' });
      const submit = () => {
        const value = parseNumber(input.value); // "1,5", "1.234,5", "12.000"… como en la hoja
        if (value == null) {
          input.classList.add('invalid');
          return input.focus();
        }
        send(value);
      };
      input.addEventListener('keydown', (e) => e.key === 'Enter' && submit());
      return h('div', { class: 'ap-estimate' }, input, h('button', { type: 'button', class: 'btn primary big', onclick: submit }, 'Enviar'));
    }
    const total = a.audience ? Math.max(1, a.audience.reduce((s, n) => s + n, 0)) : 0;
    return h(
      'div',
      { class: `ap-options n${a.options.length}` },
      a.options.map((label, i) => {
        const s = optionStyle(a.kind, i);
        const removed = a.removed.includes(i);
        return h(
          'button',
          {
            type: 'button',
            class: `ap-option ${chosen === i ? 'chosen' : ''} ${removed ? 'removed' : ''}`,
            disabled: answered || removed,
            style: { '--ob': s.bg, '--of': s.fg },
            onclick: () => send(i),
          },
          h('span', { class: 'ap-shape' }, s.shape),
          h('span', { class: 'ap-option-label' }, label),
          a.audience ? h('span', { class: 'ap-audience' }, `${Math.round((a.audience[i] / total) * 100)} %`) : null,
        );
      }),
    );
  }

  function jokerBar(a) {
    return h(
      'div',
      { class: 'ap-jokers' },
      Object.entries(JOKER_INFO).map(([kind, info]) => {
        const left = a.jokers.remaining[kind];
        const active = a.jokers.active.includes(kind);
        const unavailable = (kind === 'fifty' && a.options.length < 3) || (!active && left <= 0);
        return h(
          'button',
          {
            type: 'button',
            class: `ap-joker ${active ? 'active' : ''}`,
            disabled: active || unavailable,
            title: info.help,
            onclick: () => onJoker(a.roundId, kind),
          },
          h('strong', {}, info.label),
          h('small', {}, active ? 'activo' : `quedan ${left}`),
        );
      }),
    );
  }

  return {
    root,
    render,
    rejectPending,
    hide() {
      root.hidden = true;
      signature = null;
      current = null;
      clearTimeout(timer);
    },
    show() {
      root.hidden = false;
    },
  };
}

function describe(a, value) {
  if (value == null) return '—';
  if (a.kind === 'votacion') return a.candidates.find((p) => p.id === value)?.name ?? '¿?';
  if (a.kind === 'estimacion') return `${Number(value).toLocaleString('es-ES')}${a.unit ? ` ${a.unit}` : ''}`;
  return `${optionStyle(a.kind, value).shape} ${a.options[value]}`;
}

function resultView(a) {
  const r = a.result;
  if (r.fooled != null) {
    return [h('p', { class: 'ap-big' }, `Has engañado a ${r.fooled}`), h('p', { class: `ap-points ${r.points ? 'plus' : ''}` }, r.points ? `+${r.points}` : 'Sin puntos')];
  }
  if (!a.you.answered) {
    return [h('p', { class: 'ap-big' }, 'No respondiste'), r.correctLabel ? h('p', { class: 'ap-sub' }, `Era: ${r.correctLabel}`) : null];
  }
  if (a.kind === 'votacion') {
    const who = r.winners.join(' y ');
    return [
      h('p', { class: 'ap-big' }, r.correct ? '¡Con la mayoría!' : 'Te has desmarcado'),
      h('p', { class: 'ap-sub' }, who ? `La más votada: ${who}` : 'Nadie ha votado'),
      h('p', { class: `ap-points ${r.points ? 'plus' : ''}` }, r.points ? `+${r.points}` : 'Sin puntos'),
    ];
  }
  if (a.kind === 'estimacion') {
    return [
      h('p', { class: 'ap-big' }, r.over ? '¡Te has pasado!' : r.place ? `Has quedado ${r.place}º` : '—'),
      h('p', { class: 'ap-sub' }, `Era ${r.correctLabel}${r.diff != null && !r.over ? ` · fallaste por ${r.diff.toLocaleString('es-ES')}` : ''}`),
      h('p', { class: `ap-points ${r.points ? 'plus' : ''}` }, r.points ? `+${r.points}` : 'Sin puntos'),
    ];
  }
  return [
    h('p', { class: 'ap-big' }, r.correct ? '¡Correcto!' : '¡Fallaste!'),
    r.correct ? null : h('p', { class: 'ap-sub' }, `Era: ${r.correctLabel}`),
    h('p', { class: `ap-points ${r.points ? 'plus' : ''}` }, r.points ? `+${r.points}` : 'Sin puntos'),
  ];
}
