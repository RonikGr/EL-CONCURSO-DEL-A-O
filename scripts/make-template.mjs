// Genera public/plantilla-concurso.xlsx: la plantilla que rellena el presentador.
// Uso: npm run plantilla   (hay un test que comprueba que la plantilla se lee sin errores)
import ExcelJS from 'exceljs';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { COLORS } from '../src/shared/appearance.js';

const OUT = resolve(import.meta.dirname, '../public/plantilla-concurso.xlsx');
const ROWS = 200; // filas con desplegables
const SECTION_LIST = 'Concurso!$B$2:$B$100';
const TRACK = 'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC';

const yesNo = ['Sí', 'No'];
const TYPES = [
  'Pulsador',
  'Test',
  'Verdad o mentira',
  'Dos verdades y una mentira',
  'Votación',
  'Estimación',
  'Parar el contador',
  'Duelo de reflejos',
  'Libre',
];

/**
 * Cada hoja: columnas {title, width, list?: valores o rango, note?} y filas de ejemplo.
 * El orden de las hojas es el del libro.
 */
const SHEETS = [
  {
    name: 'Concurso',
    tab: 'FFFFD400',
    columns: [
      { title: 'Orden', width: 8, note: 'Orden en que se juegan las secciones.' },
      { title: 'Sección', width: 26, note: 'Nombre que se verá en la tele. No puede repetirse.' },
      { title: 'Tipo', width: 26, list: TYPES },
      { title: 'Descripción', width: 50, note: 'Se muestra en la tele al presentar la sección.' },
      { title: 'Puntos', width: 10, note: 'Un número (por acierto) o una lista por puestos, como 3,2,1.' },
      { title: 'El presentador juega', width: 12, list: yesNo, note: 'Vacío = lo normal del tipo (sí en Votación, Contador, Reflejos y Libre).' },
      { title: 'Música de entrada', width: 46, note: 'Opcional: enlace a una canción de Spotify.' },
    ],
    rows: [
      [1, 'Calentamiento', 'Pulsador', 'El primero que pulse, responde.', 1, 'No', null],
      [2, 'Cultura general', 'Test', 'Cuatro respuestas, solo una buena.', 2, null, null],
      [3, '¿Verdad o mentira?', 'Verdad o mentira', '¿Te lo crees o no?', 1, null, null],
      [4, '¿Quién es más probable…?', 'Votación', 'Votad sin piedad.', 1, null, null],
      [5, 'Calcula', 'Estimación', 'El que más se acerque.', '3,2,1', null, null],
      [6, 'Reloj interno', 'Parar el contador', 'Para el reloj lo más cerca posible del objetivo.', '3,2,1', null, null],
      [7, 'Reflejos', 'Duelo de reflejos', 'Cuando se ponga en verde… ¡pulsa!', '3,2,1', null, null],
      [8, 'Dos verdades y una mentira', 'Dos verdades y una mentira', '¿Cuál es la mentira?', 1, null, null],
      [9, 'Fit o Fat', 'Libre', 'Pruebas físicas.', 3, 'Sí', TRACK],
    ],
  },
  {
    name: 'Equipos',
    tab: 'FF1E63D6',
    columns: [
      { title: 'Equipo', width: 26, note: 'Déjala vacía para jugar sin equipos.' },
      { title: 'Color', width: 14, list: COLORS.filter((c) => c.id !== 'gris').map((c) => c.name), note: 'Opcional. Cada equipo, un color.' },
    ],
    rows: [
      ['Los Rojos', 'Rojo'],
      ['Los Azules', 'Azul'],
    ],
  },
  {
    name: 'Ajustes',
    tab: 'FF616161',
    columns: [
      { title: 'Ajuste', width: 34 },
      { title: 'Valor', width: 24 },
    ],
    rows: [
      ['Título del concurso', 'El concurso del año'],
      ['Comodín 50 %', 1],
      ['Comodín Doble', 1],
      ['Comodín Público', 1],
      ['Puntos por defecto', 1],
      ['Puntos por fallo', 0],
      ['Bloquear si pulsa antes', 'Sí'],
      ['Segundos por pregunta', 20],
    ],
  },
  {
    name: 'Pulsador',
    tab: 'FFE53935',
    columns: [
      { title: 'Sección', width: 24, list: SECTION_LIST },
      { title: 'Pregunta', width: 50 },
      { title: 'Respuesta', width: 30, note: 'Solo la ves tú, en tu móvil.' },
      { title: 'Mostrar en tele', width: 10, list: yesNo, note: 'Vacío = sí.' },
      { title: 'Canción', width: 46, note: 'Opcional: enlace de Spotify. Se pausa sola cuando alguien pulsa.' },
      { title: 'Desde segundo', width: 10 },
      { title: 'Notas', width: 30, note: 'Solo para ti.' },
    ],
    rows: [
      ['Calentamiento', '¿Cuál es el río más largo de España?', 'El Tajo', 'Sí', null, null, null],
      ['Calentamiento', '¿Cuántas patas tiene una araña?', 'Ocho', 'Sí', null, null, null],
      ['Calentamiento', '¿Qué canción es?', 'Mr. Brightside', 'No', TRACK, 0, 'Suena 20 s'],
    ],
  },
  {
    name: 'Test',
    tab: 'FF2E7D32',
    columns: [
      { title: 'Sección', width: 24, list: SECTION_LIST },
      { title: 'Pregunta', width: 50 },
      { title: 'A', width: 22 },
      { title: 'B', width: 22 },
      { title: 'C', width: 22, note: 'C y D son opcionales.' },
      { title: 'D', width: 22 },
      { title: 'Correcta', width: 10, list: ['A', 'B', 'C', 'D'] },
      { title: 'Segundos', width: 10, note: 'Vacío = el de Ajustes.' },
      { title: 'Imagen', width: 40, note: 'Opcional: dirección web de una imagen.' },
    ],
    rows: [
      ['Cultura general', '¿En qué año llegó el hombre a la Luna?', '1965', '1969', '1972', '1975', 'B', null, null],
      ['Cultura general', '¿Cuál es el planeta más grande?', 'Saturno', 'Neptuno', 'Júpiter', null, 'C', 15, null],
    ],
  },
  {
    name: 'Verdad o mentira',
    tab: 'FF00ACC1',
    columns: [
      { title: 'Sección', width: 24, list: SECTION_LIST },
      { title: 'Afirmación', width: 60 },
      { title: 'Respuesta', width: 12, list: ['Verdad', 'Mentira'] },
    ],
    rows: [
      ['¿Verdad o mentira?', 'Los pulpos tienen tres corazones.', 'Verdad'],
      ['¿Verdad o mentira?', 'La Gran Muralla China se ve desde el espacio a simple vista.', 'Mentira'],
    ],
  },
  {
    name: 'Dos verdades',
    tab: 'FF8E24AA',
    columns: [
      { title: 'Sección', width: 24, list: SECTION_LIST },
      { title: 'Sobre quién', width: 18, note: 'El jugador protagonista (no vota).' },
      { title: 'Frase 1', width: 40 },
      { title: 'Frase 2', width: 40 },
      { title: 'Frase 3', width: 40 },
      { title: 'Mentira', width: 10, list: ['1', '2', '3'], note: 'Número de la frase falsa.' },
    ],
    rows: [['Dos verdades y una mentira', 'Ana', 'He saltado en paracaídas.', 'Hablo japonés.', 'Tengo tres hermanos.', 2]],
  },
  {
    name: 'Votación',
    tab: 'FFF06292',
    columns: [
      { title: 'Sección', width: 24, list: SECTION_LIST },
      { title: 'Pregunta', width: 60, note: 'Todos votan a un jugador.' },
    ],
    rows: [
      ['¿Quién es más probable…?', '¿Quién es más probable que llegue tarde a su propia boda?'],
      ['¿Quién es más probable…?', '¿Quién es más probable que sobreviva a un apocalipsis zombi?'],
    ],
  },
  {
    name: 'Estimación',
    tab: 'FFFB8C00',
    columns: [
      { title: 'Sección', width: 24, list: SECTION_LIST },
      { title: 'Pregunta', width: 50 },
      { title: 'Respuesta', width: 14, note: 'Un número.' },
      { title: 'Unidad', width: 12 },
      { title: 'Gana', width: 14, list: ['Más cercano', 'Sin pasarse'], note: 'Vacío = más cercano.' },
    ],
    rows: [
      ['Calcula', '¿Cuántos kilómetros mide el Ebro?', 910, 'km', 'Más cercano'],
      ['Calcula', '¿Cuánto cuesta un kilo de jamón ibérico de bellota?', 120, '€', 'Sin pasarse'],
    ],
  },
  {
    name: 'Contador',
    tab: 'FF9CCC65',
    columns: [
      { title: 'Sección', width: 24, list: SECTION_LIST },
      { title: 'Objetivo (s)', width: 12 },
      { title: 'Modo', width: 14, list: ['Visible', 'A ciegas', 'Desaparece'] },
      { title: 'Desaparece a los (s)', width: 14, note: 'Solo con el modo Desaparece.' },
    ],
    rows: [
      ['Reloj interno', 10, 'Visible', null],
      ['Reloj interno', 15, 'Desaparece', 3],
      ['Reloj interno', 7, 'A ciegas', null],
    ],
  },
  {
    name: 'Reflejos',
    tab: 'FF795548',
    columns: [
      { title: 'Sección', width: 24, list: SECTION_LIST },
      { title: 'Rondas', width: 10 },
      { title: 'Participan', width: 12, list: ['Todos', 'Duelo'], note: 'Duelo: eliges a dos desde tu móvil.' },
    ],
    rows: [['Reflejos', 3, 'Todos']],
  },
  {
    name: 'Libre',
    tab: 'FF1E63D6',
    columns: [
      { title: 'Sección', width: 24, list: SECTION_LIST },
      { title: 'Prueba', width: 24 },
      { title: 'Descripción', width: 50 },
      { title: 'Herramienta', width: 14, list: ['Ninguna', 'Cronómetro', 'Contador'] },
      { title: 'Participan', width: 12, list: ['Jugadores', 'Equipos'] },
      { title: 'Puntos', width: 10, note: 'Vacío = los de la sección.' },
    ],
    rows: [
      ['Fit o Fat', 'Plancha', 'Aguanta en plancha. Gana el último.', 'Cronómetro', 'Jugadores', null],
      ['Fit o Fat', 'Flexiones', 'Más flexiones en un minuto.', 'Contador', 'Equipos', 5],
    ],
  },
];

