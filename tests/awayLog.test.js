import { describe, expect, it } from 'vitest';
import { AwayLog } from '../src/core/awayLog.js';

describe('registro de salidas de la app', () => {
  it('cuenta cada salida, las de con pregunta y el tiempo fuera', () => {
    const log = new AwayLog();
    log.out('ana', 'Ana', { at: 1, where: 'Preparación' });
    log.back('ana', 'Ana', { at: 2, ms: 4000 });
    log.out('bea', 'Bea', { at: 3, where: 'Cultura · pregunta 2', inQuestion: true });
    log.back('bea', 'Bea', { at: 4, ms: 12_400, inQuestion: true, voided: true });
    log.out('ana', 'Ana', { at: 5 });
    expect(log.summary().map((p) => [p.name, p.count, p.inQuestion, p.totalMs])).toEqual([
      ['Bea', 1, 1, 12_400], // primero quien salió con pregunta
      ['Ana', 2, 0, 4000],
    ]);
    expect(log.recent(2).map((e) => [e.id, e.kind, e.name])).toEqual([
      [4, 'back', 'Bea'],
      [5, 'out', 'Ana'],
    ]);
    expect(log.events[3]).toMatchObject({ ms: 12_400, voided: true });
  });

  it('se guarda y se recupera (y se puede borrar)', () => {
    const log = new AwayLog();
    log.out('ana', 'Ana', { at: 1 });
    const copy = new AwayLog(JSON.parse(JSON.stringify(log.toJSON())));
    expect(copy.summary()[0].count).toBe(1);
    expect(copy.out('ana', 'Ana', { at: 2 }).id).toBe(2); // los ids siguen
    copy.reset();
    expect(copy.summary()).toEqual([]);
  });

  it('no guarda avisos sin fin', () => {
    const log = new AwayLog();
    for (let i = 0; i < 100; i++) log.out('ana', 'Ana', { at: i });
    expect(log.events).toHaveLength(60);
    expect(log.players.ana.count).toBe(100);
  });
});
