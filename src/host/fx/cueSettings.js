// Ajustes a mano de los puntos de las canciones del millonario (ventana de música → «Ajustar tiempos»): se guardan en
// este portátil y mandan sobre los de core/millionaireMusic.js. «Copiar ajustes» los da en texto para dejarlos fijos
// en el código si se quiere.
import { MILLIONAIRE_CUES, applyCueOverrides, pruneCueOverrides } from '../../core/millionaireMusic.js';
import { loadJSON, saveJSON } from '../../shared/storage.js';

const KEY = 'concurso.millonario.puntos.v1';

// los que ya coinciden con los de partida (p. ej. porque se dejaron fijos en el código) dejan de contar como ajustes
let overrides = pruneCueOverrides(MILLIONAIRE_CUES, loadJSON(KEY, {}) ?? {});
saveJSON(KEY, overrides);
let cues = applyCueOverrides(MILLIONAIRE_CUES, overrides);

/** Avisa cuando cambia algún punto (para repintar la ventana y que la música use los nuevos). */
export const cueSettings = new EventTarget();

/** Los puntos de cada canción, ya con los ajustes. */
export const getCues = () => cues;

/** ¿Este campo está cambiado a mano? */
export const isAdjusted = (track, field) => overrides[track]?.[field] != null;

export function setCuePoint(track, field, value) {
  if (!Number.isFinite(value)) return;
  overrides[track] = { ...overrides[track], [field]: Math.round(value * 1000) / 1000 };
  commit();
}

/** Vuelve a los puntos de partida (de un campo, de una canción o de todas). */
export function resetCues(track = null, field = null) {
  if (!track) overrides = {};
  else if (!field) delete overrides[track];
  else if (overrides[track]) {
    delete overrides[track][field];
    if (!Object.keys(overrides[track]).length) delete overrides[track];
  }
  commit();
}

/** Los ajustes en texto (para copiarlos y dejarlos fijos). */
export const cueOverridesText = () => JSON.stringify(overrides, null, 1);

function commit() {
  saveJSON(KEY, overrides);
  cues = applyCueOverrides(MILLIONAIRE_CUES, overrides);
  cueSettings.dispatchEvent(new Event('change'));
}
