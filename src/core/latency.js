// Latencia mostrada en la lista de jugadores: mediana de los últimos RTT del latido (robusta a picos).
export class RttTracker {
  constructor(size = 5) {
    this.size = size;
    this.samples = [];
  }

  add(rtt) {
    if (!Number.isFinite(rtt) || rtt < 0) return;
    this.samples.push(rtt);
    if (this.samples.length > this.size) this.samples.shift();
  }

  /** `null` si aún no hay muestras. */
  median() {
    return median(this.samples);
  }
}

export function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
