import { describe, expect, it } from 'vitest';
import { matchFace, namesFromFileName } from '../src/core/faces.js';

describe('caras de los jugadores', () => {
  it('saca los nombres del nombre del archivo', () => {
    expect(namesFromFileName('Rodri, Rodrigo.jpg')).toEqual(['Rodri', 'Rodrigo']);
    expect(namesFromFileName('mamá_mama;Mami.PNG')).toEqual(['mamá', 'mama', 'Mami']);
    expect(namesFromFileName('Ana María - Anita.jpeg')).toEqual(['Ana María', 'Anita']);
  });
  it('reconoce el nombre sin importar mayúsculas, tildes ni espacios', () => {
    const faces = [
      { id: 'f1', names: ['Rodri', 'Rodrigo'] },
      { id: 'f2', names: ['Mamá'] },
    ];
    expect(matchFace('RODRIGO', faces)).toBe('f1');
    expect(matchFace('  mama ', faces)).toBe('f2');
    expect(matchFace('Rodri (2)', faces)).toBeNull(); // un repetido no se lleva la cara
    expect(matchFace('', faces)).toBeNull();
  });
});
