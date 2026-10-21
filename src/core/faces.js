// Caras de los jugadores: cada foto tiene uno o varios nombres («Rodri», «Rodrigo»…). Quien entra con uno de esos
// nombres (sin importar mayúsculas ni tildes) juega con su cara en vez de con el icono.
import { norm } from './show.js';

/** Nombres a partir del nombre del archivo: «Rodri, Rodrigo.jpg» → ['Rodri', 'Rodrigo']. */
export function namesFromFileName(fileName) {
  return String(fileName)
    .replace(/\.[^.]+$/, '')
    .split(/[,;_+]|\s+-\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Cara que corresponde a un nombre, o null. @param faces [{id, names}] */
export function matchFace(name, faces) {
  const key = norm(name);
  if (!key) return null;
  return faces.find((f) => f.names.some((n) => norm(n) === key))?.id ?? null;
}
