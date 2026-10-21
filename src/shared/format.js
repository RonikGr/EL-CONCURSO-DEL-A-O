// Tiempos con coma decimal, a la española.

/** 842 → "0,842 s" */
export function formatSeconds(ms, decimals = 3) {
  return `${(Math.max(0, ms) / 1000).toFixed(decimals).replace('.', ',')} s`;
}

/** 45 → "+0,045 s"; -10 → "−0,010 s" */
export function formatDeltaSeconds(ms) {
  const sign = ms < 0 ? '−' : '+';
  return sign + formatSeconds(Math.abs(ms));
}

/** 45.4 → "+45 ms" */
export function formatDeltaMs(ms) {
  const sign = ms < 0 ? '−' : '+';
  return `${sign}${Math.round(Math.abs(ms))} ms`;
}

export const ordinal = (n) => `${n}º`;

/** Distancia al objetivo en Parar el contador (en segundos): por debajo de 1 s, en milisegundos. 0.0234 → "23 ms" */
export function formatGap(seconds) {
  const ms = Math.round(Math.abs(seconds) * 1000);
  return ms < 1000 ? `${ms} ms` : formatSeconds(ms);
}
