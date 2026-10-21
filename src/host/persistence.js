// Estado del presentador en localStorage para sobrevivir a una recarga de la página.
import { loadJSON, removeKey, saveJSON } from '../shared/storage.js';
import { isValidRoomCode } from '../shared/roomCode.js';

const KEY = 'concurso.host.v2';
const MAX_AGE_MS = 12 * 60 * 60 * 1000;

/** Sala guardada si existe y no ha caducado; si no, `null`. */
export function loadSavedRoom(nowMs = Date.now()) {
  const saved = loadJSON(KEY);
  if (!saved || !isValidRoomCode(saved.code) || !Array.isArray(saved.players)) return null;
  if (!(nowMs - saved.savedAt < MAX_AGE_MS)) return null;
  return saved;
}

/** @param data {code, controlSecret, approvedControls, show, runner, players, teamsLocked, teamBonus, settings} */
export function saveRoom(data) {
  saveJSON(KEY, { ...data, savedAt: Date.now() });
}

export function clearSavedRoom() {
  removeKey(KEY);
}
