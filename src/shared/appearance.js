// Colores pensados para distinguirse a 3 m sobre fondo oscuro. `fg` = color de texto legible encima.
export const COLORS = [
  { id: 'rojo', name: 'Rojo', bg: '#e53935', fg: '#ffffff' },
  { id: 'naranja', name: 'Naranja', bg: '#fb8c00', fg: '#111111' },
  { id: 'amarillo', name: 'Amarillo', bg: '#fdd835', fg: '#111111' },
  { id: 'lima', name: 'Lima', bg: '#9ccc65', fg: '#111111' },
  { id: 'verde', name: 'Verde', bg: '#2e7d32', fg: '#ffffff' },
  { id: 'turquesa', name: 'Turquesa', bg: '#00acc1', fg: '#111111' },
  { id: 'azul', name: 'Azul', bg: '#1e63d6', fg: '#ffffff' },
  { id: 'morado', name: 'Morado', bg: '#8e24aa', fg: '#ffffff' },
  { id: 'rosa', name: 'Rosa', bg: '#f06292', fg: '#111111' },
  { id: 'marron', name: 'Marrón', bg: '#795548', fg: '#ffffff' },
  { id: 'blanco', name: 'Blanco', bg: '#f5f5f5', fg: '#111111' },
  { id: 'gris', name: 'Gris', bg: '#616161', fg: '#ffffff' },
];

// PROVISIONAL: lista de iconos a sustituir por la del usuario. Basta con cambiar este array
// (ids únicos y estables: se guardan en el móvil y en la sala).
export const ICONS = [
  { id: 'zorro', label: 'Zorro', glyph: '🦊' },
  { id: 'panda', label: 'Panda', glyph: '🐼' },
  { id: 'rana', label: 'Rana', glyph: '🐸' },
  { id: 'leon', label: 'León', glyph: '🦁' },
  { id: 'pulpo', label: 'Pulpo', glyph: '🐙' },
  { id: 'unicornio', label: 'Unicornio', glyph: '🦄' },
  { id: 'abeja', label: 'Abeja', glyph: '🐝' },
  { id: 'tortuga', label: 'Tortuga', glyph: '🐢' },
  { id: 'pinguino', label: 'Pingüino', glyph: '🐧' },
  { id: 'buho', label: 'Búho', glyph: '🦉' },
  { id: 'ballena', label: 'Ballena', glyph: '🐳' },
  { id: 'dinosaurio', label: 'Dinosaurio', glyph: '🦖' },
  { id: 'pizza', label: 'Pizza', glyph: '🍕' },
  { id: 'cohete', label: 'Cohete', glyph: '🚀' },
  { id: 'rayo', label: 'Rayo', glyph: '⚡' },
  { id: 'guitarra', label: 'Guitarra', glyph: '🎸' },
  { id: 'fantasma', label: 'Fantasma', glyph: '👻' },
  { id: 'cactus', label: 'Cactus', glyph: '🌵' },
  { id: 'donut', label: 'Donut', glyph: '🍩' },
  { id: 'chistera', label: 'Chistera', glyph: '🎩' },
];

const colorById = new Map(COLORS.map((c) => [c.id, c]));
const iconById = new Map(ICONS.map((i) => [i.id, i]));

export const getColor = (id) => colorById.get(id) ?? COLORS[0];
export const getIcon = (id) => iconById.get(id) ?? ICONS[0];
export const isKnownColor = (id) => colorById.has(id);
export const isKnownIcon = (id) => iconById.has(id);

/** Clave de la pareja color+icono, que es lo que debe ser único en la sala. */
export const appearanceKey = (color, icon) => `${color}|${icon}`;