const INSTRUCTIONS = [
  ['CÓMO RELLENAR ESTA PLANTILLA'],
  [''],
  ['1. Concurso: una fila por sección, en el orden en que se jugarán. Elige el tipo en el desplegable.'],
  ['2. Equipos: uno por fila con su color. Si la dejas vacía, se juega sin equipos.'],
  ['3. Ajustes: título, comodines por equipo (o por jugador si no hay equipos) y puntos por defecto.'],
  ['4. Cada tipo de sección tiene su pestaña. En la columna "Sección" escribe (o elige) el nombre de la sección'],
  ['   de la pestaña Concurso a la que pertenece cada fila.'],
  ['5. Las filas de ejemplo se pueden borrar o cambiar. Las columnas pueden ir en cualquier orden,'],
  ['   pero no cambies los títulos de la primera fila.'],
  ['6. Puntos: un número (por acierto) o una lista por puestos, como 3,2,1 (1º, 2º y 3º).'],
  ['7. Canciones: copia el enlace de Spotify (Compartir → Copiar enlace de la canción).'],
  [''],
  ['Para cargarla: en el portátil, pantalla de preparación → "Cargar concurso" → elige este archivo.'],
  ['Desde Google Sheets: Archivo → Descargar → Microsoft Excel (.xlsx).'],
  ['Si algo está mal, el portátil te dirá en qué pestaña y fila.'],
];

