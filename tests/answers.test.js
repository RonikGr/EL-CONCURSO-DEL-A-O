import { describe, expect, it } from 'vitest';
import {
  ANSWER_RESULT,
  APHASE,
  AnswerRound,
  COUNTDOWN_MS,
  GREEN_MAX_MS,
  JokerBank,
  REACTION_LIMIT_MS,
  buildQuestion,
  cueAt,
  reflexDelayMs,
  reflexPlan,
  reflexVariant,
  scoreRound,
} from '../src/core/answers.js';

const section = (type, points = [2]) => ({ type, points });
const PLAYERS = [
  { id: 'ana', name: 'Ana' },
  { id: 'bea', name: 'Bea' },
  { id: 'cris', name: 'Cris' },
];
const IDS = PLAYERS.map((p) => p.id);

function openRound(type, item, { points, now = 1000 } = {}) {
  const q = buildQuestion(section(type, points), item, { players: PLAYERS, settings: { testSeconds: 20 } });
  const r = new AnswerRound(q, { roundId: 'r1' });
  r.open({ now, eligibleIds: IDS, scheduledOpenMs: 300 });
  return r;
}
const at = (t) => ({ tPress: t });
const TEST = { question: '¿2+2?', options: ['3', '4', '5', '6'], correct: 1, seconds: 10 };

describe('preguntas desde la hoja', () => {
  it('construye cada tipo', () => {
    const s = { testSeconds: 20 };
    expect(buildQuestion(section('test'), TEST, { settings: s })).toMatchObject({ kind: 'test', options: TEST.options, correct: 1, seconds: 10 });
    expect(buildQuestion(section('verdad'), { statement: 'x', isTrue: false }, { settings: s })).toMatchObject({ options: ['Verdad', 'Mentira'], correct: 1, seconds: 20 });
    expect(buildQuestion(section('dosVerdades'), { about: 'bea', statements: ['a', 'b', 'c'], lie: 2 }, { players: PLAYERS, settings: s })).toMatchObject({
      correct: 2,
      subjectId: 'bea', // sin distinguir mayúsculas
      subjectName: 'bea',
    });
    expect(buildQuestion(section('dosVerdades'), { about: 'Nadie', statements: ['a', 'b', 'c'], lie: 0 }, { players: PLAYERS }).subjectId).toBeNull();
    expect(buildQuestion(section('votacion'), { question: '¿Quién?' }, { settings: s })).toMatchObject({ options: null, correct: null });
    expect(buildQuestion(section('estimacion'), { question: '¿km?', answer: 910, unit: 'km', noOver: true }, { settings: s })).toMatchObject({
      correct: 910,
      unit: 'km',
      noOver: true,
      seconds: 30,
    });
  });
});

