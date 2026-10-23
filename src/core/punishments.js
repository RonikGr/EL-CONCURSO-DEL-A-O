// Castigos para quien pierda: al empezar el concurso, cada uno vota en su móvil hasta 3 de la lista de la hoja; pasan
// los 3 más votados. En el final, una ruleta elige uno de esos 3 al azar. Lógica pura.

export const PICKS = 3; // votos por persona y castigos que pasan a la ruleta

export class PunishmentVote {
  /** @param options los castigos de la hoja (textos) */
  constructor(options, saved = null) {
    this.options = options;
    this.votes = saved?.votes ?? {}; // playerId → [índices] (hasta 3)
    this.closed = saved?.closed ?? false;
    this.finalists = saved?.finalists ?? null; // los 3 que van a la ruleta (índices)
    // {index, at}: lo que salió en la ruleta. Guardado: `at` era del reloj de la página anterior (empieza de 0 al
    // recargar), así que se da por girada hace mucho: se enseña parada, sin volver a girar.
    this.spin = saved?.spin ? { index: saved.spin.index, at: -1e9 } : null;
  }

  /** Marca o desmarca un castigo (como mucho 3 por persona). @returns 'ok' | 'full' | 'closed' | 'invalid' */
  toggle(playerId, index) {
    if (this.closed) return 'closed';
    if (!Number.isInteger(index) || index < 0 || index >= this.options.length) return 'invalid';
    const mine = this.votes[playerId] ?? [];
    if (mine.includes(index)) this.votes[playerId] = mine.filter((i) => i !== index);
    else if (mine.length >= PICKS) return 'full';
    else this.votes[playerId] = [...mine, index];
    return 'ok';
  }

  /** Votos de cada castigo. */
  tally() {
    const counts = this.options.map(() => 0);
    for (const list of Object.values(this.votes)) for (const i of list) counts[i]++;
    return counts;
  }

  /** Cierra la votación: los 3 más votados (los empates, a suertes). */
  close(rng = Math.random) {
    if (this.closed) return false;
    const counts = this.tally();
    const order = this.options.map((_, i) => ({ i, n: counts[i], r: rng() })).sort((a, b) => b.n - a.n || a.r - b.r);
    this.finalists = order.slice(0, Math.min(PICKS, this.options.length)).map((o) => o.i);
    this.closed = true;
    return true;
  }

  /** La ruleta: uno de los finalistas al azar. */
  spinWheel(now, rng = Math.random) {
    if (!this.closed || !this.finalists?.length) return null;
    this.spin = { index: this.finalists[Math.floor(rng() * this.finalists.length)], at: now };
    return this.spin.index;
  }

  /** Volver a abrir la votación (borra lo votado y la ruleta). */
  reset() {
    this.votes = {};
    this.closed = false;
    this.finalists = null;
    this.spin = null;
  }

  toJSON() {
    return { votes: this.votes, closed: this.closed, finalists: this.finalists, spin: this.spin };
  }
}