const wb = new ExcelJS.Workbook();
wb.creator = 'Concurso del año';

const info = wb.addWorksheet('Instrucciones', { properties: { tabColor: { argb: 'FF111111' } } });
info.getColumn(1).width = 110;
INSTRUCTIONS.forEach(([line], i) => {
  const cell = info.getCell(i + 1, 1);
  cell.value = line;
  cell.font = i === 0 ? { bold: true, size: 16 } : { size: 12 };
});

for (const def of SHEETS) {
  const ws = wb.addWorksheet(def.name, {
    properties: { tabColor: { argb: def.tab } },
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  ws.columns = def.columns.map((c) => ({ header: c.title, width: c.width }));
  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF232946' } };
  header.alignment = { vertical: 'middle', wrapText: true };
  header.height = 30;
  def.columns.forEach((c, i) => {
    if (c.note) header.getCell(i + 1).note = c.note;
  });
  for (const row of def.rows) ws.addRow(row);

  def.columns.forEach((c, i) => {
    if (!c.list) return;
    const formula = Array.isArray(c.list) ? `"${c.list.join(',')}"` : c.list;
    for (let r = 2; r <= ROWS; r++) {
      ws.getCell(r, i + 1).dataValidation = {
        type: 'list',
        allowBlank: true,
        formulae: [formula],
        showErrorMessage: Array.isArray(c.list),
        errorStyle: 'warning',
        errorTitle: 'Valor no previsto',
        error: 'Elige un valor de la lista.',
      };
    }
  });
}

mkdirSync(dirname(OUT), { recursive: true });
await wb.xlsx.writeFile(OUT);
console.log(`Plantilla escrita en ${OUT}`);
