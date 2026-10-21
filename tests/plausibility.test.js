import { describe, expect, it } from 'vitest';
import { MIN_MAX_LAG_MS, PRESS_SOURCE, resolvePressTime } from '../src/core/plausibility.js';

describe('instante de la pulsación', () => {
  it('traduce la marca del móvil al reloj del presentador', () => {
    const r = resolvePressTime({ tLocal: 500, offset: 10_000, err: 3, tArrival: 10_540, rtt: 80 });
    expect(r).toEqual({ tPress: 10_500, source: PRESS_SOURCE.SYNCED, claimed: 10_500 });
  });

  it('sin sincronización cuenta la llegada', () => {
    expect(resolvePressTime({ tLocal: 500, offset: undefined, tArrival: 9000 })).toMatchObject({
      tPress: 9000,
      source: PRESS_SOURCE.ARRIVAL,
    });
  });

  it('una marca un poco posterior a la llegada (error de sincronización) se deja en la llegada', () => {
    const r = resolvePressTime({ tLocal: 1005, offset: 0, err: 8, tArrival: 1000 });
    expect(r).toMatchObject({ tPress: 1000, source: PRESS_SOURCE.SYNCED });
  });

  it('una marca muy posterior a la llegada es imposible: se recorta a la llegada', () => {
    const r = resolvePressTime({ tLocal: 1100, offset: 0, err: 2, tArrival: 1000 });
    expect(r).toMatchObject({ tPress: 1000, source: PRESS_SOURCE.CLAMPED_FUTURE, claimed: 1100 });
  });

  it('una marca demasiado antigua (¿trampa?) se recorta', () => {
    const r = resolvePressTime({ tLocal: 0, offset: 0, tArrival: 5000, rtt: 40 });
    expect(r).toMatchObject({ tPress: 5000 - MIN_MAX_LAG_MS, source: PRESS_SOURCE.CLAMPED_EARLY });
  });

  it('con una red lenta el margen crece a 2×RTT', () => {
    const r = resolvePressTime({ tLocal: 4600, offset: 0, tArrival: 5000, rtt: 300 });
    expect(r).toMatchObject({ tPress: 4600, source: PRESS_SOURCE.SYNCED });
    expect(resolvePressTime({ tLocal: 4300, offset: 0, tArrival: 5000, rtt: 300 }).tPress).toBe(4400);
  });
});
