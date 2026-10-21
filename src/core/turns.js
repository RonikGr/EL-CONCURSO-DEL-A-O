// Secciones «por turnos»: cada pregunta la responde un solo jugador de cada equipo. Al empezar la sección, el portavoz
// del equipo los ordena (de la pregunta más fácil a la más difícil) y la pregunta k le toca al k-ésimo.

/** Tipos de sección que se pueden jugar por turnos (en las demás responde todo el mundo). */
export const TURN_TYPES = new Set(['test', 'verdad', 'estimacion', 'contador']);

/**
 * Orden válido de un equipo: el que eligió el portavoz, sin quien ya no está en el equipo y con los que falten al final
 * (en el orden en que entraron).
 */
export function normalizeOrder(order, memberIds) {
  const members = new Set(memberIds);
  const out = [];
  for (const id of order ?? []) if (members.has(id) && !out.includes(id)) out.push(id);
  for (const id of memberIds) if (!out.includes(id)) out.push(id);
  return out;
}

/**
 * A quién le toca la pregunta k (0 = la primera) por un equipo. Si hay más preguntas que miembros, se vuelve a empezar;
 * si al que le toca no está conectado, responde el siguiente.
 */
export function answererFor(order, k, isConnected = () => true) {
  for (let i = 0; i < order.length; i++) {
    const id = order[(k + i) % order.length];
    if (isConnected(id)) return id;
  }
  return null;
}

/**
 * Millonario: quién concursa en la pregunta k (una persona cada vez). Los equipos se alternan (pregunta 1 → equipo 1,
 * pregunta 2 → equipo 2…) y dentro de cada equipo se sigue el orden de su portavoz. Sin equipos, un solo grupo.
 * Si en un equipo no hay nadie conectado, le toca al siguiente equipo.
 * @param groups [{teamId, order: [playerId…]}]
 * @returns {playerId, teamId} o null
 */
export function seatFor(groups, k, isConnected = () => true) {
  const live = groups.filter((g) => g.order.length);
  for (let i = 0; i < live.length; i++) {
    const g = live[(k + i) % live.length];
    const playerId = answererFor(g.order, Math.floor(k / live.length), isConnected);
    if (playerId) return { playerId, teamId: g.teamId };
  }
  return null;
}
