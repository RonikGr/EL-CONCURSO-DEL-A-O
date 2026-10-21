// La plantilla publicada (public/plantilla-concurso.xlsx, generada con `npm run plantilla`) debe leerse sin errores.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import readXlsxFile from 'read-excel-file/node';
import { SECTION_TYPES, parseShowWorkbook } from '../src/core/show.js';

const FILE = resolve(import.meta.dirname, '../public/plantilla-concurso.xlsx');

describe('plantilla del concurso', () => {
  it('se lee sin errores ni avisos y trae un ejemplo de cada tipo de sección', async () => {
    const sheets = await readXlsxFile(readFileSync(FILE));
    const { show, errors, warnings } = parseShowWorkbook(sheets);
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
    expect(new Set(show.sections.map((s) => s.type))).toEqual(new Set(Object.keys(SECTION_TYPES)));
    expect(show.teams.map((t) => t.color)).toEqual(['rojo', 'azul']);
    for (const s of show.sections) expect(s.items.length, s.name).toBeGreaterThan(0);
  });
});
