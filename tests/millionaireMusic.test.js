import { describe, expect, it } from 'vitest';
import { MILLIONAIRE_CUES, pruneCueOverrides, levelOf, millionaireCue, millionaireTrackFor, pointsForLevel, questionLevel, applyCueOverrides, cueFieldsOf, cueValue } from '../src/core/millionaireMusic.js';

const base = { sectionType: 'test', sectionIndex: 2, screen: 'play', itemIndex: 0, itemCount: 6, introRules: false };
const m = (over = {}) => ({ roundId: 'r1', phase: 'playing', used: [], audience: null, call: null, result: null, ...over });

describe('música del millonario', () => {
  it('reconoce las canciones por el nombre del archivo', () => {
    expect(millionaireTrackFor('Música pregunta fácil.mp3')).toBe('easy');
    expect(millionaireTrackFor('Música  pregunta difícil.mp3')).toBe('hard');
    expect(millionaireTrackFor('Música pregunta media.mp3')).toBe('medium');
    expect(millionaireTrackFor('Pregunta intermedia.mp3')).toBe('medium');
    expect(millionaireTrackFor('Tema principal programa.mp3')).toBe('theme');
    expect(millionaireTrackFor('Explicación de preguntas.mp3')).toBe('rules');
    expect(millionaireTrackFor('Preguntar al equipo.mp3')).toBe('audience');
    expect(millionaireTrackFor('Llamar a alguien.mp3')).toBe('call');
    expect(millionaireTrackFor('otra cosa.mp3')).toBe(null);
  });

  it('nivel por tercios', () => {
    expect([0, 1, 2, 3, 4, 5].map((i) => levelOf(i, 6))).toEqual(['easy', 'easy', 'medium', 'medium', 'hard', 'hard']);
    expect([0, 1, 2, 3].map((i) => levelOf(i, 4))).toEqual(['easy', 'easy', 'medium', 'hard']);
    expect(levelOf(0, 1)).toBe('easy');
  });

  it('dificultad de la hoja (o por tercios) y sus puntos', () => {
    expect(questionLevel({ level: 'hard' }, 0, 6)).toBe('hard');
    expect(questionLevel({ level: null }, 2, 6)).toBe('medium');
    expect(['easy', 'medium', 'hard'].map((l) => pointsForLevel([1, 3, 5], l))).toEqual([1, 3, 5]);
    expect(pointsForLevel([2], 'hard')).toBe(2);
    expect(pointsForLevel(undefined, 'easy')).toBe(1);
  });

  it('la música sigue la dificultad de la pregunta', () => {
    expect(millionaireCue({ ...base, itemIndex: 0, millionaire: m({ level: 'hard' }) }, 0).track).toBe('hard');
  });

  it('solo en secciones de Test', () => {
    expect(millionaireCue({ ...base, sectionType: 'buzzer', millionaire: m() }, 0)).toBe(null);
    expect(millionaireCue({ ...base, screen: 'scoreboard', millionaire: null }, 0)).toBe(null);
  });

  it('presentación: el tema; «Cómo se juega»: la explicación en bucle', () => {
    expect(millionaireCue({ ...base, screen: 'intro' }, 0)).toMatchObject({ track: 'theme', from: 0 });
    expect(millionaireCue({ ...base, screen: 'intro', introRules: true }, 0)).toMatchObject({ track: 'rules', loop: MILLIONAIRE_CUES.rules.loop });
  });

  it('pregunta → marcada → acierto / fallo', () => {
    const v = { ...base, itemIndex: 5 };
    const c = MILLIONAIRE_CUES.hard;
    expect(millionaireCue({ ...v, millionaire: m({ phase: 'ready' }) }, 0)).toMatchObject({ track: 'hard', from: 0, loop: c.loop });
    expect(millionaireCue({ ...v, millionaire: m({ phase: 'marked' }) }, 0)).toMatchObject({ track: 'hard', from: c.lock, loop: c.suspense });
    expect(millionaireCue({ ...v, millionaire: m({ phase: 'revealed', result: { correct: true } }) }, 0)).toMatchObject({ track: 'hard', from: c.reveal });
    expect(millionaireCue({ ...v, millionaire: m({ phase: 'revealed', result: { correct: false } }) }, 0)).toMatchObject({ track: null });
  });

  it('llamada: espera en bucle; con el «ya», el golpe final cae al acabar los 30 s', () => {
    const k = MILLIONAIRE_CUES.call;
    const waiting = millionaireCue({ ...base, millionaire: m({ used: ['call'], call: { state: 'waiting' } }) }, 0);
    expect(waiting).toMatchObject({ track: 'call', from: 0, loop: k.loop });
    const run = millionaireCue({ ...base, millionaire: m({ used: ['call'], call: { state: 'running', endsAt: 30_000 } }) }, 0);
    expect(run.from).toBeCloseTo(k.clockEnd - 30);
    expect(run.after).toMatchObject({ track: 'easy', from: MILLIONAIRE_CUES.easy.loop[0] }); // vuelve sin la intro
    // la tele se recarga a mitad: sigue en su punto
    expect(millionaireCue({ ...base, millionaire: m({ used: ['call'], call: { state: 'running', endsAt: 30_000 } }) }, 20_000).from).toBeCloseTo(k.clockEnd - 10);
    const done = millionaireCue({ ...base, millionaire: m({ used: ['call'], call: { state: 'done' } }) }, 0);
    expect(done.from).toBeCloseTo(k.clockEnd - 0.1);
  });

  it('público: el golpe cae al acabar la votación; anulado → colchón', () => {
    const k = MILLIONAIRE_CUES.audience;
    const voting = millionaireCue({ ...base, millionaire: m({ used: ['audience'], audience: { state: 'voting', endsAt: 15_000 } }) }, 0);
    expect(voting.from).toBeCloseTo(k.voteEnd - 15);
    const done = millionaireCue({ ...base, millionaire: m({ used: ['audience'], audience: { state: 'done', endsAt: 15_000 } }) }, 15_000);
    expect(done.key).toBe(voting.key); // la misma: la canción sigue
    expect(millionaireCue({ ...base, millionaire: m({ used: ['audience'], audience: { state: 'cancelled' } }) }, 0)).toMatchObject({ track: 'easy', from: MILLIONAIRE_CUES.easy.loop[0] });
  });

  it('manda el último comodín usado', () => {
    const v = { ...base, millionaire: m({ used: ['audience', 'fifty', 'call'], audience: { state: 'done', endsAt: 0 }, call: { state: 'waiting' } }) };
    expect(millionaireCue(v, 0).track).toBe('call');
  });

  it('los puntos de cada canción tienen sentido', () => {
    for (const [id, c] of Object.entries(MILLIONAIRE_CUES)) {
      if (c.loop) expect(c.loop[1] - c.loop[0], id).toBeGreaterThan(4);
      if (c.lock) expect(c.lock, id).toBeGreaterThan(c.loop[1]);
      if (c.suspense) expect(c.suspense[0], id).toBeGreaterThan(c.lock);
      if (c.reveal) expect(c.reveal, id).toBeGreaterThan(c.suspense[1]);
      if (c.end && c.clockEnd) expect(c.end, id).toBeGreaterThan(c.clockEnd);
      if (c.end && c.voteEnd) expect(c.end, id).toBeGreaterThan(c.voteEnd);
    }
  });

  it('los ajustes que ya son los de partida dejan de contar', () => {
    expect(pruneCueOverrides(MILLIONAIRE_CUES, { medium: { reveal: MILLIONAIRE_CUES.medium.reveal }, hard: { lock: 50, reveal: MILLIONAIRE_CUES.hard.reveal }, nada: { x: 1 } })).toEqual({
      hard: { lock: 50 },
    });
  });

  it('los tiempos se pueden ajustar a mano', () => {
    expect(cueFieldsOf('call')).toEqual(['loop.0', 'loop.1', 'clockEnd', 'end', 'gainDb']);
    expect(cueFieldsOf('theme')).toEqual(['end', 'gainDb']);
    const cues = applyCueOverrides(MILLIONAIRE_CUES, { hard: { lock: 52, 'suspense.1': 69 }, call: { clockEnd: 45.1, nada: 3 }, otra: { lock: 1 } });
    expect(cues.hard.lock).toBe(52);
    expect(cues.hard.suspense).toEqual([MILLIONAIRE_CUES.hard.suspense[0], 69]);
    expect(cueValue(cues.call, 'clockEnd')).toBe(45.1);
    expect(MILLIONAIRE_CUES.hard.lock).not.toBe(52); // los de partida no cambian
    // y la música los usa: con el reloj de la llamada movido, empieza 0,25 s más tarde
    const v = { ...base, millionaire: m({ used: ['call'], call: { state: 'running', endsAt: 30_000 } }) };
    expect(millionaireCue(v, 0, cues).from).toBeCloseTo(45.1 - 30);
    expect(millionaireCue({ ...base, itemIndex: 5, millionaire: m({ phase: 'marked' }) }, 0, cues).from).toBe(52);
  });
});
