// Secciones en las que todos responden a la vez desde el móvil: Test, Verdad o mentira, Dos verdades y una
// mentira, ¿Quién es más probable…? y Estimación. Lógica pura: el tiempo y el azar entran como parámetros.
//
//   ready ──open──▶ open ──(tiempo o todos han respondido)──▶ closed ──reveal──▶ revealed
//
// La primera respuesta es la definitiva. Una respuesta vale si se dio (reloj sincronizado) antes del final.
import { norm } from './show.js';

export const ANSWER_TYPES = new Set(['test', 'verdad', 'dosVerdades', 'votacion', 'estimacion']);
export const APHASE = { READY: 'ready', OPEN: 'open', CLOSED: 'closed', REVEALED: 'revealed' };
export const ANSWER_RESULT = {
  OK: 'ok',
  CLOSED: 'closed',
  DUPLICATE: 'duplicate',
  NOT_ELIGIBLE: 'not-eligible',
  INVALID: 'invalid',
  LATE: 'late',
};
export const JOKERS = ['fifty', 'double', 'audience'];

const CHOICE_KINDS = new Set(['test', 'verdad', 'dosVerdades']);
export const isChoice = (kind) => CHOICE_KINDS.has(kind);

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
    this.eligible = new Set();
    this.candidates = []; // votación: a quién se puede votar
    this.answers = new Map(); // playerId → {value, tPress, tArrival}
    this.jokers = new Map(); // ownerId → Set(kind) comodines activos en esta pregunta
    this.removed = new Map(); // ownerId → [índices de opciones quitadas por el 50 %]
    this.results = null;
  }

  /**
   * @param eligibleIds jugadores conectados al abrir (el protagonista de "Dos verdades" no responde)
   */
  open({ now, eligibleIds, scheduledOpenMs = 300 }) {
    if (this.phase !== APHASE.READY) return false;
    this.eligible = new Set(eligibleIds.filter((id) => id !== this.question.subjectId));
    if (this.question.kind === 'votacion') this.candidates = [...eligibleIds];
    this.tOpen = now + scheduledOpenMs;
    this.deadline = this.tOpen + this.question.seconds * 1000;
    this.phase = APHASE.OPEN;
    return true;
  }

  answer(playerId, value, { tPress }) {
    if (this.phase !== APHASE.OPEN) return ANSWER_RESULT.CLOSED;
    if (!this.eligible.has(playerId)) return ANSWER_RESULT.NOT_ELIGIBLE;
    if (this.answers.has(playerId)) return ANSWER_RESULT.DUPLICATE;
    if (tPress > this.deadline) return ANSWER_RESULT.LATE;
    if (!this.#valid(playerId, value)) return ANSWER_RESULT.INVALID;
    this.answers.set(playerId, { value, tPress });
    return ANSWER_RESULT.OK;
  }

  /** ¿Han respondido todos los que pueden y siguen conectados? */
  allAnswered(connectedIds) {
    const pending = [...this.eligible].filter((id) => connectedIds.has(id) && !this.answers.has(id));
    return this.eligible.size > 0 && pending.length === 0;
  }

  close() {
    if (this.phase !== APHASE.OPEN) return false;
    this.phase = APHASE.CLOSED;
    return true;
  }

  /** @param ownerOf playerId → dueño de sus comodines (su equipo, o él mismo si no hay equipos) */
  reveal({ ownerOf = (id) => id } = {}) {
    if (this.phase === APHASE.OPEN) this.close();
    if (this.phase !== APHASE.CLOSED) return false;
    this.results = scoreRound(this.question, this.answers, { doubled: this.doubledPlayers(ownerOf), candidates: this.candidates });
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

  // ---------- Comodines (solo en Test)

  /** Jugadores que han respondido con el comodín Doble activo (por su equipo o por sí mismos). */
  doubledPlayers(ownerOf = (id) => id) {
    return new Set([...this.answers.keys()].filter((id) => this.jokers.get(ownerOf(id))?.has('double')));
  }

  /** Comodines activos para un jugador en esta pregunta. */
  activeJokers(playerId, ownerOf = (id) => id) {
    return [...(this.jokers.get(ownerOf(playerId)) ?? [])];
  }

  /** Opciones que el 50 % le ha quitado a este jugador. */
  removedFor(playerId, ownerOf = (id) => id) {
    return this.removed.get(ownerOf(playerId)) ?? [];
  }

  /**
   * ¿Se puede usar ahora este comodín? (no comprueba cuántos le quedan: eso lo lleva JokerBank)
   * @returns null si se puede, o el motivo si no
   */
  jokerBlocker(ownerId, kind, playerId) {
    if (this.question.kind !== 'test') return 'Los comodines solo se usan en las preguntas de Test.';
    if (this.phase !== APHASE.OPEN) return 'Ahora no se pueden usar comodines.';
    if (!JOKERS.includes(kind)) return 'Comodín desconocido.';
    if (this.jokers.get(ownerId)?.has(kind)) return 'Ya está activo en esta pregunta.';
    if (this.answers.has(playerId)) return 'Ya has respondido.';
    if (kind === 'fifty' && this.question.options.length < 3) return 'Con dos respuestas no hay 50 %.';
    return null;
  }

  /** @param random () => [0,1) para elegir qué respuestas incorrectas quitar */
  activateJoker(ownerId, kind, random = Math.random) {
    if (!this.jokers.has(ownerId)) this.jokers.set(ownerId, new Set());
    this.jokers.get(ownerId).add(kind);
    if (kind === 'fifty') {
      const wrong = this.question.options.map((_, i) => i).filter((i) => i !== this.question.correct);
      const toRemove = Math.floor(this.question.options.length / 2);
      const removed = [];
      while (removed.length < toRemove) {
        const pick = wrong.splice(Math.floor(random() * wrong.length), 1)[0];
        removed.push(pick);
      }
      this.removed.set(ownerId, removed.sort((a, b) => a - b));
    }
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
 * @param doubled Set(playerId) con el comodín Doble
 * @returns {points: {playerId: puntos}, entries: [...], winners?: [candidatos]} — solo quien suma aparece en `points`
 */
export function scoreRound(question, answers, { doubled = new Set(), candidates = [] } = {}) {
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
      const pts = correct ? base * (doubled.has(id) ? 2 : 1) : 0;
      add(id, pts);
      if (!correct) fooled++;
      entries.push({ playerId: id, value, correct, points: pts, doubled: doubled.has(id) });
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

  // Estimación: por cercanía. "Sin pasarse": quien se pasa queda fuera. Empates comparten puesto y puntos.
  const list = [...answers].map(([id, { value }]) => ({
    playerId: id,
    value,
    diff: Math.abs(value - question.correct),
    over: question.noOver && value > question.correct,
  }));
  const valid = list.filter((e) => !e.over).sort((a, b) => a.diff - b.diff);
  let place = 0;
  let lastDiff = null;
  for (const e of valid) {
    if (e.diff !== lastDiff) {
      place++;
      lastDiff = e.diff;
    }
    e.place = place;
    e.points = question.points?.[place - 1] ?? 0;
    add(e.playerId, e.points);
  }
  const entries = [...valid, ...list.filter((e) => e.over).map((e) => ({ ...e, place: null, points: 0 }))];
  return { points, entries };
}

/**
 * Comodines que le quedan a cada dueño (equipo, o jugador si no hay equipos) para todo el concurso.
 */
export class JokerBank {
  constructor(allowance = { fifty: 1, double: 1, audience: 1 }, used = {}) {
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
