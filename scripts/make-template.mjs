// Genera public/plantilla-concurso.xlsx: la plantilla que rellena el presentador.
// Uso: npm run plantilla   (hay un test que comprueba que la plantilla se lee sin errores)
//
// Pensada para rellenarla sin leer instrucciones: debajo de cada título, una fila azul explica la columna (empieza por
// «↳» y la lectura la salta); desplegables donde hay opciones; la respuesta buena se pinta de verde; la columna
// «Sección» de las preguntas va al final y vacía vale (= la única sección de ese tipo).
import ExcelJS from 'exceljs';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { COLORS } from '../src/shared/appearance.js';
import { ENVIRONMENTS } from '../src/shared/environments.js';

const OUT = resolve(import.meta.dirname, '../public/plantilla-concurso.xlsx');
const HELP = '↳ '; // marca de la fila de ayuda (src/core/show.js la salta)
const FIRST = 3; // primera fila de datos (1 = títulos, 2 = ayuda)
const ROWS = 200; // filas con desplegables y formato
const SECTION_LIST = `Concurso!$B$${FIRST}:$B$100`;

const yesNo = ['Sí', 'No'];

/** Tipos de sección: nombre en el desplegable, pestaña de sus preguntas y qué es (para «Empieza aquí»). */
const TYPES = [
  { type: 'Pulsador', sheet: 'Pulsador', what: 'El primero que pulse responde en voz alta; tú das acierto o fallo.' },
  { type: 'Test', sheet: 'Test', what: '«¿Quién quiere ser millonario?»: uno cada vez, 4 respuestas y comodines.' },
  { type: 'Verdad o mentira', sheet: 'Verdad o mentira', what: 'Una afirmación; todos responden a la vez desde el móvil.' },
  { type: 'Dos verdades y una mentira', sheet: 'Dos verdades', what: 'Tres frases sobre un jugador; los demás buscan la falsa.' },
  { type: 'Votación', sheet: 'Votación', what: '«¿Quién es más probable que…?»: todos votan a un jugador.' },
  { type: 'Estimación', sheet: 'Estimación', what: 'Cada uno escribe un número; gana el más cercano.' },
  { type: 'Parar el contador', sheet: 'Contador', what: 'Parar el reloj lo más cerca posible de un tiempo.' },
  { type: 'Duelo de reflejos', sheet: 'Reflejos', what: 'Rojo… ¡verde! Gana el más rápido en pulsar.' },
  { type: 'Libre', sheet: 'Libre', what: 'Pruebas físicas o lo que quieras («Fit o Fat»); tú das los puntos.' },
];

