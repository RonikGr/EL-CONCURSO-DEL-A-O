// Estado del presentador en localStorage para sobrevivir a una recarga de la página.
import { loadJSON, removeKey, saveJSON } from '../shared/storage.js';
import { isValidRoomCode } from '../shared/roomCode.js';

const KEY = 'concurso.host.v1';
const MAX_AGE_MS = 12 * 60 * 60 * 1000;

/** Sala guardada si existe y no ha caducado; si no, `null`. */
export function loadSavedRoom(nowMs = Date.now()) {
  const saved = loadJSON(KEY);
  if (!saved || !isValidRoomCode(saved.code) || !Array.isArray(saved.players)) return null;
  if (!(nowMs - saved.savedAt < MAX_AGE_MS)) return null;
  return saved;
}

export function saveRoom({ code, players, settings, qid }) {
  saveJSON(KEY, { code, players, settings, qid, savedAt: Date.now() });
}

export function clearSavedRoom() {
  removeKey(KEY);
}