describe('ronda de respuestas', () => {
  it('abre con apertura programada y plazo', () => {
    const r = openRound('test', TEST);
    expect(r.phase).toBe(APHASE.OPEN);
    expect(r.tOpen).toBe(1300);
    expect(r.deadline).toBe(11300);
    expect(r.open({ now: 0, eligibleIds: IDS })).toBe(false);
  });

  it('la primera respuesta es la definitiva y debe darse a tiempo', () => {
    const r = openRound('test', TEST);
    expect(r.answer('ana', 1, at(2000))).toBe(ANSWER_RESULT.OK);
    expect(r.answer('ana', 2, at(2100))).toBe(ANSWER_RESULT.DUPLICATE);
    expect(r.answer('bea', 0, at(11301))).toBe(ANSWER_RESULT.LATE);
    expect(r.answer('bea', 9, at(2000))).toBe(ANSWER_RESULT.INVALID);
    expect(r.answer('bea', 1.5, at(2000))).toBe(ANSWER_RESULT.INVALID);
    expect(r.answer('nuevo', 1, at(2000))).toBe(ANSWER_RESULT.NOT_ELIGIBLE);
    r.close();
    expect(r.answer('bea', 0, at(3000))).toBe(ANSWER_RESULT.CLOSED);
  });

  it('sabe cuándo han respondido todos los conectados', () => {
    const r = openRound('test', TEST);
    r.answer('ana', 1, at(2000));
    r.answer('bea', 1, at(2000));
    expect(r.allAnswered(new Set(IDS))).toBe(false);
    expect(r.allAnswered(new Set(['ana', 'bea']))).toBe(true); // Cris se ha desconectado: no se le espera
  });

  it('Dos verdades: el protagonista no vota y gana un punto por cada engañado', () => {
    const r = openRound('dosVerdades', { about: 'Bea', statements: ['a', 'b', 'c'], lie: 2 }, { points: [1] });
    expect(r.answer('bea', 2, at(2000))).toBe(ANSWER_RESULT.NOT_ELIGIBLE);
    r.answer('ana', 0, at(2000)); // engañada
    r.answer('cris', 2, at(2000)); // acierta
    r.reveal();
    expect(r.results.points).toEqual({ cris: 1, bea: 1 });
    expect(r.results.fooled).toBe(1);
  });

  it('votación: no puedes votarte; puntúa quien vota con la mayoría (empates incluidos)', () => {
    const r = openRound('votacion', { question: '¿Quién?' }, { points: [1] });
    expect(r.candidates).toEqual(IDS);
    expect(r.answer('ana', 'ana', at(2000))).toBe(ANSWER_RESULT.INVALID);
    expect(r.answer('ana', 'nadie', at(2000))).toBe(ANSWER_RESULT.INVALID);
    r.answer('ana', 'bea', at(2000));
    r.answer('bea', 'cris', at(2000));
    r.answer('cris', 'bea', at(2000));
    expect(r.counts()).toEqual({ ana: 0, bea: 2, cris: 1 });
    r.reveal();
    expect(r.results.winners).toEqual(['bea']);
    expect(r.results.points).toEqual({ ana: 1, cris: 1 });

    const tie = scoreRound(r.question, new Map([['ana', { value: 'bea' }], ['bea', { value: 'ana' }]]), { candidates: IDS });
    expect(tie.winners).toEqual(['ana', 'bea']);
    expect(tie.points).toEqual({ ana: 1, bea: 1 });
  });

  it('estimación: por cercanía, con empates y "sin pasarse"', () => {
    const q = buildQuestion(section('estimacion', [3, 2, 1]), { question: '?', answer: 100 });
    const answers = new Map([
      ['ana', { value: 90 }],
      ['bea', { value: 110 }],
      ['cris', { value: 150 }],
      ['dani', { value: 99 }],
    ]);
    const res = scoreRound(q, answers);
    expect(res.entries.map((e) => [e.playerId, e.place, e.points])).toEqual([
      ['dani', 1, 3],
      ['ana', 2, 2],
      ['bea', 2, 2], // a la misma distancia que Ana
      ['cris', 3, 1],
    ]);
    const noOver = scoreRound({ ...q, noOver: true }, answers);
    expect(noOver.points).toEqual({ dani: 3, ana: 2 });
    expect(noOver.entries.find((e) => e.playerId === 'bea')).toMatchObject({ over: true, place: null, points: 0 });
  });

  it('estimación: solo números', () => {
    const r = openRound('estimacion', { question: '?', answer: 10 });
    expect(r.answer('ana', '10', at(2000))).toBe(ANSWER_RESULT.INVALID);
    expect(r.answer('ana', 10.5, at(2000))).toBe(ANSWER_RESULT.OK);
  });
});

describe('comodines del concurso', () => {
  it('cuenta los que quedan por dueño, y se pueden devolver', () => {
    const bank = new JokerBank({ fifty: 1, audience: 2, call: 1 });
    expect(bank.remaining('rojos')).toEqual({ fifty: 1, audience: 2, call: 1 });
    expect(bank.use('rojos', 'fifty')).toBe(true);
    expect(bank.use('rojos', 'fifty')).toBe(false);
    expect(bank.remaining('rojos').fifty).toBe(0);
    expect(bank.remaining('azules').fifty).toBe(1);
    bank.refund('rojos', 'fifty');
    expect(bank.remaining('rojos').fifty).toBe(1);
    const restored = new JokerBank({ fifty: 1, audience: 2, call: 1 }, JSON.parse(JSON.stringify(bank.toJSON())));
    expect(restored.remaining('rojos')).toEqual(bank.remaining('rojos'));
  });
});

