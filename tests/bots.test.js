import { describe, expect, it } from 'vitest';
import { botAnswer, botMillionaireChoice, botName, botPressAt, isBot, shuffle, teamFor } from '../src/core/bots.js';

/** Azar fijo para los tests: devuelve los valores dados uno tras otro (y vuelve a empezar). */
const seq = (...values) => {
  let i = 0;
  return () => values[i++ % values.length];
};

describe('concursantes de prueba', () => {
  it('nombres sin repetir y su id', () => {
    expect(botName([])).toBe('🤖 Lola');
    expect(botName(['🤖 Lola'])).toBe('🤖 Paco');
    expect(isBot('bot-1')).toBe(true);
    expect(isBot('abc')).toBe(false);
  });

  it('entran en el equipo con menos gente', () => {
    const teams = [{ id: 'r' }, { id: 'a' }];
    expect(teamFor(teams, [{ teamId: 'r' }])).toBe('a');
    expect(teamFor([], [])).toBe(null);
  });

  it('responden algo válido en cada tipo', () => {
    expect(botAnswer({ kind: 'verdad', options: ['V', 'M'], correct: 1 }, {}, seq(0.1))).toBe(1); // acierta
    expect(botAnswer({ kind: 'verdad', options: ['V', 'M'], correct: 1 }, {}, seq(0.9, 0.2))).toBe(0); // al azar
    expect(botAnswer({ kind: 'votacion' }, { selfId: 'me', candidates: ['me', 'x', 'y'] }, seq(0.99))).toBe('y');
    expect(botAnswer({ kind: 'estimacion', correct: 910 }, {}, seq(0))).toBe(455);
    expect(botAnswer({ kind: 'estimacion', correct: 7 }, {}, seq(1))).toBe(14);
  });

  it('pulsan a su hora en las secciones de tiempo', () => {
    expect(botPressAt({ question: { kind: 'contador', correct: 10 }, tOpen: 1000 }, seq(0.5))).toBe(11_000);
    const reflex = { question: { kind: 'reflejos' }, tOpen: 0, tGreen: 3000 };
    expect(botPressAt(reflex, seq(0.5, 0))).toBe(3180); // tras la señal
    expect(botPressAt(reflex, seq(0.01, 0.5))).toBe(1500); // antes de tiempo: eliminado
  });

  it('millonario: elige entre las que quedan', () => {
    expect(botMillionaireChoice({ correct: 2, count: 4, removed: [] }, seq(0.1))).toBe(2);
    expect(botMillionaireChoice({ correct: 2, count: 4, removed: [0, 3] }, seq(0.9, 0))).toBe(1);
  });

  it('mezcla sin perder a nadie', () => {
    expect(shuffle(seq(0.3, 0.7, 0.1), ['a', 'b', 'c', 'd']).sort()).toEqual(['a', 'b', 'c', 'd']);
  });
});
