import { describe, expect, it } from 'vitest';
import { answererFor, normalizeOrder } from '../src/core/turns.js';

describe('secciones por turnos', () => {
  it('el orden del portavoz se completa con los que falten y quita a quien ya no está', () => {
    expect(normalizeOrder(['bea', 'ana'], ['ana', 'bea', 'cris'])).toEqual(['bea', 'ana', 'cris']);
    expect(normalizeOrder(['dani', 'bea', 'bea'], ['ana', 'bea'])).toEqual(['bea', 'ana']);
    expect(normalizeOrder(null, ['ana', 'bea'])).toEqual(['ana', 'bea']);
  });
  it('a cada pregunta le toca el siguiente; se vuelve a empezar y se salta a los desconectados', () => {
    const order = ['bea', 'ana', 'cris'];
    expect([0, 1, 2, 3, 4].map((k) => answererFor(order, k))).toEqual(['bea', 'ana', 'cris', 'bea', 'ana']);
    expect(answererFor(order, 1, (id) => id !== 'ana')).toBe('cris');
    expect(answererFor(order, 0, () => false)).toBeNull();
    expect(answererFor([], 0)).toBeNull();
  });
});
