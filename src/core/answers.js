// Secciones en las que todos responden a la vez desde el móvil: Test, Verdad o mentira, Dos verdades y una
// mentira, ¿Quién es más probable…?, Estimación y las de tiempo (Parar el contador, Duelo de reflejos), en las que
// la "respuesta" es el instante de la pulsación. Lógica pura: el tiempo y el azar entran como parámetros.
//
//   ready ──open──▶ open ──(tiempo o todos han respondido)──▶ closed ──reveal──▶ revealed
//
// La primera respuesta es la definitiva. Una respuesta vale si se dio (reloj sincronizado) antes del final.
import { norm } from './show.js';

// El Test no va aquí: se juega como el millonario (core/millionaire.js)
export const ANSWER_TYPES = new Set(['verdad', 'dosVerdades', 'votacion', 'estimacion', 'contador', 'reflejos']);
export const APHASE = { READY: 'ready', OPEN: 'open', CLOSED: 'closed', REVEALED: 'revealed' };
export const ANSWER_RESULT = {
  OK: 'ok',
  CLOSED: 'closed',
  DUPLICATE: 'duplicate',
  NOT_ELIGIBLE: 'not-eligible',
  INVALID: 'invalid',
  LATE: 'late',
  EARLY: 'early', // Contador: aún no ha empezado (no cuenta). Reflejos: pulsó en rojo (eliminado de la ronda).
  CHEAT: 'cheat', // salió de la app con la pregunta abierta: anulado en esta pregunta
};

/** Salir de la app menos de esto no cuenta (un vistazo a una notificación, un parpadeo de la pantalla…). */
export const AWAY_MIN_MS = 1500;
/** Comodines del millonario, uno de cada por equipo (o por jugador sin equipos). */
export const JOKERS = ['fifty', 'audience', 'call'];

const CHOICE_KINDS = new Set(['test', 'verdad', 'dosVerdades']);
export const isChoice = (kind) => CHOICE_KINDS.has(kind);
const TIMING_KINDS = new Set(['contador', 'reflejos']);
/** Secciones en las que se responde pulsando: cuenta el instante, no lo que se elige. */
export const isTiming = (kind) => TIMING_KINDS.has(kind);

/** Contador: cuenta atrás 3-2-1 antes de que empiece a correr el reloj. */
export const COUNTDOWN_MS = 3000;
/** Reflejos: el verde llega entre 2 y 6 s después de ponerse en rojo. */
export const GREEN_MIN_MS = 2000;
export const GREEN_MAX_MS = 6000;
/** Reflejos: tras el verde, cuánto se espera a que pulsen. */
export const REACTION_LIMIT_MS = 3000;

/**
 * Pregunta lista para jugar a partir de una fila de la hoja.
 * @param players [{id, name}] para encontrar al protagonista de "Dos verdades y una mentira"
 */
export function buildQuestion(section, item, { players = [], settings = {} } = {}) {
  const seconds = settings.testSeconds ?? 20;
  const base = { kind: section.type, points: section.points, image: null, unit: '', noOver: false, subjectId: null, subjectName: null };
  switch (section.type) {
    case 'test':
      return { ...base, text: item.question, options: item.options, correct: item.correct, seconds: item.seconds ?? seconds, image: item.image ?? null };
    case 'verdad':
      return { ...base, text: item.statement, options: ['Verdad', 'Mentira'], correct: item.isTrue ? 0 : 1, seconds };
    case 'dosVerdades': {
      const subject = players.find((p) => norm(p.name) === norm(item.about)) ?? null;
      return {
        ...base,
        text: `${item.about}: ¿cuál es la mentira?`,
        options: item.statements,
        correct: item.lie,
        seconds,
        subjectId: subject?.id ?? null,
        subjectName: item.about,
      };
    }
    case 'votacion':
      return { ...base, text: item.question, options: null, correct: null, seconds };
    case 'estimacion':
      return { ...base, text: item.question, options: null, correct: item.answer, seconds: seconds + 10, unit: item.unit ?? '', noOver: !!item.noOver };
    case 'contador':
      // El reloj corre hasta el objetivo y otro tanto (mínimo 5 s) por si alguien se pasa.
      return {
        ...base,
        text: `Para el reloj en ${String(item.target).replace('.', ',')} s`,
        options: null,
        correct: item.target,
        target: item.target,
        mode: item.mode,
        hideAfter: item.hideAfter,
        seconds: item.target + Math.max(5, item.target),
        unit: 's',
      };
    case 'reflejos':
      return {
        ...base,
        text: 'Cuando se ponga verde, ¡pulsa!',
        options: null,
        correct: null,
        round: item.round ?? 1,
        rounds: item.rounds ?? 1,
        duel: !!item.duel,
        seconds: null,
      };
    default:
      throw new Error(`No es una sección de respuestas: ${section.type}`);
  }
}

