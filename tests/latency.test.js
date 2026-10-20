import { describe, expect, it } from 'vitest';
import { RttTracker, median } from '../src/core/latency.js';

describe('latencia', () => {
  it('mediana de pares e impares', () => {
    expect(median([])).toBeNull();
    expect(median([5])).toBe(5);
    expect(median([9, 1, 5])).toBe(5);
    expect(median([1, 2, 3, 10])).toBe(2.5);
  });

  it('solo recuerda las últimas N muestras y descarta valores absurdos', () => {
    const t = new RttTracker(3);
    for (const v of [100, 100, 100, 10, 12, 11]) t.add(v);
    expect(t.median()).toBe(11);
    t.add(-1);
    t.add(NaN);
    expect(t.samples).toEqual([10, 12, 11]);
  });

  it('un pico aislado no cambia la mediana', () => {
    const t = new RttTracker(5);
    for (const v of [20, 22, 400, 21, 23]) t.add(v);
    expect(t.median()).toBe(22);
  });
});
