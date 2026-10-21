import { describe, expect, it } from 'vitest';
import { FPHASE, FreeRound } from '../src/core/free.js';

const item = (tool, extra = {}) => ({ title: 'Prueba', description: '', tool, teams: false, points: 3, ...extra });

describe('sección Libre', () => {
  it('cronómetro: gana quien más aguanta; al caer el último se para solo', () => {
    const r = new FreeRound(item('stopwatch'), { roundId: 'f1' });
    expect(r.start(0)).toBe(false); // sin participantes
    r.setParticipants(['ana', 'bea', 'cris', 'ana']);
    expect(r.participants).toEqual(['ana', 'bea', 'cris']);
    expect(r.start(1000)).toBe(true);
    expect(r.setParticipants(['x'])).toBe(false); // ya ha empezado
    r.eliminate('bea', 21_000); // 20 s
    expect(r.eliminate('bea', 22_000)).toBe(false);
    expect(r.standing()).toEqual(['ana', 'cris']);
    expect(r.timeOf('ana', 31_000)).toBe(30_000); // sigue en pie
    r.eliminate('ana', 41_000); // 40 s
    expect(r.phase).toBe(FPHASE.RUNNING); // queda Cris
    r.eliminate('cris', 61_000); // 60 s: ya no queda nadie
    expect(r.phase).toBe(FPHASE.STOPPED);
    expect(r.ranking(99_000).map((x) => [x.id, x.value, x.place])).toEqual([
      ['cris', 60_000, 1],
      ['ana', 40_000, 2],
      ['bea', 20_000, 3],
    ]);
    expect(r.suggestion(99_000)).toEqual(['cris']);
  });

  it('cronómetro: deshacer un eliminado y parar a mano', () => {
    const r = new FreeRound(item('stopwatch'), { roundId: 'f1' });
    r.setParticipants(['ana', 'bea']);
    r.start(0);
    r.eliminate('ana', 5000);
    expect(r.revive('ana')).toBe(true);
    expect(r.standing()).toEqual(['ana', 'bea']);
    r.stop(9000);
    expect(r.timeOf('ana', 99_999)).toBe(9000); // parado: no sigue contando
    expect(r.suggestion(99_999)).toEqual(['ana', 'bea']); // empate
  });

  it('contador: ±1, nunca por debajo de 0; gana quien más hace', () => {
    const r = new FreeRound(item('counter'), { roundId: 'f2' });
    r.setParticipants(['ana', 'bea']);
    r.start(0);
    r.count('ana', 1);
    r.count('ana', 1);
    r.count('bea', -1);
    r.count('bea', 1);
    expect(r.count('cris', 1)).toBe(false);
    expect(r.counts).toEqual({ ana: 2, bea: 1 });
    expect(r.suggestion(0)).toEqual(['ana']);
  });

  it('contador a cero: no propone ganador', () => {
    const r = new FreeRound(item('counter'), { roundId: 'f2' });
    r.setParticipants(['ana']);
    r.start(0);
    expect(r.suggestion(0)).toEqual([]);
  });

  it('sin herramienta: se elige ganador directamente', () => {
    const r = new FreeRound(item('none', { points: 5 }), { roundId: 'f3' });
    r.setParticipants(['rojos', 'azules']);
    expect(r.start(0)).toBe(false);
    expect(r.award(['azules', 'verdes'], 0)).toEqual({ azules: 5 });
    expect(r.phase).toBe(FPHASE.AWARDED);
    expect(r.award(['rojos'], 0)).toBeNull(); // ya dados
  });

  it('dar puntos para el cronómetro si sigue corriendo; sin ganadores no hay puntos', () => {
    const r = new FreeRound(item('stopwatch'), { roundId: 'f4' });
    r.setParticipants(['ana']);
    r.start(0);
    expect(r.award([], 1000)).toBeNull();
    expect(r.phase).toBe(FPHASE.RUNNING); // sin ganadores no se toca nada
    expect(r.award(['ana'], 2000)).toEqual({ ana: 3 });
    expect(r.tStop).toBe(2000); // dar los puntos para el cronómetro
  });

  it('se guarda y se recupera', () => {
    const r = new FreeRound(item('counter'), { roundId: 'f5' });
    r.setParticipants(['ana', 'bea']);
    r.start(0);
    r.count('bea', 1);
    r.award(['bea'], 10);
    const back = FreeRound.fromJSON(item('counter'), JSON.parse(JSON.stringify(r.toJSON())));
    expect(back.phase).toBe(FPHASE.AWARDED);
    expect(back.points).toEqual({ bea: 3 });
    expect(back.counts).toEqual({ ana: 0, bea: 1 });
  });
});
