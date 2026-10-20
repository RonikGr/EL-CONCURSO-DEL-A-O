// Orden de las pulsaciones de una ronda. Lógica pura.
// `tPress`: instante de la pulsación en el reloj del presentador (fase 2: llegada; fase 3: marca sincronizada).
// `tArrival`: cuándo llegó al presentador.

/** Por instante de pulsación; empate exacto → por llegada → por playerId (determinista). */
export function compareBuzz(a, b) {
  return a.tPress - b.tPress || a.tArrival - b.tArrival || (a.playerId < b.playerId ? -1 : a.playerId > b.playerId ? 1 : 0);
}

/**
 * @param buzzes  [{playerId, tPress, tArrival}]
 * @param winnerId si ya se declaró ganador, va primero aunque luego llegue una pulsación anterior
 * @returns [{playerId, place, tPress, tArrival, reactionMs, deltaMs, nearTie, beatWinner}]
 */
export function rankBuzzes(buzzes, { winnerId = null, tOpen = 0, nearTieMs = 30 } = {}) {
  const sorted = [...buzzes].sort(compareBuzz);
  if (winnerId) {
    const i = sorted.findIndex((b) => b.playerId === winnerId);
    if (i > 0) sorted.unshift(...sorted.splice(i, 1));
  }
  const winner = sorted[0];
  return sorted.map((b, i) => {
    const deltaMs = i === 0 ? 0 : b.tPress - winner.tPress;
    return {
      playerId: b.playerId,
      place: i + 1,
      tPress: b.tPress,
      tArrival: b.tArrival,
      reactionMs: b.tPress - tOpen,
      deltaMs,
      nearTie: i > 0 && Math.abs(deltaMs) < nearTieMs,
      // Pulsó antes que el ganador pero llegó después de cerrar la ventana (se ve en depuración).
      beatWinner: i > 0 && compareBuzz(b, winner) < 0,
    };
  });
}
