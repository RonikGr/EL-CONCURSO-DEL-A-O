// La gran apuesta en la sala (core/bet.js): con equipos apuesta y responde el portavoz de cada uno (los puntos van al
// equipo); sin equipos, cada uno por su cuenta. Las apuestas no se ven en la tele hasta revelar.
import { BPHASE, BetRound, maxBet } from '../../core/bet.js';

export class BetGame {
  type = 'apuesta';
  round = null;
  #ctx;

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

  get #byTeams() {
    return this.#room.roster.teams.length > 0;
  }

  toJSON() {
    return null;
  }

  /** Quién apuesta: los equipos (con su marcador) o, sin equipos, cada jugador conectado. */
  #owners() {
    const room = this.#room;
    if (this.#byTeams) return room.roster.teamStandings().map((s) => ({ id: s.team.id, max: maxBet(s.score) }));
    return room.roster
      .list()
      .filter((p) => p.connected && !room.benched(p.id))
      .map((p) => ({ id: p.id, max: maxBet(p.score) }));
  }

  /** De qué «dueño» habla este jugador (y si puede apostar por él: con equipos, solo el portavoz). */
  #ownerOf(playerId) {
    const room = this.#room;
    const p = room.roster.get(playerId);
    if (!p) return null;
    if (!this.#byTeams) return { id: p.id, acts: true };
    if (!p.teamId) return null;
    return { id: p.teamId, acts: room.spokespersonOf(p.teamId) === playerId };
  }

  sync() {
    const r = this.#room.runner;
    const key = r.playKey;
    if (!key || r.section?.type !== this.type || !r.item) {
      this.round = null;
      return;
    }
    const stored = this.#room.itemResults[key]?.bet;
    this.round = stored ? BetRound.fromJSON(r.item, stored) : new BetRound(r.item, { roundId: this.#ctx.roundId(key), owners: this.#owners() });
  }

  stop() {}

  actions() {
    return {
      betClose: () => this.inPlay && this.round.close(),
      betReveal: () => this.inPlay && this.#reveal(),
      // el presentador también puede apostar o responder por un equipo (si el portavoz no puede)
      betSet: ({ owner, amount }) => this.inPlay && this.round.bet(String(owner), Number(amount)) != null,
      betAnswer: ({ owner, index }) => this.inPlay && this.round.answer(String(owner), Number(index)),
    };
  }

  onMessage(playerId, msg, ack) {
    if (!this.inPlay || msg.roundId !== this.round.roundId) return ack('closed');
    const owner = this.#ownerOf(playerId);
    if (!owner?.acts) return ack('not-eligible', this.#byTeams ? 'Apuesta y responde el portavoz de tu equipo.' : null);
    const ok = msg.action === 'bet' ? this.round.bet(owner.id, Number(msg.value)) != null : msg.action === 'answer' ? this.round.answer(owner.id, Number(msg.value)) : false;
    ack(ok ? 'ok' : 'closed');
    if (ok) this.#ctx.changed({ persist: false });
  }

  #reveal() {
    const r = this.round;
    if (!r.reveal()) return false;
    const room = this.#room;
    for (const [id, pts] of Object.entries(r.results)) {
      if (!pts) continue;
      if (this.#byTeams) room.roster.adjustTeamBonus(id, pts);
      else room.roster.adjustScore(id, pts);
    }
    room.itemResults[room.runner.playKey] = { bet: r.toJSON(), byTeams: this.#byTeams };
    return true;
  }

  restart() {
    const room = this.#room;
    const key = room.runner.playKey;
    const stored = room.itemResults[key];
    for (const [id, pts] of Object.entries(stored?.bet?.results ?? {})) {
      if (stored.byTeams) room.roster.adjustTeamBonus(id, -pts);
      else room.roster.adjustScore(id, -pts);
    }
    delete room.itemResults[key];
    this.round = null;
    this.sync();
    return true;
  }

  /** Nombre y color de un «dueño» (equipo o jugador). */
  #who(id) {
    const room = this.#room;
    const team = room.roster.teams.find((t) => t.id === id);
    if (team) return { id, name: team.name, color: team.color, isTeam: true };
    const p = room.roster.get(id);
    return p ? { ...this.#ctx.pub(p), isTeam: false } : { id, name: '¿?', color: null };
  }

  /** Tele y mando: las apuestas y respuestas de cada uno se ven al revelar (el mando las ve siempre). */
  view({ forControl = false } = {}) {
    const r = this.round;
    const q = r.question;
    const open = forControl || r.phase === BPHASE.REVEALED;
    return {
      roundId: r.roundId,
      phase: r.phase,
      question: r.phase === BPHASE.BETTING && !forControl ? null : q.question,
      options: r.phase === BPHASE.BETTING && !forControl ? null : q.options,
      correct: open && (forControl || r.phase === BPHASE.REVEALED) ? q.correct : null,
      owners: r.owners.map((o) => ({
        ...this.#who(o.id),
        max: o.max,
        hasBet: o.id in r.bets,
        bet: open ? (r.bets[o.id] ?? null) : null,
        hasAnswer: o.id in r.answers,
        answer: open ? (r.answers[o.id] ?? null) : null,
        result: r.results?.[o.id] ?? null,
        spokesperson: this.#byTeams ? (this.#room.roster.get(this.#room.spokespersonOf(o.id))?.name ?? null) : null,
      })),
      allBet: r.allBet,
      allAnswered: r.allAnswered,
      round: this.#room.runner.itemIndex + 1,
      rounds: this.#room.runner.itemCount,
    };
  }

  /** Móvil: lo suyo (su apuesta, su tope, su respuesta) y si le toca a él (portavoz). */
  viewFor(player) {
    const r = this.round;
    const owner = this.#ownerOf(player.id);
    const mine = owner && r.owners.find((o) => o.id === owner.id);
    return {
      roundId: r.roundId,
      phase: r.phase,
      acts: !!owner?.acts && !!mine,
      ownerName: owner ? this.#who(owner.id).name : null,
      spokesperson: this.#byTeams && player.teamId ? (this.#room.roster.get(this.#room.spokespersonOf(player.teamId))?.name ?? null) : null,
      max: mine?.max ?? 0,
      bet: mine ? (r.bets[mine.id] ?? null) : null,
      question: r.phase === BPHASE.BETTING ? null : r.question.question,
      options: r.phase === BPHASE.BETTING ? null : r.question.options,
      answer: mine ? (r.answers[mine.id] ?? null) : null,
      correct: r.phase === BPHASE.REVEALED ? r.question.correct : null,
      result: mine ? (r.results?.[mine.id] ?? null) : null,
    };
  }
}
