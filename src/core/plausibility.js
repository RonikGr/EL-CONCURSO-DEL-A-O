// Instante de una pulsación en el reloj del presentador, a partir de la marca del móvil.
// El móvil puede mentir o estar mal sincronizado: se recorta lo físicamente imposible.

/** Ninguna pulsación legítima puede llevar más retraso que esto (o 2×RTT si es mayor). */
export const MIN_MAX_LAG_MS = 250;
/** Margen para marcas "del futuro" (más tarde que la llegada) por error de sincronización. */
export const MIN_FUTURE_TOLERANCE_MS = 10;

export const PRESS_SOURCE = {
  SYNCED: 'synced', // marca del móvil traducida al reloj del presentador
  ARRIVAL: 'arrival', // móvil aún sin sincronizar: cuenta la llegada
  CLAMPED_FUTURE: 'clamped-future', // decía haber pulsado después de llegar: imposible
  CLAMPED_EARLY: 'clamped-early', // decía haber pulsado demasiado antes de llegar: recortado
};

/**
 * @param tLocal  event.timeStamp del pointerdown en el móvil (su reloj)
 * @param offset  offset estimado por el móvil (reloj host − reloj móvil), o undefined si no hay
 * @param err     cota del error del offset (±ms)
 * @param tArrival llegada al presentador (su reloj)
 * @param rtt     RTT medido por el presentador con el latido (null si aún no hay)
 */
export function resolvePressTime({ tLocal, offset, err = 0, tArrival, rtt = null }) {
  if (!Number.isFinite(tLocal) || !Number.isFinite(offset)) {
    return { tPress: tArrival, source: PRESS_SOURCE.ARRIVAL, claimed: null };
  }
  const claimed = tLocal + offset;
  const futureTolerance = Math.max(MIN_FUTURE_TOLERANCE_MS, Number.isFinite(err) ? err : 0);
  if (claimed > tArrival + futureTolerance) {
    return { tPress: tArrival, source: PRESS_SOURCE.CLAMPED_FUTURE, claimed };
  }
  const maxLag = Math.max(MIN_MAX_LAG_MS, 2 * (Number.isFinite(rtt) ? rtt : 0));
  if (claimed < tArrival - maxLag) {
    return { tPress: tArrival - maxLag, source: PRESS_SOURCE.CLAMPED_EARLY, claimed };
  }
  return { tPress: Math.min(claimed, tArrival), source: PRESS_SOURCE.SYNCED, claimed };
}
