// Sincroniza el reloj del móvil con el del presentador mientras hay conexión.
// Ráfaga de 10 muestras al conectar, mini-ráfagas de 4 cada 15 s y ráfaga completa al volver a primer plano.
import { ClockSync, syncSample } from '../core/clockSync.js';
import { MSG } from '../shared/protocol.js';

const FULL_BURST = 10;
const MINI_BURST = 4;
const SPACING_MS = 60;
const PERIOD_MS = 15_000;
const REPLY_TIMEOUT_MS = 2000;

export class SyncClient {
  #clock = new ClockSync();
  #pending = new Map(); // id → t0
  #nextId = 1;
  #timers = new Set();
  #periodic = null;
  #running = false;

  /** @param send (msg) => boolean */
  constructor({ send, onUpdate }) {
    this.send = send;
    this.onUpdate = onUpdate;
  }

  /** Al abrir conexión: el presentador puede ser otro (recargó), así que se empieza de cero. */
  start() {
    this.stop();
    this.#running = true;
    this.#clock.reset();
    this.burst(FULL_BURST);
    this.#periodic = setInterval(() => this.burst(MINI_BURST), PERIOD_MS);
  }

  stop() {
    this.#running = false;
    clearInterval(this.#periodic);
    for (const t of this.#timers) clearTimeout(t);
    this.#timers.clear();
    this.#pending.clear();
  }

  burst(n = FULL_BURST) {
    if (!this.#running) return;
    for (let i = 0; i < n; i++) this.#later(() => this.#ping(), i * SPACING_MS);
    // Informe al presentador cuando hayan vuelto las respuestas (para el modo depuración).
    this.#later(() => this.#report(), n * SPACING_MS + 500);
  }

  /** @param tRecv performance.now() en cuanto llegó el mensaje */
  handleReply(msg, tRecv) {
    const t0 = this.#pending.get(msg.id);
    if (t0 === undefined || t0 !== msg.t0) return;
    this.#pending.delete(msg.id);
    this.#clock.add(syncSample(msg.t0, msg.t1, msg.t2, tRecv));
    this.onUpdate?.(this.estimate());
  }

  /** {offset, err, rtt, samples} o null si aún no hay muestras. */
  estimate() {
    return this.#clock.estimate(performance.now());
  }

  /** Reloj local → reloj del presentador (null sin sincronizar). */
  toHost(tLocal) {
    const e = this.estimate();
    return e ? tLocal + e.offset : null;
  }

  /** Reloj del presentador → reloj local (null sin sincronizar). */
  toLocal(tHost) {
    const e = this.estimate();
    return e ? tHost - e.offset : null;
  }

  #ping() {
    if (!this.#running) return;
    const id = this.#nextId++;
    const t0 = performance.now();
    if (!this.send({ t: MSG.SYNC, id, t0 })) return;
    this.#pending.set(id, t0);
    this.#later(() => this.#pending.delete(id), REPLY_TIMEOUT_MS);
  }

  #report() {
    const e = this.estimate();
    if (e) this.send({ t: MSG.SYNC_REPORT, offset: e.offset, err: e.err, rtt: e.rtt, samples: e.samples });
  }

  #later(fn, ms) {
    const t = setTimeout(() => {
      this.#timers.delete(t);
      fn();
    }, ms);
    this.#timers.add(t);
  }
}
