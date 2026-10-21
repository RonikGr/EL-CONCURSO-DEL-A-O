import { describe, expect, it } from 'vitest';
import { ClockSync, syncSample } from '../src/core/clockSync.js';

/** Generador pseudoaleatorio con semilla (resultados repetibles). */
function rng(seed) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
}

/**
 * Simula un intercambio: el reloj del host va `trueOffset` por delante del móvil.
 * `up`/`down` = retardo de ida y de vuelta; `proc` = lo que tarda el host en contestar.
 */
function exchange(tPlayer, trueOffset, up, down, proc = 0.2) {
  const t0 = tPlayer;
  const t1 = t0 + up + trueOffset;
  const t2 = t1 + proc;
  const t3 = t2 - trueOffset + down;
  return syncSample(t0, t1, t2, t3);
}

describe('muestra NTP', () => {
  it('con retardos simétricos el offset es exacto', () => {
    const s = exchange(1000, 5000, 20, 20);
    expect(s.offset).toBeCloseTo(5000, 9);
    expect(s.rtt).toBeCloseTo(40, 9);
  });

  it('con retardos asimétricos el error es como mucho rtt/2', () => {
    const s = exchange(1000, -300, 50, 10);
    expect(s.rtt).toBeCloseTo(60, 9);
    expect(Math.abs(s.offset - -300)).toBeLessThanOrEqual(s.rtt / 2);
    expect(s.offset).toBeCloseTo(-300 + 20, 9); // (up − down) / 2
  });

  it('descuenta el tiempo de proceso del host', () => {
    const s = exchange(0, 0, 10, 10, 7);
    expect(s.rtt).toBeCloseTo(20, 9);
  });
});

describe('ClockSync', () => {
  it('sin muestras no hay estimación', () => {
    expect(new ClockSync().estimate()).toBeNull();
  });

  it('se queda con las muestras de menor RTT e ignora las de una red congestionada', () => {
    const c = new ClockSync({ best: 3 });
    const trueOffset = 12345;
    // Muestras malas: mucho retardo y muy asimétrico.
    for (let i = 0; i < 6; i++) c.add(exchange(i * 100, trueOffset, 200 + i * 10, 5));
    // Muestras buenas.
    c.add(exchange(1000, trueOffset, 4, 5));
    c.add(exchange(1100, trueOffset, 5, 4));
    c.add(exchange(1200, trueOffset, 5, 5));
    const e = c.estimate(1300);
    expect(Math.abs(e.offset - trueOffset)).toBeLessThanOrEqual(1);
    expect(e.rtt).toBeCloseTo(9, 6); // 4 + 5: el tiempo de proceso del host no cuenta
    expect(e.err).toBeCloseTo(4.5, 6);
    expect(e.samples).toBe(9);
  });

  it('descarta muestras imposibles', () => {
    const c = new ClockSync();
    expect(c.add({ rtt: -1, offset: 0, at: 0 })).toBe(false);
    expect(c.add({ rtt: NaN, offset: 0, at: 0 })).toBe(false);
    expect(c.samples).toHaveLength(0);
  });

  it('olvida las muestras viejas y respeta el máximo', () => {
    const c = new ClockSync({ maxSamples: 5, maxAgeMs: 1000 });
    for (let i = 0; i < 8; i++) c.add(exchange(i, 0, 5, 5));
    expect(c.samples).toHaveLength(5);
    expect(c.estimate(10_000)).toBeNull();
    c.reset();
    expect(c.samples).toHaveLength(0);
  });

  it('simulación: wifi con jitter → error real dentro de la cota y por debajo de unos ms', () => {
    const rand = rng(42);
    for (const trueOffset of [-50_000, 0, 987_654.321]) {
      const c = new ClockSync();
      for (let i = 0; i < 10; i++) {
        // Retardo base 3–8 ms por sentido + picos ocasionales de hasta 150 ms.
        const up = 3 + rand() * 5 + (rand() < 0.2 ? rand() * 150 : 0);
        const down = 3 + rand() * 5 + (rand() < 0.2 ? rand() * 150 : 0);
        c.add(exchange(i * 60, trueOffset, up, down));
      }
      const e = c.estimate(600);
      const realError = Math.abs(e.offset - trueOffset);
      expect(realError).toBeLessThanOrEqual(e.err);
      expect(realError).toBeLessThan(3);
    }
  });

  it('simulación: 4G con subida más lenta que bajada → error sistemático acotado por err', () => {
    const rand = rng(7);
    const c = new ClockSync();
    const trueOffset = 1000;
    for (let i = 0; i < 10; i++) c.add(exchange(i * 60, trueOffset, 35 + rand() * 30, 20 + rand() * 20));
    const e = c.estimate(600);
    expect(Math.abs(e.offset - trueOffset)).toBeLessThanOrEqual(e.err);
  });
});
