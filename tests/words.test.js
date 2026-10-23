import { describe, expect, it } from 'vitest';
import { WPHASE, WordDeck, WordsRound } from '../src/core/words.js';

const cards = ['Vampiro', 'Calabaza', 'Fantasma', 'Bruja'].map((word) => ({ word, banned: [], mode: 'mimica' }));
const fixed = () => 0; // sin barajar de verdad: el orden queda determinado

describe('palabras secretas', () => {
  it('el mazo no repite hasta acabarse', () => {
    const deck = new WordDeck(cards, { rng: Math.random });
    const seen = Array.from({ length: 4 }, () => deck.draw());
    expect(new Set(seen).size).toBe(4);
    expect(deck.draw()).toBeGreaterThanOrEqual(0); // vuelve a barajar
  });

  it('un turno: acertadas suman, pasar y falta no', () => {
    const deck = new WordDeck(cards, { rng: fixed });
    const r = new WordsRound(deck, { roundId: 't1', seconds: 60 });
    expect(r.mark('ok', 0)).toBe(false); // aún no ha empezado
    r.start(1000);
    expect(r.phase).toBe(WPHASE.RUNNING);
    const first = r.card.word;
    r.mark('ok', 2000);
    r.mark('pass', 3000);
    r.mark('foul', 4000);
    r.mark('ok', 5000);
    expect(r.score).toBe(2);
    expect(r.results[0].card).toBe(cards.findIndex((c) => c.word === first));
    r.undo(); // la última acertada no valía
    expect(r.score).toBe(1);
    r.finish();
    expect([r.phase, r.card]).toEqual([WPHASE.DONE, null]);
  });

  it('la tarjeta que se marca cuando ya se acabó el tiempo es la última', () => {
    const r = new WordsRound(new WordDeck(cards, { rng: fixed }), { roundId: 't1', seconds: 1 });
    r.start(0);
    r.mark('ok', 1500);
    expect(r.card).toBe(null);
  });

  it('se guarda y se recupera el turno y el mazo', () => {
    const deck = new WordDeck(cards, { rng: fixed });
    deck.draw();
    const again = new WordDeck(cards, { saved: JSON.parse(JSON.stringify(deck.toJSON())) });
    expect(again.cursor).toBe(1);
    const r = new WordsRound(deck, { roundId: 't1' });
    r.start(0);
    r.mark('ok', 1);
    const back = WordsRound.fromJSON(deck, JSON.parse(JSON.stringify(r.toJSON())));
    expect([back.phase, back.score]).toEqual([WPHASE.DONE, 1]);
  });
});
