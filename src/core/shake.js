// Agita el móvil: todos a la vez durante N segundos; gana quien más lo agite. El móvil mide (acelerómetro) y manda su
// total cada poco; la tele enseña la carrera en directo y al final reparte puntos por puestos. Lógica pura.
//
//   ready ─(¡Empezar!: cuenta atrás)─▶ running (hasta tOpen + segundos) ─▶ done

export const SPHASE = { READY: 'ready', RUNNING: 'running', DONE: 'done' };
const GRACE_MS = 600; // lo que llega justo después del final (viaje por la red) aún cuenta

export class ShakeRound {
  constructor({ roundId, seconds = 10 }) {
    this.roundId = roundId;
    this.seconds = seconds;
    this.phase = SPHASE.READY;
    this.tOpen = null;
    this.endsAt = null;
    this.totals = {}; // playerId → cuánto ha agitado (unidades del móvil; solo sube)
  }

  start(now, countdownMs = 3000) {
    if (this.phase !== SPHASE.READY) return false;
    this.phase = SPHASE.RUNNING;
    this.tOpen = now + countdownMs;
    this.endsAt = this.tOpen + this.seconds * 1000;
    return true;
  }

  /** El total que manda un móvil (lo que agitó desde que empezó). @returns ¿contó? */
  report(playerId, total, now) {
    if (this.phase !== SPHASE.RUNNING || !Number.isFinite(total) || total < 0) return false;
    if (now < this.tOpen - 300 || now > this.endsAt + GRACE_MS) return false;
    this.totals[playerId] = Math.max(this.totals[playerId] ?? 0, Math.round(total));
    return true;
  }

  finish() {
    if (this.phase !== SPHASE.RUNNING) return false;
    this.phase = SPHASE.DONE;
    return true;
  }

  /** Clasificación: de quien más a quien menos, con puestos (empates, mismo puesto). */
  ranking() {
    const rows = Object.entries(this.totals)
      .map(([playerId, total]) => ({ playerId, total }))
      .sort((a, b) => b.total - a.total);
    let place = 0;
    let last = null;
    for (const r of rows) {
      if (r.total !== last) place++;
      last = r.total;
      r.place = place;
    }
    return rows;
  }

  /** Puntos por puestos (los de la sección: 3,2,1…); quien no agitó nada no suma. */
  points(pointsList) {
    const out = {};
    for (const r of this.ranking()) {
      const pts = r.total > 0 ? (pointsList[r.place - 1] ?? 0) : 0;
      if (pts) out[r.playerId] = pts;
    }
    return out;
  }

  toJSON() {
    return { roundId: this.roundId, seconds: this.seconds, phase: this.phase, totals: this.totals };
  }

  static fromJSON(data) {
    const r = new ShakeRound({ roundId: data.roundId, seconds: data.seconds });
    r.phase = SPHASE.DONE;
    r.totals = data.totals ?? {};
    return r;
  }
}