// Formato que se repite
const fill = (argb) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
const DARK = 'FF232946';
const HELP_FILL = 'FFDDEBFF';
const GOOD = { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFC8E6C9' } }, font: { bold: true, color: { argb: 'FF1B5E20' } } };
const BAD = { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFFFCDD2' } }, font: { bold: true, color: { argb: 'FFB71C1C' } } };
const MID = { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFFFF3C4' } }, font: { bold: true, color: { argb: 'FF8D6E00' } } };

/** La columna «Sección» de las pestañas de preguntas (al final: casi nunca hace falta). */
const sectionCol = {
  title: 'Sección',
  width: 22,
  list: SECTION_LIST,
  help: 'Vacía = la única sección de este tipo. Si hay varias, elige a cuál va cada fila.',
};

/**
 * Cada hoja: columnas {title, width, help (fila azul), list?: valores o rango, wrap?} y filas de ejemplo.
 * `cf` = reglas de formato condicional {col, when, style} (when = fórmula con {r} = fila).
 */
const SHEETS = [
  {
    name: 'Concurso',
    tab: 'FFFFD400',
    columns: [
      { title: 'Orden', width: 7, help: '1, 2, 3… (orden de juego)' },
      { title: 'Sección', width: 26, help: 'Nombre que verá todo el mundo en la tele. Sin repetir.' },
      { title: 'Tipo', width: 26, list: TYPES.map((t) => t.type), help: 'Elige en el desplegable qué juego es.' },
      { title: 'Sus preguntas, en la pestaña', width: 22, help: 'Se rellena sola: ahí escribes sus preguntas.', formula: true },
      { title: 'Descripción', width: 46, wrap: true, help: 'Opcional: una frase que sale en la tele al presentarla.' },
      {
        title: 'Puntos',
        width: 10,
        help: 'Por acierto (p. ej. 1). Por puestos: 3,2,1. Test: fácil, media, difícil (1,3,5).',
      },
      { title: 'El presentador juega', width: 12, list: yesNo, help: 'Vacío = lo normal del tipo.' },
      { title: 'Por turnos', width: 11, list: yesNo, help: 'Sí = uno de cada equipo por pregunta (Verdad, Estimación, Contador).' },
      { title: 'Entorno', width: 20, list: ENVIRONMENTS.map((e) => e.name), help: 'Opcional: decorado de la tele.' },
    ],
    rows: [
      [1, 'Calentamiento', 'Pulsador', null, 'El primero que pulse, responde.', 1, 'No'],
      [2, 'Cultura general', 'Test', null, '¿Quién quiere ser millonario? Uno cada vez; vuestro portavoz decide el orden.', '1,3,5', null, null],
      [3, '¿Verdad o mentira?', 'Verdad o mentira', null, '¿Te lo crees o no?', 1, null],
      [4, '¿Quién es más probable…?', 'Votación', null, 'Votad sin piedad.', 1, null],
      [5, 'Calcula', 'Estimación', null, 'El que más se acerque.', '3,2,1', null],
      [6, 'Reloj interno', 'Parar el contador', null, 'Para el reloj lo más cerca posible del objetivo.', '3,2,1', null],
      [7, 'Reflejos', 'Duelo de reflejos', null, 'Cuando se ponga en verde… ¡pulsa!', '3,2,1', null],
      [8, 'Dos verdades y una mentira', 'Dos verdades y una mentira', null, '¿Cuál es la mentira?', 1, null],
      [9, 'Fit o Fat', 'Libre', null, 'Pruebas físicas.', 3, 'Sí', null, 'Noche de luna'],
    ],
  },
  {
    name: 'Equipos',
    tab: 'FF1E63D6',
    columns: [
      { title: 'Equipo', width: 26, help: 'Un equipo por fila. Borra todas para jugar sin equipos.' },
      { title: 'Color', width: 14, list: COLORS.filter((c) => c.id !== 'gris').map((c) => c.name), help: 'Opcional. Cada equipo, uno distinto.' },
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
      { title: 'Ajuste', width: 30, help: 'No cambies esta columna.' },
      { title: 'Valor', width: 22, help: 'Cambia solo esta.' },
      { title: 'Qué hace', width: 70, wrap: true, help: 'Solo para leer.' },
    ],
    rows: [
      ['Título del concurso', 'El concurso del año', 'Sale en la tele (portada, título) y en los móviles.'],
      ['Comodín 50 %', 1, 'Millonario: cuántos 50:50 tiene cada equipo (o cada jugador sin equipos).'],
      ['Comodín Llamada', 1, 'Millonario: cuántas llamadas a un compañero.'],
      ['Comodín Público', 1, 'Millonario: cuántas veces puede votar su equipo.'],
      ['Puntos por defecto', 1, 'Los de una sección sin nada en «Puntos».'],
      ['Puntos por fallo', 0, 'En el Pulsador, lo que se resta al fallar (0 = nada; −1 = resta uno).'],
      ['Bloquear si pulsa antes', 'Sí', 'Pulsador: quien pulsa antes de tiempo se queda sin pulsar esa pregunta.'],
      ['Segundos por pregunta', 20, 'Tiempo para responder en Verdad o mentira, Votación… (la Estimación tiene 10 más).'],
    ],
  },
  {
    name: 'Pulsador',
    tab: 'FFE53935',
    columns: [
      { title: 'Pregunta', width: 50, wrap: true, help: 'Lo que lees en voz alta (y sale en la tele si quieres).' },
      { title: 'Respuesta', width: 30, wrap: true, help: 'Solo la ves tú, en tu móvil.' },
      { title: 'Mostrar en tele', width: 10, list: yesNo, help: 'Vacío = sí.' },
      { title: 'Notas', width: 30, wrap: true, help: 'Solo para ti (p. ej. «pon la canción»).' },
      sectionCol,
    ],
    rows: [
      ['¿Cuál es el río más largo de España?', 'El Tajo', 'Sí', null],
      ['¿Cuántas patas tiene una araña?', 'Ocho', 'Sí', null],
      ['🎵 ¿Qué canción suena?', 'Mr. Brightside (The Killers)', 'Sí', 'Pon la canción tú desde tu música'],
    ],
  },
  {
    name: 'Test',
    tab: 'FF2E7D32',
    columns: [
      { title: 'Pregunta', width: 46, wrap: true, help: 'La pregunta tal cual.' },
      { title: 'A', width: 20, wrap: true, help: 'Respuesta A' },
      { title: 'B', width: 20, wrap: true, help: 'Respuesta B' },
      { title: 'C', width: 20, wrap: true, help: 'C (opcional)' },
      { title: 'D', width: 20, wrap: true, help: 'D (opcional)' },
      { title: 'Correcta', width: 10, list: ['A', 'B', 'C', 'D'], help: 'Letra: se pinta de verde' },
      { title: 'Dificultad', width: 11, list: ['Fácil', 'Media', 'Difícil'], help: 'Música y puntos. Vacía = por orden.' },
      { title: 'Imagen', width: 30, help: 'Opcional: dirección web (https://…).' },
      sectionCol,
    ],
    // Millonario: 2 fáciles, 2 medias y 2 difíciles (con dos equipos, una de cada para cada equipo).
    rows: [
      ['¿Cuántos lados tiene un hexágono?', 'Cinco', 'Seis', 'Siete', 'Ocho', 'B', 'Fácil'],
      ['¿De qué color es el caballo blanco de Santiago?', 'Negro', 'Marrón', 'Blanco', 'Gris', 'C', 'Fácil'],
      ['¿En qué año llegó el hombre a la Luna?', '1965', '1969', '1972', '1975', 'B', 'Media'],
      ['¿Cuál es el planeta más grande?', 'Saturno', 'Neptuno', 'Júpiter', 'Urano', 'C', 'Media'],
      ['¿Cuál es la capital de provincia española que está a más altura?', 'Cuenca', 'Badajoz', 'Jaén', 'Ávila', 'D', 'Difícil'],
      ['¿Qué elemento químico tiene el símbolo W?', 'Wolframio', 'Vanadio', 'Osmio', 'Wiconio', 'A', 'Difícil'],
    ],
    cf: [
      ...['A', 'B', 'C', 'D'].map((l, i) => ({ col: 2 + i, when: `$F{r}="${l}"`, style: GOOD })), // respuestas: columnas B a E
      { col: 7, when: '$G{r}="Fácil"', style: GOOD },
      { col: 7, when: '$G{r}="Media"', style: MID },
      { col: 7, when: '$G{r}="Difícil"', style: BAD },
    ],
  },
  {
    name: 'Verdad o mentira',
    tab: 'FF00ACC1',
    columns: [
      { title: 'Afirmación', width: 60, wrap: true, help: 'Una frase que puede ser verdad o mentira.' },
      { title: 'Respuesta', width: 12, list: ['Verdad', 'Mentira'], help: 'Elige' },
      sectionCol,
    ],
    rows: [
      ['Los pulpos tienen tres corazones.', 'Verdad'],
      ['La Gran Muralla China se ve desde el espacio a simple vista.', 'Mentira'],
    ],
    cf: [
      { col: 1, when: '$B{r}="Verdad"', style: GOOD },
      { col: 1, when: '$B{r}="Mentira"', style: BAD },
    ],
  },
  {
    name: 'Dos verdades',
    tab: 'FF8E24AA',
    columns: [
      { title: 'Sobre quién', width: 16, help: 'El jugador (su nombre, como entre). No vota.' },
      { title: 'Frase 1', width: 34, wrap: true, help: 'Tres frases sobre él…' },
      { title: 'Frase 2', width: 34, wrap: true, help: '…dos verdad…' },
      { title: 'Frase 3', width: 34, wrap: true, help: '…y una mentira.' },
      { title: 'Mentira', width: 9, list: ['1', '2', '3'], help: 'Nº de la falsa: se pinta de rojo' },
      sectionCol,
    ],
    rows: [['Ana', 'He saltado en paracaídas.', 'Hablo japonés.', 'Tengo tres hermanos.', 2]],
    cf: [1, 2, 3].map((n) => ({ col: n + 1, when: `OR($E{r}=${n},$E{r}="${n}")`, style: BAD })), // (el desplegable puede dejarlo como texto)
  },
  {
    name: 'Votación',
    tab: 'FFF06292',
    columns: [
      { title: 'Pregunta', width: 64, wrap: true, help: '«¿Quién es más probable que…?»: todos votan a un jugador.' },
      sectionCol,
    ],
    rows: [['¿Quién es más probable que llegue tarde a su propia boda?'], ['¿Quién es más probable que sobreviva a un apocalipsis zombi?']],
  },
  {
    name: 'Estimación',
    tab: 'FFFB8C00',
    columns: [
      { title: 'Pregunta', width: 48, wrap: true, help: 'Una pregunta cuya respuesta es un número.' },
      { title: 'Respuesta', width: 13, help: 'El número exacto.' },
      { title: 'Unidad', width: 10, help: 'Opcional (km, €…).' },
      { title: 'Gana', width: 14, list: ['Más cercano', 'Sin pasarse'], help: 'Vacío = más cercano.' },
      sectionCol,
    ],
    rows: [
      ['¿Cuántos kilómetros mide el Ebro?', 910, 'km', 'Más cercano'],
      ['¿Cuánto cuesta un kilo de jamón ibérico de bellota?', 120, '€', 'Sin pasarse'],
    ],
  },
  {
    name: 'Contador',
    tab: 'FF9CCC65',
    columns: [
      { title: 'Objetivo (s)', width: 12, help: 'Segundos a los que hay que parar el reloj.' },
      { title: 'Modo', width: 14, list: ['Visible', 'A ciegas', 'Desaparece'], help: '¿Se ve el reloj?' },
      { title: 'Desaparece a los (s)', width: 14, help: 'Solo con «Desaparece».' },
      sectionCol,
    ],
    rows: [
      [10, 'Visible', null],
      [15, 'Desaparece', 3],
      [7, 'A ciegas', null],
    ],
  },
  {
    name: 'Reflejos',
    tab: 'FF795548',
    columns: [
      { title: 'Rondas', width: 10, help: 'Cuántas veces se juega.' },
      { title: 'Participan', width: 12, list: ['Todos', 'Duelo'], help: 'Duelo: eliges a dos en el mando.' },
      sectionCol,
    ],
    rows: [[3, 'Todos']],
  },
  {
    name: 'Libre',
    tab: 'FF1E63D6',
    columns: [
      { title: 'Prueba', width: 22, help: 'Nombre de la prueba.' },
      { title: 'Descripción', width: 44, wrap: true, help: 'Qué hay que hacer (sale en la tele).' },
      { title: 'Herramienta', width: 14, list: ['Ninguna', 'Cronómetro', 'Contador'], help: 'Cronómetro: gana quien más aguanta. Contador: +1/−1.' },
      { title: 'Participan', width: 12, list: ['Jugadores', 'Equipos'], help: '¿Juega cada uno o cada equipo?' },
      { title: 'Puntos', width: 9, help: 'Vacío = los de la sección.' },
      sectionCol,
    ],
    rows: [
      ['Plancha', 'Aguanta en plancha. Gana el último.', 'Cronómetro', 'Jugadores', null],
      ['Flexiones', 'Más flexiones en un minuto.', 'Contador', 'Equipos', 5],
    ],
  },
];

const START = [
  ['EMPIEZA AQUÍ', 'title'],
  ['Cómo preparar tu concurso en 4 pasos', 'sub'],
  [''],
  ['1.  Pestaña «Concurso»: una fila por sección (cada juego de la noche), en el orden en que se jugarán.', 'step'],
  ['     Ponle nombre y elige el Tipo en el desplegable. La columna gris te dice en qué pestaña van sus preguntas.'],
  ['2.  Escribe las preguntas en la pestaña de su tipo, una por fila. La fila azul de debajo de los títulos explica cada columna.', 'step'],
  ['     La columna «Sección» (al final) puedes dejarla vacía si solo hay una sección de ese tipo.'],
  ['3.  «Equipos»: uno por fila con su color (sin filas = sin equipos). «Ajustes»: el título y poco más.', 'step'],
  ['4.  Guárdala como .xlsx y cárgala en la tele («Cargar concurso» o dentro de la carpeta del concurso).', 'step'],
  ['     Si algo está mal, la tele te dice la pestaña y la fila.'],
  [''],
  ['Para cambiar algo después: edita la celda y vuelve a cargar el archivo. Las filas que ya hay son ejemplos: cámbialas o bórralas.'],
  ['En el Test, la respuesta buena se pinta de verde según la letra de «Correcta»: así ves de un vistazo que está bien.'],
  ['Desde Google Sheets: Archivo → Descargar → Microsoft Excel (.xlsx).'],
  [''],
  ['TIPOS DE SECCIÓN', 'sub'],
];

const wb = new ExcelJS.Workbook();
wb.creator = 'Concurso del año';

// ---------------------------------------------------------------- «Empieza aquí»
const start = wb.addWorksheet('Empieza aquí', { properties: { tabColor: { argb: 'FFFF8A1F' } }, views: [{ showGridLines: false }] });
start.getColumn(1).width = 30;
start.getColumn(2).width = 22;
start.getColumn(3).width = 80;
START.forEach(([line, kind], i) => {
  const cell = start.getCell(i + 1, 1);
  cell.value = line;
  cell.font = kind === 'title' ? { bold: true, size: 22, color: { argb: 'FFFF8A1F' } } : kind === 'sub' ? { bold: true, size: 14 } : kind === 'step' ? { bold: true, size: 12 } : { size: 12 };
});
const typesHeader = start.getRow(START.length + 1);
typesHeader.values = ['Tipo', 'Sus preguntas, en', 'Qué es'];
typesHeader.font = { bold: true, color: { argb: 'FFFFFFFF' } };
typesHeader.eachCell((c) => (c.fill = fill(DARK)));
TYPES.forEach((t, i) => {
  const row = start.getRow(START.length + 2 + i);
  row.values = [t.type, `pestaña «${t.sheet}»`, t.what];
  row.getCell(1).font = { bold: true };
  if (i % 2) row.eachCell((c) => (c.fill = fill('FFF4F1FA')));
});

// ---------------------------------------------------------------- pestañas de datos
const letter = (n) => String.fromCharCode(64 + n); // 1 → A (las hojas no pasan de la Z)

for (const def of SHEETS) {
  const ws = wb.addWorksheet(def.name, {
    properties: { tabColor: { argb: def.tab } },
    views: [{ state: 'frozen', ySplit: 2 }],
  });
  ws.columns = def.columns.map((c) => ({ header: c.title, width: c.width }));

  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = fill(DARK);
  header.alignment = { vertical: 'middle', wrapText: true };
  header.height = 30;

  // Fila de ayuda (azul, cursiva): «↳ …» en cada columna
  const help = ws.getRow(2);
  help.values = def.columns.map((c) => (c.help ? HELP + c.help : ''));
  help.height = 42;
  def.columns.forEach((c, i) => {
    const cell = help.getCell(i + 1);
    cell.fill = fill(HELP_FILL);
    cell.font = { italic: true, size: 9, color: { argb: 'FF2A3F6B' } };
    cell.alignment = { vertical: 'top', wrapText: true };
  });

  def.rows.forEach((row, k) => (ws.getRow(FIRST + k).values = row));

  def.columns.forEach((c, i) => {
    const col = i + 1;
    for (let r = FIRST; r <= ROWS; r++) {
      const cell = ws.getCell(r, col);
      cell.alignment = { vertical: 'top', wrapText: !!c.wrap };
      if (c.list) {
        cell.dataValidation = {
          type: 'list',
          allowBlank: true,
          formulae: [Array.isArray(c.list) ? `"${c.list.join(',')}"` : c.list],
          showErrorMessage: Array.isArray(c.list),
          errorStyle: 'warning',
          errorTitle: 'Valor no previsto',
          error: 'Elige un valor de la lista.',
        };
      }
    }
  });

  // Concurso: en qué pestaña van las preguntas de cada sección (fórmula; la lectura no mira esta columna)
  const fcol = def.columns.findIndex((c) => c.formula) + 1;
  if (fcol) {
    const typeCol = letter(def.columns.findIndex((c) => c.title === 'Tipo') + 1);
    const types = `{${TYPES.map((t) => `"${t.type}"`).join(',')}}`;
    const sheets = `{${TYPES.map((t) => `"${t.sheet}"`).join(',')}}`;
    for (let r = FIRST; r <= 100; r++) {
      const t = ws.getCell(r, def.columns.findIndex((c) => c.title === 'Tipo') + 1).value;
      const result = TYPES.find((x) => x.type === t)?.sheet;
      const cell = ws.getCell(r, fcol);
      cell.value = { formula: `IF(${typeCol}${r}="","",IFERROR("→ "&INDEX(${sheets},MATCH(${typeCol}${r},${types},0)),"¿tipo?"))`, result: result ? `→ ${result}` : '' };
      cell.font = { color: { argb: 'FF6B6B80' }, italic: true };
      cell.fill = fill('FFF2F2F2');
    }
  }

  // Formato condicional (la respuesta buena en verde…)
  for (const { col, when, style } of def.cf ?? []) {
    ws.addConditionalFormatting({
      ref: `${letter(col)}${FIRST}:${letter(col)}${ROWS}`,
      rules: [{ type: 'expression', formulae: [when.replaceAll('{r}', String(FIRST))], style }],
    });
  }
}

mkdirSync(dirname(OUT), { recursive: true });
await wb.xlsx.writeFile(OUT);
console.log(`Plantilla escrita en ${OUT}`);
