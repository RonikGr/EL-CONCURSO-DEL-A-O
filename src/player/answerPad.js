// Pantalla del móvil en las secciones de respuestas: opciones, votar a un jugador y escribir un número.
// También las de tiempo: el botón de STOP del Contador y la luz roja/verde de Reflejos.
import { fill, h } from '../shared/dom.js';
import { avatarOf, getColor } from '../shared/appearance.js';
import { ANSWER_PROMPT, optionStyle } from '../shared/options.js';
import { parseNumber } from '../core/show.js';
import { isTiming } from '../core/answers.js';
import { formatGap } from '../shared/format.js';

/**
 * @param onAnswer(roundId, value, tLocal?)  envía la respuesta (tLocal: instante del toque, en las de tiempo)
 * @param toLocal(tHost)   instante del presentador → reloj local (o null sin sincronizar)
 */
export function createAnswerPad({ onAnswer, toLocal }) {
  const root = h('section', { class: 'answer-pad', hidden: true });
  let signature = null;
  let pending = null; // respuesta enviada que el presentador aún no ha confirmado: {roundId, value}
  let selected = null; // primera pulsación: elegida pero sin confirmar {roundId, value}
  let timer = null;
  let current = null;
  let receivedAt = 0;
  let raf = 0;

  /** Instante local de un momento del presentador; sin sincronizar, cuenta desde que llegó el estado. */
  function local(hostT, msFromReceipt) {
    return toLocal(hostT) ?? receivedAt + msFromReceipt;
  }

  function render(a, { stateReceivedAt }) {
    current = a;
    receivedAt = stateReceivedAt;
    if (pending && (pending.roundId !== a.roundId || a.you.answered)) pending = null;
    if (selected && (selected.roundId !== a.roundId || a.you.answered || a.phase !== 'open')) selected = null;
    const now = performance.now();
    const started = a.phase !== 'ready' && now >= local(a.tOpen, a.opensInMs);
    const tGreen = a.tGreen != null ? local(a.tGreen, a.greenInMs) : null;
    const green = tGreen != null && now >= tGreen;
    const left = a.phase === 'open' && !started ? local(a.tOpen, a.opensInMs) - now : 0;
    const count = left > 900 ? Math.ceil(left / 1000) : null; // cuenta atrás 3-2-1
    // Reflejos: qué se ve ahora (colores que engañan, la araña…) y cuándo cambia
    const cues = (a.reflex?.cues ?? []).map((c) => ({ at: local(c.t, c.inMs), show: c.show }));
    const show = a.phase === 'open' && started ? (cues.filter((c) => c.at <= now).at(-1)?.show ?? (green ? 'green' : 'red')) : null;
    const nextCue = a.phase === 'open' ? cues.find((c) => c.at > now) : null;
    const sig = JSON.stringify([a.roundId, a.phase, started, green, show, count, a.you, a.result, a.canAnswer, a.turnOf, a.myTurn, pending, selected]);
    clearTimeout(timer);
    const again = () => current && render(current, { stateReceivedAt: receivedAt });
    if (a.phase === 'open' && !started) timer = setTimeout(again, left > 1000 ? (left % 1000) + 5 : left);
    else if (nextCue) timer = setTimeout(again, nextCue.at - now); // Reflejos: siguiente cambio de luz
    else if (a.phase === 'open' && tGreen != null && !green) timer = setTimeout(again, tGreen - now); // Reflejos: a verde
    if (sig === signature) return;
    signature = sig;
    cancelAnimationFrame(raf);

    if (isTiming(a.kind)) {
      fill(root, h('p', { class: 'ap-label' }, a.label), timingBody(a, started, show));
      return;
    }

    const answered = a.you.answered || !!pending;
    const chosen = a.you.answered ? a.you.value : pending?.value;
    let body;
    if (a.phase === 'ready' || !started) {
      body = [
        h(
          'p',
          { class: `ap-big ${count ? 'ap-count' : ''}` },
          count ? String(count) : a.turnOf && !a.myTurn ? `Le toca a ${a.turnOf}` : a.myTurn ? '¡Te toca a ti!' : a.phase === 'ready' ? 'Prepárate' : 'Preparados…',
        ),
        h('p', { class: 'ap-sub' }, a.turnOf && !a.myTurn ? 'Esta pregunta no es tuya: ¡sin soplar! 🤐' : ANSWER_PROMPT[a.kind]),
      ];
    } else if (a.phase === 'revealed') {
      body = resultView(a);
    } else if (a.you.cheated) {
      body = [h('p', { class: 'ap-big' }, '🚨 Pillado'), h('p', { class: 'ap-sub' }, 'Saliste de la app con la pregunta abierta: en esta pregunta no cuentas.')];
    } else if (!a.canAnswer) {
      body = [
        h('p', { class: 'ap-big' }, a.isSubject ? 'Es sobre ti 🤫' : a.turnOf ? `Le toca a ${a.turnOf}` : 'Espera'),
        h(
          'p',
          { class: 'ap-sub' },
          a.isSubject ? 'Tú no votas: a ver a cuántos engañas.' : a.turnOf ? 'Esta pregunta no es tuya: ¡sin soplar! 🤐' : 'Esta pregunta empezó antes de que entraras.',
        ),
      ];
    } else if (a.phase === 'closed') {
      body = [h('p', { class: 'ap-big' }, '¡Tiempo!'), h('p', { class: 'ap-sub' }, answered ? `Tu respuesta: ${describe(a, chosen)}` : 'No te ha dado tiempo a responder')];
    } else {
      body = [
        h('div', { class: 'ap-top' }, h('span', { class: 'ap-countdown', id: 'ap-countdown' }), h('p', { class: 'ap-question' }, a.text)),
        answerInputs(a, answered, chosen),
        answered
          ? h('p', { class: 'ap-sent' }, '✓ Respuesta enviada')
          : selected
            ? h('p', { class: 'ap-confirm' }, 'Toca otra vez la misma para confirmar')
            : null,
      ];
    }
    fill(root, h('p', { class: 'ap-label' }, a.label), body);
    startCountdown(a);
  }

  // ------------------------------------------------------------------ Contador y Reflejos

  function timingBody(a, started, show) {
    const pressed = a.you.answered || !!pending;
    const prep = a.kind === 'contador' ? `🎯 ${secs(a.target, 2)} · ${MODE_TEXT[a.mode](a)}` : `Ronda ${a.round} de ${a.rounds} · ${REFLEX_HINT[a.reflex?.variant ?? 'green']}`;
    if (a.phase === 'ready') return [h('p', { class: 'ap-big' }, 'Prepárate'), h('p', { class: 'ap-sub' }, prep)];
    if (a.phase === 'revealed') return resultView(a);
    if (!a.canAnswer) return [h('p', { class: 'ap-big' }, 'Espera'), h('p', { class: 'ap-sub' }, a.kind === 'reflejos' ? 'Esta ronda no es para ti: ¡mira la tele!' : 'Esta ronda empezó antes de que entraras.')];
    if (a.phase === 'closed') return [h('p', { class: 'ap-big' }, '¡Tiempo!'), h('p', { class: 'ap-sub' }, pressed ? 'Mira la tele para el resultado' : 'No has pulsado')];

    if (a.kind === 'contador') {
      const clock = h('p', { class: 'ap-clock' });
      const button = h('button', { type: 'button', class: `ap-stop ${pressed ? 'done' : ''}`, disabled: pressed }, pressed ? '¡Parado!' : 'STOP');
      button.addEventListener('pointerdown', press);
      const startAt = local(a.tOpen, a.opensInMs);
      const tick = () => {
        if (!clock.isConnected) return;
        const now = performance.now();
        if (now < startAt) {
          clock.textContent = String(Math.ceil((startAt - now) / 1000));
          clock.classList.add('counting');
        } else {
          const elapsed = (now - startAt) / 1000;
          // Tras pulsar no se enseña el tiempo: se descubre al revelar.
          const hidden = pressed || a.mode === 'blind' || (a.mode === 'hide' && elapsed >= a.hideAfter);
          clock.classList.remove('counting');
          clock.textContent = hidden ? '??,??? s' : `${elapsed.toFixed(3).replace('.', ',')} s`;
        }
        raf = requestAnimationFrame(tick);
      };
      queueMicrotask(tick);
      return [h('p', { class: 'ap-sub' }, `🎯 ${secs(a.target, 2)}`), clock, button];
    }

    // Reflejos: el botón entero es la luz (o la araña). Encima, la regla de esta ronda.
    const target = a.reflex?.target ?? 'green';
    const light = !started ? 'wait' : a.you.early ? 'out' : (show ?? 'red');
    const label = !started
      ? 'Preparados…'
      : a.you.early
        ? '¡Demasiado pronto!'
        : light === target
          ? '¡YA!'
          : light === 'red'
            ? 'Espera…'
            : light === 'spider' || light === 'peek'
              ? '🕷️'
              : '';
    const button = h('button', { type: 'button', class: `ap-light ${light} ${pressed ? 'done' : ''}`, disabled: pressed }, pressed && !a.you.early ? '¡Pulsado!' : label);
    button.addEventListener('pointerdown', press);
    return [h('p', { class: 'ap-sub ap-rule' }, a.reflex?.rule ?? REFLEX_HINT[a.reflex?.variant ?? 'green']), button];
  }

  /** Pulsación en una sección de tiempo: cuenta el instante del toque (event.timeStamp), como en el pulsador. */
  function press(e) {
    e.preventDefault();
    if (!current || pending || current.you.answered) return;
    const now = performance.now();
    const tLocal = Math.abs(now - e.timeStamp) < 1000 ? e.timeStamp : now;
    pending = { roundId: current.roundId, value: 0 };
    onAnswer(current.roundId, 0, tLocal);
    render(current, { stateReceivedAt: receivedAt });
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

  /** Primera pulsación: elegir. Segunda en la misma: confirmar y enviar. Otra distinta: cambiar la elección. */
  function select(value) {
    if (!current || pending) return;
    if (selected?.roundId === current.roundId && selected.value === value) return send(value);
    selected = { roundId: current.roundId, value };
    render(current, { stateReceivedAt: receivedAt });
  }

  function send(value) {
    if (!current || pending) return;
    pending = { roundId: current.roundId, value };
    selected = null;
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
              class: `ap-candidate ${chosen === p.id ? 'chosen' : ''} ${selected?.value === p.id ? 'selected' : ''}`,
              disabled: answered,
              style: { '--pc': getColor(p.color).bg, '--pc-fg': getColor(p.color).fg },
              onclick: () => select(p.id),
            },
            h('span', { class: 'ap-avatar emoji' }, avatarOf(p)),
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
    return h(
      'div',
      { class: `ap-options n${a.options.length}` },
      a.options.map((label, i) => {
        const s = optionStyle(a.kind, i);
        return h(
          'button',
          {
            type: 'button',
            class: `ap-option ${chosen === i ? 'chosen' : ''} ${selected?.value === i ? 'selected' : ''}`,
            disabled: answered,
            style: { '--ob': s.bg, '--of': s.fg },
            onclick: () => select(i),
          },
          h('span', { class: 'ap-shape' }, s.shape),
          h('span', { class: 'ap-option-label' }, label),
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

/** Reflejos antes de empezar: qué tipo de ronda viene. */
const REFLEX_HINT = {
  green: 'Pulsa cuando se ponga en VERDE; si pulsas antes, quedas fuera',
  color: '¡Ojo! Hay que esperar a un color concreto… y el verde puede engañar',
  spider: '¡Cuidado con la araña! Mientras esté, no se pulsa',
};

const secs = (n, decimals) => `${Number(n).toFixed(decimals).replace('.', ',')} s`;
const MODE_TEXT = {
  visible: () => 'verás el reloj',
  blind: () => '¡a ciegas!',
  hide: (a) => `el reloj desaparece a los ${secs(a.hideAfter, 0)}`,
};

function describe(a, value) {
  if (value == null) return '—';
  if (a.kind === 'votacion') return a.candidates.find((p) => p.id === value)?.name ?? '¿?';
  if (a.kind === 'estimacion') return `${Number(value).toLocaleString('es-ES')}${a.unit ? ` ${a.unit}` : ''}`;
  return `${optionStyle(a.kind, value).shape} ${a.options[value]}`;
}

function resultView(a) {
  const r = a.result;
  // Mientras la tele hace el suspense, el portátil aún no manda el resultado
  if (!r) return [h('p', { class: 'ap-big' }, '👀 Mira la tele'), h('p', { class: 'ap-sub' }, '¡Ahora viene el resultado!')];
  if (r.fooled != null) {
    return [h('p', { class: 'ap-big' }, `Has engañado a ${r.fooled}`), h('p', { class: `ap-points ${r.points ? 'plus' : ''}` }, r.points ? `+${r.points}` : 'Sin puntos')];
  }
  if (!a.you.answered) {
    return [h('p', { class: 'ap-big' }, isTiming(a.kind) ? 'No pulsaste' : 'No respondiste'), r.correctLabel ? h('p', { class: 'ap-sub' }, `Era: ${r.correctLabel}`) : null];
  }
  const pts = h('p', { class: `ap-points ${r.points ? 'plus' : ''}` }, r.points ? `+${r.points}` : 'Sin puntos');
  if (a.kind === 'contador') {
    return [h('p', { class: 'ap-big' }, `Has quedado ${r.place}º`), h('p', { class: 'ap-sub' }, `Paraste en ${secs(r.value, 3)} · a ${formatGap(r.diff)} del objetivo`), pts];
  }
  if (a.kind === 'reflejos') {
    if (r.early) return [h('p', { class: 'ap-big' }, '¡Pulsaste en rojo!'), h('p', { class: 'ap-sub' }, 'Fuera de esta ronda'), pts];
    return [h('p', { class: 'ap-big' }, `Has quedado ${r.place}º`), h('p', { class: 'ap-sub' }, `Reacción: ${Math.round(r.value)} ms`), pts];
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
