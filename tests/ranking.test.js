import { describe, expect, it } from 'vitest';
import { compareBuzz, rankBuzzes } from '../src/core/ranking.js';

const b = (playerId, tPress, tArrival = tPress) => ({ playerId, tPress, tArrival });

describe('orden de pulsaciones', () => {
  it('ordena por instante de pulsación, no por llegada', () => {
    const r = rankBuzzes([b('lento', 100, 180), b('rapido', 120, 125)], { tOpen: 0 });
    expect(r.map((x) => x.playerId)).toEqual(['lento', 'rapido']);
    expect(r[1]).toMatchObject({ place: 2, deltaMs: 20, reactionMs: 120 });
  });

  it('desempata por llegada y luego por playerId', () => {
    expect(rankBuzzes([b('b', 100, 150), b('a', 100, 140)]).map((x) => x.playerId)).toEqual(['a', 'b']);
    expect(rankBuzzes([b('b', 100, 140), b('a', 100, 140)]).map((x) => x.playerId)).toEqual(['a', 'b']);
    expect(compareBuzz(b('a', 1), b('a', 1))).toBe(0);
  });

  it('marca casi empate por debajo del umbral respecto al ganador', () => {
    const r = rankBuzzes([b('a', 100), b('b', 129), b('c', 130), b('d', 400)], { nearTieMs: 30 });
    expect(r.map((x) => x.nearTie)).toEqual([false, true, false, false]);
  });

  it('un ganador ya declarado sigue primero aunque llegue una pulsación anterior', () => {
    const r = rankBuzzes([b('ganador', 100), b('tardon', 90, 400)], { winnerId: 'ganador', nearTieMs: 30 });
    expect(r.map((x) => x.playerId)).toEqual(['ganador', 'tardon']);
    expect(r[1]).toMatchObject({ deltaMs: -10, beatWinner: true, nearTie: true });
  });

  it('lista vacía', () => {
    expect(rankBuzzes([])).toEqual([]);
  });
});
