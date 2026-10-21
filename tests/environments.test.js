import { describe, expect, it } from 'vitest';
import { HOME_ENV, TEST_ENV, sectionEnv } from '../src/shared/environments.js';

describe('entornos de las secciones', () => {
  it('el Test va al plató millonario; los demás se reparten sin repetir el de casa ni el plató', () => {
    expect(sectionEnv({ type: 'test' }, 3)).toBe(TEST_ENV);
    const others = Array.from({ length: 9 }, (_, i) => sectionEnv({ type: 'pulsador' }, i));
    expect(new Set(others).size).toBe(9);
    expect(others).not.toContain(HOME_ENV);
    expect(others).not.toContain(TEST_ENV);
  });
  it('lo que diga la hoja manda', () => {
    expect(sectionEnv({ type: 'test', env: 'cripta' }, 0)).toBe('cripta');
    expect(sectionEnv({ type: 'pulsador', env: 'inventado' }, 0)).toBe('cementerio');
  });
});