describe('Parar el contador', () => {
  const item = { target: 10, mode: 'hide', hideAfter: 3 };

  it('el reloj arranca tras la cuenta atrás y cuenta el instante de la pulsación', () => {
    const q = buildQuestion(section('contador', [3, 2, 1]), item);
    expect(q).toMatchObject({ kind: 'contador', target: 10, mode: 'hide', hideAfter: 3, seconds: 20, unit: 's' });
    const r = new AnswerRound(q, { roundId: 'c1' });
    r.open({ now: 1000, eligibleIds: IDS });
    expect(r.tOpen).toBe(1000 + COUNTDOWN_MS);
    expect(r.deadline).toBe(r.tOpen + 20_000);
    // Pulsar en la cuenta atrás no cuenta: se puede volver a pulsar.
    expect(r.answer('ana', 0, at(r.tOpen - 100))).toBe(ANSWER_RESULT.EARLY);
    expect(r.answer('ana', 'lo que sea', at(r.tOpen + 9_950))).toBe(ANSWER_RESULT.OK);
    expect(r.answer('bea', 0, at(r.tOpen + 10_300))).toBe(ANSWER_RESULT.OK);
    expect(r.answer('cris', 0, at(r.tOpen + 12_000))).toBe(ANSWER_RESULT.OK);
    expect(r.answers.get('ana').value).toBeCloseTo(9.95, 9);
    expect(r.counts()).toBeNull();
    r.reveal();
    expect(r.results.entries.map((e) => [e.playerId, e.place, e.points])).toEqual([
      ['ana', 1, 3], // a 0,05 s
      ['bea', 2, 2], // a 0,3 s
      ['cris', 3, 1], // a 2 s
    ]);
  });
});

describe('Duelo de reflejos', () => {
  const roundOf = (eligibleIds = IDS) => {
    const q = buildQuestion(section('reflejos', [3, 2, 1]), { round: 2, rounds: 3, duel: false });
    const r = new AnswerRound(q, { roundId: 'x' });
    r.open({ now: 1000, eligibleIds, scheduledOpenMs: 300, greenDelayMs: 4000 });
    return r;
  };

  it('rojo y luego verde al azar; el plazo acaba poco después del verde', () => {
    const r = roundOf();
    expect(r.question).toMatchObject({ round: 2, rounds: 3 });
    expect(r.tOpen).toBe(1300);
    expect(r.tGreen).toBe(5300);
    expect(r.deadline).toBe(5300 + REACTION_LIMIT_MS);
  });

  it('pulsar en rojo elimina de la ronda; gana la reacción más rápida', () => {
    const r = roundOf();
    expect(r.answer('ana', 0, at(5000))).toBe(ANSWER_RESULT.EARLY); // en rojo
    expect(r.answer('ana', 0, at(5500))).toBe(ANSWER_RESULT.DUPLICATE); // ya está fuera
    expect(r.answer('bea', 0, at(5300 + 312))).toBe(ANSWER_RESULT.OK);
    expect(r.answer('cris', 0, at(5300 + 250))).toBe(ANSWER_RESULT.OK);
    expect(r.allAnswered(new Set(IDS))).toBe(true); // el eliminado cuenta como respondido
    r.reveal();
    expect(r.results.entries.map((e) => [e.playerId, e.value, e.place, e.points, e.early])).toEqual([
      ['cris', 250, 1, 3, false],
      ['bea', 312, 2, 2, false],
      ['ana', null, null, 0, true],
    ]);
    expect(r.results.points).toEqual({ cris: 3, bea: 2 });
  });

  it('en un duelo solo juegan los dos elegidos', () => {
    const r = roundOf(['ana', 'bea']);
    expect(r.answer('cris', 0, at(5400))).toBe(ANSWER_RESULT.NOT_ELIGIBLE);
  });
});

