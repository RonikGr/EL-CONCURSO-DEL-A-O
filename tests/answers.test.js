import { describe, expect, it } from 'vitest';
import { ANSWER_RESULT, APHASE, AnswerRound, JokerBank, buildQuestion, scoreRound } from '../src/core/answers.js';

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

  it('revela y puntúa un Test con el comodín Doble', () => {
    const r = openRound('test', TEST, { points: [2] });
    r.activateJoker('ana', 'double');
    r.answer('ana', 1, at(2000));
    r.answer('bea', 1, at(2000));
    r.answer('cris', 0, at(2000));
    expect(r.counts()).toEqual([1, 2, 0, 0]);
    r.reveal();
    expect(r.phase).toBe(APHASE.REVEALED);
    expect(r.results.points).toEqual({ ana: 4, bea: 2 });
  });

  it('el Doble de un equipo vale para todos sus miembros', () => {
    const team = { ana: 'rojos', bea: 'rojos', cris: 'azules' };
    const ownerOf = (id) => team[id];
    const r = openRound('test', TEST);
    r.activateJoker('rojos', 'double');
    for (const id of IDS) r.answer(id, 1, at(2000));
    r.reveal({ ownerOf });
    expect(r.results.points).toEqual({ ana: 4, bea: 4, cris: 2 });
    expect(r.activeJokers('bea', ownerOf)).toEqual(['double']);
  });

  it('el 50 % quita la mitad de las respuestas, nunca la correcta', () => {
    for (let seed = 0; seed < 20; seed++) {
      const r = openRound('test', TEST);
      r.activateJoker('ana', 'fifty', () => seed / 20);
      const removed = r.removedFor('ana');
      expect(removed).toHaveLength(2);
      expect(removed).not.toContain(1);
    }
    const three = openRound('test', { ...TEST, options: ['a', 'b', 'c'], correct: 0 });
    three.activateJoker('ana', 'fifty', () => 0);
    expect(three.removedFor('ana')).toEqual([1]);
  });

  it('cuándo se puede usar un comodín', () => {
    const r = openRound('test', TEST);
    expect(r.jokerBlocker('ana', 'fifty', 'ana')).toBeNull();
    r.activateJoker('ana', 'fifty');
    expect(r.jokerBlocker('ana', 'fifty', 'ana')).toMatch(/activo/);
    r.answer('bea', 1, at(2000));
    expect(r.jokerBlocker('bea', 'double', 'bea')).toMatch(/respondido/);
    expect(r.jokerBlocker('cris', 'raro', 'cris')).toMatch(/desconocido/);
    const two = openRound('test', { ...TEST, options: ['a', 'b'], correct: 0 });
    expect(two.jokerBlocker('ana', 'fifty', 'ana')).toMatch(/50/);
    const vf = openRound('verdad', { statement: 'x', isTrue: true });
    expect(vf.jokerBlocker('ana', 'double', 'ana')).toMatch(/Test/);
    r.close();
    expect(r.jokerBlocker('cris', 'double', 'cris')).toMatch(/Ahora no/);
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
    const bank = new JokerBank({ fifty: 1, double: 1, audience: 2 });
    expect(bank.remaining('rojos')).toEqual({ fifty: 1, double: 1, audience: 2 });
    expect(bank.use('rojos', 'fifty')).toBe(true);
    expect(bank.use('rojos', 'fifty')).toBe(false);
    expect(bank.remaining('rojos').fifty).toBe(0);
    expect(bank.remaining('azules').fifty).toBe(1);
    bank.refund('rojos', 'fifty');
    expect(bank.remaining('rojos').fifty).toBe(1);
    const restored = new JokerBank({ fifty: 1, double: 1, audience: 2 }, JSON.parse(JSON.stringify(bank.toJSON())));
    expect(restored.remaining('rojos')).toEqual(bank.remaining('rojos'));
  });
});