export class AnswerRound {
  /** @param roundId identifica la ronda: una respuesta con otro id es de una ronda vieja */
  constructor(question, { roundId }) {
    this.question = question;
    this.roundId = roundId;
    this.phase = APHASE.READY;
    this.tOpen = null;
    this.deadline = null;
    this.tGreen = null; // Reflejos: cuándo se pone verde
    this.eligible = new Set();
    this.candidates = []; // votación: a quién se puede votar
    this.answers = new Map(); // playerId → {value, tPress, tArrival}
    this.results = null;
    this.openedAt = null; // cuándo se abrió (antes de la cuenta atrás): desde ahí, salir de la app es sospechoso
    this.closedAt = null;
    this.cheaters = new Set(); // salieron de la app con la pregunta abierta: su respuesta no cuenta
  }

  /**
   * @param eligibleIds jugadores conectados al abrir (el protagonista de "Dos verdades" no responde; en un duelo, los dos)
   * @param greenDelayMs Reflejos: cuánto tarda en ponerse verde (al azar, lo elige quien llama)
   * @param countdownMs cuenta atrás antes de poder responder (Contador tiene la suya; Reflejos, la luz roja)
   */
  open({ now, eligibleIds, scheduledOpenMs = 300, greenDelayMs = GREEN_MIN_MS, countdownMs = 0 }) {
    if (this.phase !== APHASE.READY) return false;
    const kind = this.question.kind;
    this.openedAt = now;
    this.eligible = new Set(eligibleIds.filter((id) => id !== this.question.subjectId));
    if (kind === 'votacion') this.candidates = [...eligibleIds];
    if (kind === 'contador') {
      this.tOpen = now + COUNTDOWN_MS; // el reloj empieza a correr tras la cuenta atrás
      this.deadline = this.tOpen + this.question.seconds * 1000;
    } else if (kind === 'reflejos') {
      this.tOpen = now + scheduledOpenMs; // se pone en rojo
      this.tGreen = this.tOpen + greenDelayMs;
      this.deadline = this.tGreen + REACTION_LIMIT_MS;
    } else {
      this.tOpen = now + Math.max(scheduledOpenMs, countdownMs);
      this.deadline = this.tOpen + this.question.seconds * 1000;
    }
    this.phase = APHASE.OPEN;
    return true;
  }

  answer(playerId, value, { tPress }) {
    if (this.phase !== APHASE.OPEN) return ANSWER_RESULT.CLOSED;
    if (this.cheaters.has(playerId)) return ANSWER_RESULT.CHEAT;
    if (!this.eligible.has(playerId)) return ANSWER_RESULT.NOT_ELIGIBLE;
    if (this.answers.has(playerId)) return ANSWER_RESULT.DUPLICATE;
    if (tPress > this.deadline) return ANSWER_RESULT.LATE;
    if (isTiming(this.question.kind)) return this.#press(playerId, tPress);
    if (!this.#valid(playerId, value)) return ANSWER_RESULT.INVALID;
    this.answers.set(playerId, { value, tPress });
    return ANSWER_RESULT.OK;
  }

  /** Secciones de tiempo: lo que cuenta es cuándo se pulsó (el valor que mande el móvil se ignora). */
  #press(playerId, tPress) {
    if (this.question.kind === 'contador') {
      if (tPress < this.tOpen) return ANSWER_RESULT.EARLY; // durante la cuenta atrás: no cuenta, puede volver a pulsar
      this.answers.set(playerId, { value: (tPress - this.tOpen) / 1000, tPress });
      return ANSWER_RESULT.OK;
    }
    // Reflejos: en rojo queda eliminado de la ronda (cuenta como respondido).
    if (tPress < this.tGreen) {
      this.answers.set(playerId, { value: null, early: true, tPress });
      return ANSWER_RESULT.EARLY;
    }
    this.answers.set(playerId, { value: tPress - this.tGreen, tPress });
    return ANSWER_RESULT.OK;
  }

