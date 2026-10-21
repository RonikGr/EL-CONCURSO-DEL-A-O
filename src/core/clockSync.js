// Sincronización de reloj tipo NTP entre el móvil y el presentador. Lógica pura.
//
//   móvil   t0 ──sync──▶            t3 ◀──syncReply──
//   host               t1 (llega)  t2 (sale)
//
//   rtt    = (t3 − t0) − (t2 − t1)        tiempo de ida y vuelta por la red
//   offset = ((t1 − t0) + (t2 − t3)) / 2  reloj del host − reloj del móvil
//
// Si la ida y la vuelta tardan lo mismo, el offset es exacto. Si no, el error es como mucho rtt/2,
// por eso nos quedamos con las muestras de menor RTT (las que menos han esperado en colas de la red).

export function syncSample(t0, t1, t2, t3) {
  return { rtt: t3 - t0 - (t2 - t1), offset: (t1 - t0 + (t2 - t3)) / 2, at: t3 };
}

export class ClockSync {
  constructor({ maxSamples = 24, maxAgeMs = 90_000, best = 3 } = {}) {
    this.maxSamples = maxSamples;
    this.maxAgeMs = maxAgeMs; // las muestras viejas se van: los relojes derivan (~1 ms por minuto)
    this.best = best;
    this.samples = [];
  }

  /** Tras reconectar: el presentador puede haber recargado y su reloj empieza de cero. */
  reset() {
    this.samples = [];
  }

  add(sample) {
    if (!Number.isFinite(sample.rtt) || !Number.isFinite(sample.offset) || sample.rtt < 0) return false;
    this.samples.push(sample);
    if (this.samples.length > this.maxSamples) this.samples.shift();
    return true;
  }

  /**
   * @returns {null | {offset, err, rtt, samples}} `err` = cota del error del offset (±ms).
   */
  estimate(now = Infinity) {
    const fresh = this.samples.filter((s) => now - s.at <= this.maxAgeMs);
    if (!fresh.length) return null;
    const best = [...fresh].sort((a, b) => a.rtt - b.rtt).slice(0, this.best);
    const offsets = best.map((s) => s.offset).sort((a, b) => a - b);
    const mid = offsets.length >> 1;
    const offset = offsets.length % 2 ? offsets[mid] : (offsets[mid - 1] + offsets[mid]) / 2;
    const rtt = best[0].rtt;
    return { offset, err: rtt / 2, rtt, samples: fresh.length };
  }
}
