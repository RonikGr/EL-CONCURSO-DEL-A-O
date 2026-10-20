import { describe, expect, it } from 'vitest';
import { ROOM_ALPHABET, ROOM_CODE_LENGTH, generateRoomCode, isValidRoomCode, normalizeRoomCode } from '../src/shared/roomCode.js';

describe('código de sala', () => {
  it('no contiene a la vez los dos caracteres de una pareja confusa', () => {
    for (const pair of ['O0', 'OQ', 'Q0', 'I1', 'L1', 'IL', 'S5', 'B8', 'G6', 'Z2']) {
      const present = [...pair].filter((ch) => ROOM_ALPHABET.includes(ch));
      expect(present.length, pair).toBeLessThan(2);
    }
  });

  it('genera códigos válidos de la longitud indicada', () => {
    for (let i = 0; i < 200; i++) {
      const code = generateRoomCode();
      expect(code).toHaveLength(ROOM_CODE_LENGTH);
      expect(isValidRoomCode(code)).toBe(true);
    }
  });

  it('usa el generador inyectado', () => {
    expect(generateRoomCode(() => 0)).toBe(ROOM_ALPHABET[0].repeat(ROOM_CODE_LENGTH));
  });

  it('normaliza lo que teclea el jugador', () => {
    expect(normalizeRoomCode(' ac-d e ')).toBe('ACDE');
    expect(normalizeRoomCode(undefined)).toBe('');
  });

  it('rechaza códigos con caracteres fuera del alfabeto o longitud incorrecta', () => {
    expect(isValidRoomCode('ACDE')).toBe(true);
    expect(isValidRoomCode('AC0E')).toBe(false);
    expect(isValidRoomCode('ACD')).toBe(false);
    expect(isValidRoomCode('ACDEF')).toBe(false);
    expect(isValidRoomCode(null)).toBe(false);
  });
});
