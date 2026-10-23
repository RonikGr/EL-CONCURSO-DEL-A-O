import { describe, expect, it } from 'vitest';
import { SPHASE, ShakeRound } from '../src/core/shake.js';
import { BPHASE, BetRound, maxBet } from '../src/core/bet.js';

describe('agita el móvil', () => {
  it('cuenta solo mientras corre el tiempo y reparte por puestos', () => {
    const r = new ShakeRound({ roundId: 'a1', seconds: 10 });
    expect(r.report('ana', 50, 0)).toBe(false); // aún no ha empezado
    r.start(1000, 3000); // tOpen = 4000, final = 14000
    expect(r.report('ana', 10, 2000)).toBe(false); // en la cuenta atrás
    expect(r.report('ana', 120, 9000)).toBe(true);
    r.report('ana', 80, 9500); // un total menor no baja el que tenía
    r.report('bea', 300, 14_300); // justo tras el final: aún vale
    r.report('cris', 120, 13_000);
    expect(r.report('dani', 999, 20_000)).toBe(false); // tarde
    r.finish();
    expect(r.phase).toBe(SPHASE.DONE);
    expect(r.ranking().map((x) => [x.playerId, x.place])).toEqual([
      ['bea', 1],
      ['ana', 2],
      ['cris', 2], // empate
    ]);
    expect(r.points([3, 2, 1])).toEqual({ bea: 3, ana: 2, cris: 2 });
  });
});

describe('la gran apuesta', () => {
  const q = { question: '¿?', options: ['A', 'B', 'C', 'D'], correct: 2 };

  it('quien acierta gana lo apostado y quien falla o no contesta lo pierde', () => {
    const r = new BetRound(q, { roundId: 'b1', owners: [{ id: 'rojos', max: 12 }, { id: 'azules', max: 5 }, { id: 'verdes', max: 8 }] });
    expect(r.bet('rojos', 50)).toBe(12); // no más de lo que tiene
    expect(r.bet('azules', 3)).toBe(3);
    expect(r.answer('rojos', 2)).toBe(false); // aún apostando
    r.close();
    expect(r.bets.verdes).toBe(0); // no apostó: 0
    expect(r.bet('rojos', 1)).toBe(null); // ya no se cambia
    r.answer('rojos', 2);
    r.answer('azules', 0);
    r.reveal();
    expect(r.phase).toBe(BPHASE.REVEALED);
    expect(r.results).toEqual({ rojos: 12, azules: -3, verdes: 0 });
  });

  it('tope de apuesta: lo que tienes, y al menos 5', () => {
    expect([maxBet(0), maxBet(-4), maxBet(23)]).toEqual([5, 5, 23]);
  });
});
