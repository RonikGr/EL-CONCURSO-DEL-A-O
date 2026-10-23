// Agita el móvil en la sala (core/shake.js): el presentador da la salida, los móviles mandan cuánto han agitado y la
// tele enseña la carrera en directo. Al acabar, puntos por puestos (los de la sección: 3,2,1…).
import { SPHASE, ShakeRound } from '../../core/shake.js';

const COUNTDOWN_MS = 3000;
const LIVE_MS = 300; // cada cuánto se repinta la carrera (no con cada mensaje de cada móvil)

export class ShakeGame {
  type = 'agitar';
  round = null;
  #ctx;
  #timer = 0;
  #live = 0;

  constructor(ctx) {
    this.#ctx = ctx;
  }

  get #room() {
    return this.#ctx.room;
  }

  get inPlay() {
    const r = this.#room.runner;
    return r.screen === 'play' && r.section?.type === this.type && !r.peekScoreboard && !!this.round;
  }

  toJSON() {
    return null;
  }

  sync() {
    this.stop();
    const r = this.#room.runner;
    const key = r.playKey;
    if (!key || r.section?.type !== this.type || !r.item) {
      this.round = null;
      return;
    }
    const stored = this.#room.itemResults[key]?.shake;
    this.round = stored ? ShakeRound.fromJSON(stored) : new ShakeRound({ roundId: this.#ctx.roundId(key), seconds: r.item.seconds ?? 10 });
  }

  stop() {
    clearTimeout(this.#timer);
    clearTimeout(this.#live);
    this.#live = 0;
  }

  actions() {
    return {
      shakeStart: () => this.inPlay && this.#start(),
      shakeStop: () => this.inPlay && this.#finish(),
    };
  }

  /** Los móviles mandan su total cada poco: se apunta y la tele se repinta como mucho cada 300 ms. */
  onMessage(playerId, msg, ack) {
    if (!this.inPlay || msg.roundId !== this.round.roundId || msg.action !== 'total') return ack('closed');
    if (this.#room.benched(playerId)) return ack('not-eligible');
    const counted = this.round.report(playerId, Number(msg.value), this.#ctx.now());
    if (counted && !this.#live) {
      this.#live = setTimeout(() => {
        this.#live = 0;
        this.#ctx.changed({ persist: false });
      }, LIVE_MS);
    }
  }

  #start() {
    if (!this.round.start(this.#ctx.now(), COUNTDOWN_MS)) return false;
    const round = this.round;
    clearTimeout(this.#timer);
    // al acabar (y un poco más, para los últimos mensajes que viajan): puntos
    this.#timer = setTimeout(() => this.round === round && this.#finish() && this.#ctx.changed(), round.endsAt - this.#ctx.now() + 700);
    return true;
  }

  #finish() {
    const r = this.round;
    if (!r.finish()) return false;
    this.stop();
    const room = this.#room;
    const points = r.points(room.runner.section.points);
    for (const [id, pts] of Object.entries(points)) room.roster.adjustScore(id, pts);
    room.itemResults[room.runner.playKey] = { shake: r.toJSON(), points };
    return true;
  }

  restart() {
    const room = this.#room;
    const key = room.runner.playKey;
    for (const [id, pts] of Object.entries(room.itemResults[key]?.points ?? {})) room.roster.adjustScore(id, -pts);
    delete room.itemResults[key];
    this.round = null;
    this.sync();
    return true;
  }

  view() {
    const r = this.round;
    const room = this.#room;
    const now = this.#ctx.now();
    const ranking = r.ranking();
    const placeOf = Object.fromEntries(ranking.map((x) => [x.playerId, x.place]));
    const players = room.roster
      .list()
      .filter((p) => !room.benched(p.id))
      .map((p) => ({ ...this.#ctx.pub(p), total: r.totals[p.id] ?? 0, place: placeOf[p.id] ?? null }))
      .sort((a, b) => b.total - a.total);
    const teams = room.roster.teams.map((t) => ({ team: t, total: players.filter((p) => p.teamId === t.id).reduce((s, p) => s + p.total, 0) }));
    return {
      roundId: r.roundId,
      phase: r.phase,
      seconds: r.seconds,
      tOpen: r.tOpen,
      endsAt: r.endsAt,
      opensInMs: r.tOpen == null ? null : r.tOpen - now,
      endsInMs: r.endsAt == null ? null : r.endsAt - now,
      round: room.runner.itemIndex + 1,
      rounds: room.runner.itemCount,
      players,
      teams: teams.length ? teams : null,
      max: Math.max(1, ...players.map((p) => p.total)),
      points: r.phase === SPHASE.DONE ? (room.itemResults[room.runner.playKey]?.points ?? {}) : null,
    };
  }

  viewFor(player) {
    const v = this.view();
    const me = v.players.find((p) => p.id === player.id);
    return {
      roundId: v.roundId,
      phase: v.phase,
      seconds: v.seconds,
      opensInMs: v.opensInMs,
      endsInMs: v.endsInMs,
      total: me?.total ?? 0,
      place: me?.place ?? null,
      of: v.players.length,
      points: v.points?.[player.id] ?? null,
    };
  }
}
