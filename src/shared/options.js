// Aspecto de las opciones de respuesta, igual en la tele y en los móviles: color + forma + letra,
// para que se distingan aunque alguien no vea bien los colores.
const CHOICES = [
  { letter: 'A', shape: '▲', bg: '#e21b3c', fg: '#ffffff' },
  { letter: 'B', shape: '◆', bg: '#1368ce', fg: '#ffffff' },
  { letter: 'C', shape: '●', bg: '#d89e00', fg: '#111111' },
  { letter: 'D', shape: '■', bg: '#26890c', fg: '#ffffff' },
];

const TRUE_FALSE = [
  { letter: 'V', shape: '✓', bg: '#26890c', fg: '#ffffff' },
  { letter: 'M', shape: '✗', bg: '#e21b3c', fg: '#ffffff' },
];

const STATEMENTS = [
  { letter: '1', shape: '1', bg: '#1368ce', fg: '#ffffff' },
  { letter: '2', shape: '2', bg: '#8e24aa', fg: '#ffffff' },
  { letter: '3', shape: '3', bg: '#d89e00', fg: '#111111' },
];

export function optionStyle(kind, index) {
  if (kind === 'verdad') return TRUE_FALSE[index];
  if (kind === 'dosVerdades') return STATEMENTS[index];
  return CHOICES[index];
}

/** Lo que pide cada tipo de sección, para la tele y el móvil. */
export const ANSWER_PROMPT = {
  test: 'Elige la respuesta correcta',
  verdad: '¿Verdad o mentira?',
  dosVerdades: '¿Cuál es la mentira?',
  votacion: 'Vota a un jugador',
  estimacion: 'Escribe un número',
};