  /** ¿Han respondido todos los que pueden y siguen conectados? (los anulados ya no cuentan) */
  allAnswered(connectedIds) {
    const pending = [...this.eligible].filter((id) => connectedIds.has(id) && !this.answers.has(id) && !this.cheaters.has(id));
    return this.eligible.size > 0 && pending.length === 0;
  }

  close(now = null) {
    if (this.phase !== APHASE.OPEN) return false;
    this.phase = APHASE.CLOSED;
    this.closedAt = now;
    return true;
  }

  // ---------- Antitrampas

  /**
   * Cuánto tiempo (ms) estuvo fuera de la app un jugador mientras esta pregunta estaba abierta para él y sin responder.
   * @param leftAt/backAt instantes del portátil en que salió y volvió
   */
  awayWhileOpen(playerId, leftAt, backAt) {
    if (this.openedAt == null || !this.eligible.has(playerId)) return 0;
    const answeredAt = this.answers.get(playerId)?.tPress ?? Infinity;
    const end = Math.min(backAt, this.closedAt ?? Infinity, answeredAt);
    return Math.max(0, end - Math.max(leftAt, this.openedAt));
  }

  /** Anula a un jugador en esta pregunta (salió de la app para buscar la respuesta): su respuesta no cuenta. */
  disqualify(playerId) {
    if (this.phase !== APHASE.OPEN && this.phase !== APHASE.CLOSED) return false;
    if (!this.eligible.has(playerId) || this.cheaters.has(playerId)) return false;
    this.cheaters.add(playerId);
    this.answers.delete(playerId);
    return true;
  }

  /** El presentador perdona: vuelve a poder responder (si aún está abierta). */
  forgive(playerId) {
    return this.phase !== APHASE.REVEALED && this.cheaters.delete(playerId);
  }

  reveal() {
    if (this.phase === APHASE.OPEN) this.close();
    if (this.phase !== APHASE.CLOSED) return false;
    this.results = scoreRound(this.question, this.answers, { candidates: this.candidates });
    this.phase = APHASE.REVEALED;
    return true;
  }

  /** Respuestas por opción (o por candidato en la votación). */
  counts() {
    if (this.question.kind === 'votacion') {
      const counts = Object.fromEntries(this.candidates.map((id) => [id, 0]));
      for (const { value } of this.answers.values()) if (value in counts) counts[value]++;
      return counts;
    }
    if (!this.question.options) return null;
    const counts = this.question.options.map(() => 0);
    for (const { value } of this.answers.values()) counts[value]++;
    return counts;
  }

  #valid(playerId, value) {
    const q = this.question;
    if (isChoice(q.kind)) return Number.isInteger(value) && value >= 0 && value < q.options.length;
    if (q.kind === 'votacion') return typeof value === 'string' && value !== playerId && this.candidates.includes(value);
    if (q.kind === 'estimacion') return typeof value === 'number' && Number.isFinite(value);
    return false;
  }
}

/**
 * Puntos de una pregunta.
 * @param answers Map(playerId → {value})
 * @returns {points: {playerId: puntos}, entries: [...], winners?: [candidatos]} — solo quien suma aparece en `points`
 */