describe('cuenta atrás antes de responder', () => {
  it('retrasa la apertura y el plazo', () => {
    const q = buildQuestion(section('test'), TEST, { settings: { testSeconds: 20 } });
    const r = new AnswerRound(q, { roundId: 'r1' });
    r.open({ now: 1000, eligibleIds: IDS, scheduledOpenMs: 300, countdownMs: 3000 });
    expect(r.tOpen).toBe(4000);
    expect(r.deadline).toBe(14000);
  });
});

describe('Reflejos con despistes', () => {
  const seq = (values) => {
    let i = 0;
    return () => values[i++ % values.length];
  };
  it('la primera ronda es la clásica y las siguientes alternan color y araña', () => {
    expect([1, 2, 3, 4, 5].map((n) => reflexVariant(n))).toEqual(['green', 'color', 'spider', 'color', 'spider']);
  });
  it('color: despistes antes de la señal buena, que llega justo en tGreen', () => {
    const { cues, target, rule } = reflexPlan('color', 1000, 7000, seq([0.2, 0.5, 0.3, 0.9, 0.1]));
    expect(target).toBe('blue');
    expect(rule).toMatch(/AZUL/);
    expect(cues[0]).toEqual({ t: 1000, show: 'red' });
    expect(cues.at(-1)).toEqual({ t: 7000, show: 'blue' });
    expect(cues.slice(1, -1).every((c) => c.t > 1000 && c.t < 7000 && c.show !== 'blue')).toBe(true);
    expect(cues.map((c) => c.show)).toContain('green'); // el despiste más traicionero
    expect(cueAt(cues, 500)).toBeNull();
    expect(cueAt(cues, 7000)).toBe('blue');
  });
  it('araña: se asoma y vuelve; al irse, se puede pulsar', () => {
    const { cues, target } = reflexPlan('spider', 0, 6000, () => 0.5);
    expect(target).toBe('clear');
    expect(cues.map((c) => c.show)).toEqual(['spider', 'peek', 'spider', 'peek', 'spider', 'clear']);
    expect(cueAt(cues, 5999)).toBe('spider');
  });
  it('las rondas con despistes esperan más', () => {
    expect(reflexDelayMs('green', () => 1)).toBe(GREEN_MAX_MS);
    expect(reflexDelayMs('spider', () => 0)).toBe(4000);
  });
});

describe('antitrampas', () => {
  it('cuenta el tiempo fuera de la app solo mientras la pregunta estaba abierta y sin responder', () => {
    const r = openRound('test', TEST); // abierta en 1000
    expect(r.awayWhileOpen('ana', 0, 3000)).toBe(2000); // salió antes de abrir: cuenta desde que se abrió
    r.answer('bea', 1, at(1400));
    expect(r.awayWhileOpen('bea', 2000, 5000)).toBe(0); // ya había respondido
    expect(r.awayWhileOpen('cris', 1500, 2000)).toBe(500);
    r.close(1800);
    expect(r.awayWhileOpen('cris', 1500, 9000)).toBe(300); // hasta que se cerró
    expect(r.awayWhileOpen('nadie', 1500, 9000)).toBe(0);
  });

  it('anular deja sin respuesta y no puede volver a responder; perdonar lo deshace', () => {
    const r = openRound('test', TEST);
    r.answer('ana', 1, at(1400));
    expect(r.disqualify('ana')).toBe(true);
    expect(r.answers.has('ana')).toBe(false);
    expect(r.answer('ana', 1, at(1500))).toBe(ANSWER_RESULT.CHEAT);
    expect(r.allAnswered(new Set(['ana']))).toBe(true); // el anulado no se espera
    expect(r.forgive('ana')).toBe(true);
    expect(r.answer('ana', 1, at(1600))).toBe(ANSWER_RESULT.OK);
    r.disqualify('bea');
    r.reveal();
    expect(r.results.entries.map((e) => e.playerId)).toEqual(['ana']);
    expect(r.forgive('bea')).toBe(false); // ya revelada
  });
});
