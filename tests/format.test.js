import { describe, expect, it } from 'vitest';
import { formatDeltaMs, formatDeltaSeconds, formatGap, formatSeconds, ordinal } from '../src/shared/format.js';

describe('formato de tiempos', () => {
  it('segundos con coma', () => {
    expect(formatSeconds(842)).toBe('0,842 s');
    expect(formatSeconds(12345.6, 1)).toBe('12,3 s');
    expect(formatSeconds(-5)).toBe('0,000 s');
  });

  it('diferencias con signo', () => {
    expect(formatDeltaSeconds(120)).toBe('+0,120 s');
    expect(formatDeltaSeconds(-10)).toBe('−0,010 s');
    expect(formatDeltaMs(45.4)).toBe('+45 ms');
    expect(formatDeltaMs(-3)).toBe('−3 ms');
    expect(ordinal(3)).toBe('3º');
  });

  it('distancia al objetivo: milisegundos por debajo de 1 s', () => {
    expect(formatGap(0.0234)).toBe('23 ms');
    expect(formatGap(-0.5)).toBe('500 ms');
    expect(formatGap(1.2345)).toBe('1,235 s');
  });
});
