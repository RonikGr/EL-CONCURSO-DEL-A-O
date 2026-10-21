import { describe, expect, it } from 'vitest';
import { SCREEN, ShowRunner, isPlayable } from '../src/core/runner.js';

const q = (n) => ({ question: `P${n}`, answer: `R${n}`, showOnTv: true, song: null, songStart: 0, notes: '' });

function show() {
  return {
    title: 'T',
    settings: {},
    teams: [],
    sections: [
      { id: 's1', name: 'Uno', type: 'pulsador', points: [1], items: [q(1), q(2)] },
      { id: 's2', name: 'Dos', type: 'contador', points: [3, 2, 1], items: [{ target: 10, mode: 'visible', hideAfter: null }] },
      { id: 's3', name: 'Tres', type: 'pulsador', points: [1], items: [] },
    ],
  };
}

const where = (r) => [r.screen, r.sectionIndex, r.itemIndex];

describe('recorrido del concurso', () => {
  it('avanza por todas las pantallas', () => {
    const r = new ShowRunner(show());
    expect(where(r)).toEqual([SCREEN.SETUP, 0, 0]);
    const path = [];
    for (let i = 0; i < 10; i++) {
      r.next();
      path.push(where(r));
    }
    expect(path).toEqual([
      [SCREEN.COVER, 0, 0],
      [SCREEN.INTRO, 0, 0],
      [SCREEN.PLAY, 0, 0],
      [SCREEN.PLAY, 0, 1],
      [SCREEN.SCOREBOARD, 0, 0],
      [SCREEN.INTRO, 1, 0], // Contador aún no se puede jugar: se ve la intro…
      [SCREEN.INTRO, 2, 0], // …y se salta
      [SCREEN.PLAY, 2, 0], // pulsador sin lista: improvisado
      [SCREEN.PLAY, 2, 1],
      [SCREEN.PLAY, 2, 2],
    ]);
    r.endSection();
    expect(where(r)).toEqual([SCREEN.SCOREBOARD, 2, 0]);
    r.next();
    expect(r.screen).toBe(SCREEN.FINAL);
    expect(r.next()).toBe(false);
  });

  it('retrocede', () => {
    const r = new ShowRunner(show(), { screen: SCREEN.INTRO, sectionIndex: 2, itemIndex: 0 });
    r.prev();
    expect(where(r)).toEqual([SCREEN.SCOREBOARD, 1, 0]);
    r.prev();
    expect(where(r)).toEqual([SCREEN.INTRO, 1, 0]); // sección no jugable: a su intro
    r.prev();
    expect(where(r)).toEqual([SCREEN.SCOREBOARD, 0, 0]);
    r.prev();
    expect(where(r)).toEqual([SCREEN.PLAY, 0, 1]); // última pregunta
    r.prev();
    r.prev();
    expect(where(r)).toEqual([SCREEN.INTRO, 0, 0]);
    r.prev();
    r.prev();
    expect(r.screen).toBe(SCREEN.SETUP);
    expect(r.prev()).toBe(false);
  });

  it('desde el final vuelve al marcador de la última sección', () => {
    const r = new ShowRunner(show(), { screen: SCREEN.FINAL, sectionIndex: 2 });
    r.prev();
    expect(where(r)).toEqual([SCREEN.SCOREBOARD, 2, 0]);
  });

  it('salta a cualquier sección', () => {
    const r = new ShowRunner(show());
    expect(r.goToSection(2)).toBe(true);
    expect(where(r)).toEqual([SCREEN.INTRO, 2, 0]);
    expect(r.goToSection(9)).toBe(false);
  });

  it('enseñar pregunta y respuesta en la tele, por pregunta', () => {
    const r = new ShowRunner(show(), { screen: SCREEN.PLAY, sectionIndex: 0, itemIndex: 0 });
    expect(r.showQuestion()).toBe(true);
    expect(r.showQuestion()).toBe(false);
    r.showAnswer();
    expect(r.shown).toEqual({ question: true, answer: true });
    r.next();
    expect(r.shown).toEqual({ question: false, answer: false });
    r.toSetup();
    expect(r.showQuestion()).toBe(false);
  });

  it('cada pregunta tiene su clave (para reiniciar el motor)', () => {
    const r = new ShowRunner(show(), { screen: SCREEN.PLAY, sectionIndex: 0, itemIndex: 0 });
    const k1 = r.playKey;
    r.next();
    expect(r.playKey).not.toBe(k1);
    r.next();
    expect(r.playKey).toBeNull();
  });

  it('marcador por encima sin perder el sitio', () => {
    const r = new ShowRunner(show(), { screen: SCREEN.PLAY, sectionIndex: 0, itemIndex: 1 });
    r.toggleScoreboard();
    expect(r.peekScoreboard).toBe(true);
    expect(where(r)).toEqual([SCREEN.PLAY, 0, 1]);
    r.next();
    expect(r.peekScoreboard).toBe(false);
    expect(new ShowRunner(show()).toggleScoreboard()).toBe(false); // en preparación no
  });

  it('se guarda y se recupera, corrigiendo índices fuera de rango', () => {
    const r = new ShowRunner(show(), { screen: SCREEN.PLAY, sectionIndex: 0, itemIndex: 1 });
    r.showQuestion();
    const restored = new ShowRunner(show(), JSON.parse(JSON.stringify(r.toJSON())));
    expect(where(restored)).toEqual([SCREEN.PLAY, 0, 1]);
    expect(restored.shown.question).toBe(true);
    expect(where(new ShowRunner(show(), { screen: SCREEN.PLAY, sectionIndex: 99, itemIndex: 99 }))).toEqual([SCREEN.PLAY, 2, 99]);
    expect(new ShowRunner(show(), { screen: 'raro' }).screen).toBe(SCREEN.SETUP);
  });

  it('jugable = tipo disponible y con filas si las necesita', () => {
    const [uno, dos, tres] = show().sections;
    expect(isPlayable(uno)).toBe(true);
    expect(isPlayable(dos)).toBe(false);
    expect(isPlayable(tres)).toBe(true);
    expect(isPlayable(null)).toBe(false);
  });
});
