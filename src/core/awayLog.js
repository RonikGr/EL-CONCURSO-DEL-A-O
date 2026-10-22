// Registro de quién sale de la app del móvil (minimiza, cambia de app o de pestaña) en cualquier momento, para el
// mando del presentador: un aviso al salir y al volver, y el recuento por concursante. Lo de anular respuestas por
// salir con la pregunta abierta sigue en la sala (antitrampas); esto solo lleva la cuenta.

const MAX_EVENTS = 60;

export class AwayLog {
  /** @param saved lo que devolvió toJSON() (la tele lo guarda con la sala) */
  constructor(saved = null) {
    this.players = saved?.players ?? {}; // playerId → {name, count, inQuestion, totalMs, lastAt}
    this.events = saved?.events ?? []; // [{id, kind: out|back, playerId, name, at, where, inQuestion, ms?, voided?}]
    this.seq = saved?.seq ?? 0;
  }

  /**
   * Sale de la app.
   * @param where dónde estaba el concurso («Cultura general · pregunta 3», «Preparación»…)
   * @param inQuestion ¿había una pregunta en juego para él? (lo sospechoso)
   */
  out(playerId, name, { at, where = '', inQuestion = false }) {
    const p = (this.players[playerId] ??= { name, count: 0, inQuestion: 0, totalMs: 0, lastAt: null });
    p.name = name;
    p.count++;
    if (inQuestion) p.inQuestion++;
    p.lastAt = at;
    return this.#push({ kind: 'out', playerId, name, at, where, inQuestion });
  }

  /** Vuelve: cuánto estuvo fuera y si se le anuló la respuesta. */
  back(playerId, name, { at, ms, where = '', inQuestion = false, voided = false }) {
    const p = (this.players[playerId] ??= { name, count: 1, inQuestion: inQuestion ? 1 : 0, totalMs: 0, lastAt: at });
    p.totalMs += Math.max(0, Math.round(ms));
    return this.#push({ kind: 'back', playerId, name, at, where, inQuestion, ms: Math.round(ms), voided });
  }

  /** Recuento por concursante, de quien más ha salido a quien menos. */
  summary() {
    return Object.entries(this.players)
      .map(([playerId, p]) => ({ playerId, ...p }))
      .sort((a, b) => b.inQuestion - a.inQuestion || b.count - a.count || b.totalMs - a.totalMs);
  }

  /** Los últimos avisos (para el mando: enseña los que aún no ha visto). */
  recent(n = 10) {
    return this.events.slice(-n);
  }

  reset() {
    this.players = {};
    this.events = [];
  }

  toJSON() {
    return { players: this.players, events: this.events, seq: this.seq };
  }

  #push(event) {
    const e = { id: ++this.seq, ...event };
    this.events.push(e);
    if (this.events.length > MAX_EVENTS) this.events.splice(0, this.events.length - MAX_EVENTS);
    return e;
  }
}