export function scoreRound(question, answers, { candidates = [] } = {}) {
  const base = question.points?.[0] ?? 1;
  const points = {};
  const add = (id, n) => {
    if (n) points[id] = (points[id] ?? 0) + n;
  };

  if (isChoice(question.kind)) {
    const entries = [];
    let fooled = 0;
    for (const [id, { value }] of answers) {
      const correct = value === question.correct;
      const pts = correct ? base : 0;
      add(id, pts);
      if (!correct) fooled++;
      entries.push({ playerId: id, value, correct, points: pts });
    }
    // Dos verdades y una mentira: el protagonista gana un punto por cada uno al que engañó.
    if (question.kind === 'dosVerdades' && question.subjectId) add(question.subjectId, fooled);
    return { points, entries, fooled };
  }

  if (question.kind === 'votacion') {
    const counts = Object.fromEntries(candidates.map((id) => [id, 0]));
    for (const { value } of answers.values()) if (value in counts) counts[value]++;
    const max = Math.max(0, ...Object.values(counts));
    const winners = max > 0 ? Object.keys(counts).filter((id) => counts[id] === max) : [];
    const entries = [];
    for (const [id, { value }] of answers) {
      const withMajority = winners.includes(value);
      const pts = withMajority ? base : 0;
      add(id, pts);
      entries.push({ playerId: id, value, correct: withMajority, points: pts });
    }
    return { points, entries, counts, winners };
  }

  // Reflejos: gana el tiempo de reacción más corto; quien pulsó en rojo queda fuera.
  if (question.kind === 'reflejos') {
    const list = [...answers].map(([id, a]) => ({ playerId: id, value: a.value, early: !!a.early, diff: a.early ? null : a.value }));
    const ranked = rankByDiff(
      list.filter((e) => !e.early),
      question.points,
      add,
    );
    return { points, entries: [...ranked, ...list.filter((e) => e.early).map((e) => ({ ...e, place: null, points: 0 }))] };
  }

  // Estimación y Contador: por cercanía al número (o al objetivo en segundos).
  // "Sin pasarse": quien se pasa queda fuera.
  const list = [...answers].map(([id, { value }]) => ({
    playerId: id,
    value,
    diff: Math.abs(value - question.correct),
    over: question.noOver && value > question.correct,
  }));
  const ranked = rankByDiff(
    list.filter((e) => !e.over),
    question.points,
    add,
  );
  return { points, entries: [...ranked, ...list.filter((e) => e.over).map((e) => ({ ...e, place: null, points: 0 }))] };
}

/** Ordena por `diff` (menor = mejor) y reparte puestos y puntos. Empates comparten puesto y puntos. */
function rankByDiff(entries, pointsList, add) {
  const sorted = [...entries].sort((a, b) => a.diff - b.diff);
  let place = 0;
  let lastDiff = null;
  for (const e of sorted) {
    if (e.diff !== lastDiff) {
      place++;
      lastDiff = e.diff;
    }
    e.place = place;
    e.points = pointsList?.[place - 1] ?? 0;
    add(e.playerId, e.points);
  }
  return sorted;
}

/**
 * Comodines que le quedan a cada dueño (equipo, o jugador si no hay equipos) para todo el concurso.
 */
export class JokerBank {
  constructor(allowance = { fifty: 1, audience: 1, call: 1 }, used = {}) {
    this.allowance = { ...allowance };
    this.used = structuredClone(used);
  }

  remaining(ownerId) {
    const used = this.used[ownerId] ?? {};
    return Object.fromEntries(JOKERS.map((k) => [k, Math.max(0, (this.allowance[k] ?? 0) - (used[k] ?? 0))]));
  }

  use(ownerId, kind) {
    if (!(this.remaining(ownerId)[kind] > 0)) return false;
    this.used[ownerId] ??= {};
    this.used[ownerId][kind] = (this.used[ownerId][kind] ?? 0) + 1;
    return true;
  }

  /** Devuelve un comodín (p. ej. al reiniciar la pregunta en la que se usó). */
  refund(ownerId, kind) {
    const n = this.used[ownerId]?.[kind] ?? 0;
    if (n > 0) this.used[ownerId][kind] = n - 1;
  }

  reset() {
    this.used = {};
  }

  toJSON() {
    return this.used;
  }
}

// ------------------------------------------------------------------------------------------ revelado en la tele

/** Redoble antes de que se vea nada (ms). */
export const DRUMROLL_MS = 2400;
/** Test, Verdad, Dos verdades: momento en que se ilumina la respuesta buena (ms). */
export const REVEAL_AT = 2800;
/** Pausa extra antes del ganador en las listas (ms). */
export const WINNER_PAUSE_MS = 1600;

/** Separación entre filas de una lista que aparece del último al primero: con muchas, más rápido. */
export const listGap = (rows) => Math.max(260, Math.min(700, 5000 / Math.max(1, rows)));

