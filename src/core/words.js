// Palabras secretas (Mímica, Tabú, Descríbelo, Tararéalo): por turnos, uno hace adivinar palabras a su equipo
// durante N segundos. Lógica pura: el mazo de tarjetas y el turno.
//
//   ready ─(¡Empezar!)─▶ running (cuenta atrás; cada tarjeta: acertada / pasar / falta) ─(se acaba el tiempo)─▶ done
//
// Acertada suma; pasar y falta (dijo una prohibida, habló en la mímica…) no suman y sale la siguiente tarjeta.

export const WPHASE = { READY: 'ready', RUNNING: 'running', DONE: 'done' };
export const WORD_RESULTS = new Set(['ok', 'pass', 'foul']);

/** Mazo de una sección: las tarjetas en un orden al azar; al acabarse, se vuelve a barajar. */
export class WordDeck {
  constructor(cards, { rng = Math.random, saved = null } = {}) {
    this.cards = cards;
    this.rng = rng;
    this.order = saved?.order?.length === cards.length ? saved.order : this.#shuffle();
    this.cursor = saved?.cursor ?? 0;
  }

  /** Siguiente tarjeta (índice en `cards`). */
  draw() {
    if (this.cursor >= this.order.length) {
      this.order = this.#shuffle();
      this.cursor = 0;
    }
    return this.order[this.cursor++];
  }

  /** Devuelve la última tarjeta sacada (deshacer). */
  putBack() {
    if (this.cursor > 0) this.cursor--;
  }

  toJSON() {
    return { order: this.order, cursor: this.cursor };
  }

  #shuffle() {
    const order = this.cards.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    return order;
  }
}

export class WordsRound {
  /**
   * @param deck WordDeck de la sección (compartido entre turnos: no se repiten palabras hasta acabar el mazo)
   * @param seconds duración del turno
   */
  constructor(deck, { roundId, seconds = 60 }) {
    this.deck = deck;
    this.roundId = roundId;
    this.seconds = seconds;
    this.phase = WPHASE.READY;
    this.endsAt = null;
    this.current = null; // índice de la tarjeta que se está haciendo
    this.results = []; // [{card, result: ok|pass|foul}]
  }

  get card() {
    return this.current == null ? null : this.deck.cards[this.current];
  }

  get score() {
    return this.results.filter((r) => r.result === 'ok').length;
  }

  start(now) {
    if (this.phase !== WPHASE.READY) return false;
    this.phase = WPHASE.RUNNING;
    this.endsAt = now + this.seconds * 1000;
    this.current = this.deck.draw();
    return true;
  }

  /** Acertada, pasar o falta: se apunta la tarjeta actual y sale otra. */
  mark(result, now) {
    if (this.phase !== WPHASE.RUNNING || !WORD_RESULTS.has(result) || this.current == null) return false;
    this.results.push({ card: this.current, result });
    this.current = now < this.endsAt ? this.deck.draw() : null;
    return true;
  }

  /** Deshace la última marca (p. ej. una falta mal pitada): esa tarjeta vuelve a estar en juego. */
  undo() {
    const last = this.results.pop();
    if (!last) return false;
    if (this.current != null) this.deck.putBack();
    this.current = last.card;
    if (this.phase === WPHASE.DONE) this.phase = WPHASE.RUNNING; // se puede corregir al final: se vuelve a cerrar
    return true;
  }

  /** Se acabó el tiempo (o el presentador lo para): la tarjeta a medias no cuenta. */
  finish() {
    if (this.phase !== WPHASE.RUNNING) return false;
    this.phase = WPHASE.DONE;
    this.current = null;
    return true;
  }

  toJSON() {
    return { roundId: this.roundId, seconds: this.seconds, phase: this.phase, results: this.results };
  }

  /** Un turno ya jugado (para verlo otra vez al volver a él). */
  static fromJSON(deck, data) {
    const r = new WordsRound(deck, { roundId: data.roundId, seconds: data.seconds });
    r.phase = WPHASE.DONE;
    r.results = data.results ?? [];
    return r;
  }
}
