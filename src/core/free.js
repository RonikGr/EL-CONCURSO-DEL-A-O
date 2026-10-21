// Sección Libre ("Fit o Fat"): pruebas fuera del móvil que arbitra el presentador. Lógica pura.
//
//   setup ──start──▶ running ──stop──▶ stopped ──award──▶ awarded
//     └───────────────(sin herramienta: award directo)──────────┘
//
// Herramientas: cronómetro (el presentador marca "eliminado" a quien cae; gana quien más aguanta),
// contador (+1/−1 por participante; gana quien más hace) o ninguna (el presentador elige ganador).
// Participan jugadores o equipos según la fila de la hoja.

export const FPHASE = { SETUP: 'setup', RUNNING: 'running', STOPPED: 'stopped', AWARDED: 'awarded' };
export const TOOL = { NONE: 'none', STOPWATCH: 'stopwatch', COUNTER: 'counter' };

export class FreeRound {
  /** @param item fila de la hoja: {title, description, tool, teams, points} */
  constructor(item, { roundId }) {
    this.item = item;
    this.roundId = roundId;
    this.phase = FPHASE.SETUP;
    this.participants = []; // ids de jugador o de equipo
    this.tStart = null;
    this.tStop = null;
    this.out = {}; // cronómetro: id → ms aguantados al caer
    this.counts = {}; // contador: id → número
    this.winners = [];
    this.points = {}; // id → puntos dados
  }

  get tool() {
    return this.item.tool;
  }

  get byTeams() {
    return !!this.item.teams;
  }

  /** Solo antes de empezar. */
  setParticipants(ids) {
    if (this.phase !== FPHASE.SETUP) return false;
    this.participants = [...new Set(ids)];
    return true;
  }

  start(now) {
    if (this.phase !== FPHASE.SETUP || this.tool === TOOL.NONE || !this.participants.length) return false;
    this.phase = FPHASE.RUNNING;
    this.tStart = now;
    this.counts = Object.fromEntries(this.participants.map((id) => [id, 0]));
    return true;
  }

  /** Cronómetro: alguien cae. Si solo queda uno en pie, la prueba se para sola. */
  eliminate(id, now) {
    if (this.phase !== FPHASE.RUNNING || this.tool !== TOOL.STOPWATCH) return false;
    if (!this.participants.includes(id) || id in this.out) return false;
    this.out[id] = now - this.tStart;
    if (this.standing().length === 0) this.stop(now);
    return true;
  }

  /** Deshacer un "eliminado" por error (mientras corre el cronómetro). */
  revive(id) {
    if (this.phase !== FPHASE.RUNNING || !(id in this.out)) return false;
    delete this.out[id];
    return true;
  }

  /** Quienes siguen en pie (cronómetro). */
  standing() {
    return this.participants.filter((id) => !(id in this.out));
  }

  count(id, delta) {
    if (this.phase !== FPHASE.RUNNING || this.tool !== TOOL.COUNTER || !this.participants.includes(id)) return false;
    this.counts[id] = Math.max(0, (this.counts[id] ?? 0) + delta);
    return true;
  }

  stop(now) {
    if (this.phase !== FPHASE.RUNNING) return false;
    this.phase = FPHASE.STOPPED;
    this.tStop = now;
    return true;
  }

  /** Tiempo aguantado por cada uno (los que siguen en pie, hasta ahora o hasta que se paró). */
  timeOf(id, now) {
    if (id in this.out) return this.out[id];
    if (this.tStart == null) return 0;
    return (this.tStop ?? now) - this.tStart;
  }

  /** Clasificación según la herramienta: [{id, value, place}] (mejor primero; empates comparten puesto). */
  ranking(now) {
    if (this.tool === TOOL.NONE) return this.participants.map((id) => ({ id, value: null, place: null }));
    const value = (id) => (this.tool === TOOL.STOPWATCH ? this.timeOf(id, now) : (this.counts[id] ?? 0));
    const rows = this.participants.map((id) => ({ id, value: value(id) })).sort((a, b) => b.value - a.value);
    let place = 0;
    let last = null;
    for (const r of rows) {
      if (r.value !== last) {
        place++;
        last = r.value;
      }
      r.place = place;
    }
    return rows;
  }

  /** Ganadores que propone la herramienta (el presentador puede cambiarlos). */
  suggestion(now) {
    if (this.tool === TOOL.NONE) return [];
    const rows = this.ranking(now);
    if (!rows.length || (this.tool === TOOL.COUNTER && rows[0].value === 0)) return [];
    return rows.filter((r) => r.place === 1).map((r) => r.id);
  }

  /**
   * Da los puntos de la prueba a los ganadores.
   * @returns {id: puntos} o null si no procede
   */
  award(winnerIds, now) {
    if (this.phase === FPHASE.AWARDED) return null;
    const winners = winnerIds.filter((id) => this.participants.includes(id));
    if (!winners.length) return null;
    if (this.phase === FPHASE.RUNNING) this.stop(now);
    this.winners = winners;
    this.points = Object.fromEntries(winners.map((id) => [id, this.item.points]));
    this.phase = FPHASE.AWARDED;
    return this.points;
  }

  toJSON() {
    const { roundId, phase, participants, tStart, tStop, out, counts, winners, points } = this;
    return { roundId, phase, participants, tStart, tStop, out, counts, winners, points };
  }

  static fromJSON(item, data) {
    const r = new FreeRound(item, { roundId: data.roundId });
    Object.assign(r, { ...data });
    return r;
  }
}
