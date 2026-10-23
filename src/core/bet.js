// La gran apuesta (sección final): cada equipo (su portavoz; sin equipos, cada uno) apuesta parte de sus puntos, sale
// una pregunta de opciones y quien acierta gana lo apostado; quien falla (o no contesta), lo pierde. Lógica pura.
//
//   betting (apuestas ocultas) ─▶ question (eligen respuesta) ─▶ revealed (± lo apostado)

export const BPHASE = { BETTING: 'betting', QUESTION: 'question', REVEALED: 'revealed' };
export const MIN_MAX_BET = 5; // aunque vayas a 0 puntos, puedes apostar hasta 5

/** Lo máximo que puede apostar quien tiene `score` puntos. */
export const maxBet = (score) => Math.max(MIN_MAX_BET, Math.floor(score));

export class BetRound {
  /**
   * @param question {question, options, correct}
   * @param owners [{id, max}]: equipos (o jugadores) que apuestan y su tope
   */
  constructor(question, { roundId, owners }) {
    this.question = question;
    this.roundId = roundId;
    this.owners = owners;
    this.phase = BPHASE.BETTING;
    this.bets = {}; // owner → puntos apostados
    this.answers = {}; // owner → índice de respuesta
    this.results = null; // owner → ± puntos
  }

  #owner(id) {
    return this.owners.find((o) => o.id === id);
  }

  /** Apostar (se puede cambiar hasta que se cierren las apuestas). @returns la apuesta que queda, o null */
  bet(ownerId, amount) {
    const o = this.#owner(ownerId);
    if (this.phase !== BPHASE.BETTING || !o || !Number.isFinite(amount)) return null;
    this.bets[ownerId] = Math.max(0, Math.min(o.max, Math.round(amount)));
    return this.bets[ownerId];
  }

  get allBet() {
    return this.owners.every((o) => o.id in this.bets);
  }

  /** Se cierran las apuestas (quien no apostó, apuesta 0) y sale la pregunta. */
  close() {
    if (this.phase !== BPHASE.BETTING) return false;
    for (const o of this.owners) this.bets[o.id] ??= 0;
    this.phase = BPHASE.QUESTION;
    return true;
  }

  /** Elegir respuesta (se puede cambiar hasta revelar). */
  answer(ownerId, index) {
    if (this.phase !== BPHASE.QUESTION || !this.#owner(ownerId)) return false;
    if (!Number.isInteger(index) || index < 0 || index >= this.question.options.length) return false;
    this.answers[ownerId] = index;
    return true;
  }

  get allAnswered() {
    return this.owners.every((o) => o.id in this.answers);
  }

  reveal() {
    if (this.phase !== BPHASE.QUESTION) return false;
    this.results = Object.fromEntries(
      this.owners.map((o) => {
        const bet = this.bets[o.id] ?? 0;
        return [o.id, !bet ? 0 : this.answers[o.id] === this.question.correct ? bet : -bet];
      }),
    );
    this.phase = BPHASE.REVEALED;
    return true;
  }

  toJSON() {
    return { roundId: this.roundId, owners: this.owners, phase: this.phase, bets: this.bets, answers: this.answers, results: this.results };
  }

  static fromJSON(question, data) {
    const r = new BetRound(question, { roundId: data.roundId, owners: data.owners });
    Object.assign(r, { phase: data.phase, bets: data.bets ?? {}, answers: data.answers ?? {}, results: data.results ?? null });
    return r;
  }
}