/**
 * Cuánto tarda la tele en enseñar quién ha ganado tras revelar (ms). Los puntos se suman entonces, no antes:
 * que los marcadores no chiven el resultado durante el suspense.
 * @param rows filas de la lista (Votación: candidatos; Estimación, Contador, Reflejos: participantes);
 *             en Test y similares, cuántos han acertado
 */
export function revealHoldMs(kind, rows) {
  if (isChoice(kind)) return REVEAL_AT + 700 + rows * 260;
  if (rows <= 0) return DRUMROLL_MS;
  return DRUMROLL_MS + (rows - 1) * listGap(rows) + (rows > 1 ? WINNER_PAUSE_MS : 0) + 500;
}

// ------------------------------------------------------------------------------------------ Reflejos con despistes

/**
 * Variantes de Reflejos. La 1ª ronda es la clásica; las siguientes engañan:
 *  - green:  rojo → verde (pulsa en verde)
 *  - color:  pulsa solo cuando salga el color objetivo; antes salen otros (¡incluido el verde!)
 *  - spider: no pulses mientras esté la araña; a ratos se asoma y vuelve; cuando se va, ¡pulsa!
 */
export const REFLEX_COLORS = {
  green: 'VERDE',
  blue: 'AZUL',
  purple: 'MORADO',
  yellow: 'AMARILLO',
  orange: 'NARANJA',
  white: 'BLANCO',
};

export function reflexVariant(round) {
  if (round <= 1) return 'green';
  return round % 2 === 0 ? 'color' : 'spider';
}

/** Retardo hasta la señal buena: las rondas con despistes duran más (caben los engaños). */
export function reflexDelayMs(variant, rand = Math.random) {
  const [min, max] = variant === 'green' ? [GREEN_MIN_MS, GREEN_MAX_MS] : [4000, 8000];
  return min + rand() * (max - min);
}

/**
 * Lo que se ve en cada momento de una ronda, en el reloj del portátil: [{t, show}], ordenado. `show` es un color
 * ('red', 'green', 'blue'…) o 'spider' / 'peek' (la araña se asoma) / 'clear' (se fue). La señal buena llega siempre en
 * `tGreen`; pulsar antes cuenta como pulsar en rojo.
 * @returns {{cues, target, rule}} target = qué hay que esperar (para el texto de la tele y el móvil)
 */
export function reflexPlan(variant, tOpen, tGreen, rand = Math.random) {
  const span = tGreen - tOpen;
  // Despistes repartidos por la espera, sin pegarse al principio ni a la señal buena
  const decoyTimes = (n) => Array.from({ length: n }, (_, i) => tOpen + span * ((i + 0.6 + rand() * 0.5) / (n + 1)));
  if (variant === 'color') {
    const target = rand() < 0.5 ? 'blue' : 'purple';
    const decoyColors = ['green', 'yellow', 'orange', 'white', target === 'blue' ? 'purple' : 'blue'];
    const cues = [{ t: tOpen, show: 'red' }];
    decoyTimes(span > 5500 ? 3 : 2).forEach((t, i) => {
      // el primer despiste es casi siempre el verde: el que pulsa por costumbre, cae
      const show = i === 0 && rand() < 0.75 ? 'green' : decoyColors[Math.floor(rand() * decoyColors.length)];
      cues.push({ t, show }, { t: t + 650, show: 'red' });
    });
    cues.push({ t: tGreen, show: target });
    return { cues, target, rule: `Pulsa SOLO cuando salga el ${REFLEX_COLORS[target]}` };
  }
  if (variant === 'spider') {
    const cues = [{ t: tOpen, show: 'spider' }];
    for (const t of decoyTimes(span > 5500 ? 2 : 1)) cues.push({ t, show: 'peek' }, { t: t + 700, show: 'spider' });
    cues.push({ t: tGreen, show: 'clear' });
    return { cues, target: 'clear', rule: '¡No pulses mientras esté la araña! Cuando se vaya, pulsa' };
  }
  return { cues: [{ t: tOpen, show: 'red' }, { t: tGreen, show: 'green' }], target: 'green', rule: 'Pulsa cuando se ponga en VERDE' };
}

/** Qué se ve en el instante t (antes de abrir: null). */
export function cueAt(cues, t) {
  let current = null;
  for (const c of cues ?? []) if (c.t <= t) current = c.show;
  return current;
}
