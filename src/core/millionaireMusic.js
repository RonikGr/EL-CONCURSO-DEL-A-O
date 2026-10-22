// Música del millonario: las 7 canciones del programa (las pone el presentador: no están en el repositorio) y en qué
// punto de cada una hay que estar en cada momento. Los tiempos salen de analizar los archivos (compás, golpes y
// bucles que casan): cambian solo si cambian las canciones.
//
//   tema       → presentación de la sección (una vez)
//   explicación→ «Cómo se juega» (bucle del colchón)
//   fácil / media / difícil (según el nº de pregunta): intro → bucle mientras se juega → al marcar, el golpe de
//                «respuesta definitiva» y bucle de suspense → al acertar, el golpe final (al fallar, silencio)
//   equipo     → Público: empieza donde haga falta para que el golpe caiga justo al acabar los 15 s de votación
//   llamada    → antes del «ya», bucle de espera; con el «ya», el reloj de 30 s de la canción (golpe final = 0 s)

/** Huecos de canción (tracks.js) → qué es y cómo se reconoce por el nombre del archivo (sin tildes ni mayúsculas). */
export const MILLIONAIRE_TRACKS = [
  { id: 'theme', label: 'Tema del programa', help: 'Al presentar la sección', match: /tema|sintonia/ },
  { id: 'rules', label: 'Explicación', help: 'En «Cómo se juega», antes de la primera pregunta', match: /explica/ },
  { id: 'easy', label: 'Pregunta fácil', help: 'Primer tercio de las preguntas', match: /facil/ },
  { id: 'medium', label: 'Pregunta media', help: 'Segundo tercio', match: /media|intermedia/ },
  { id: 'hard', label: 'Pregunta difícil', help: 'Último tercio', match: /dificil/ },
  { id: 'audience', label: 'Preguntar al equipo', help: 'Comodín del público: los 15 s de votación', match: /equipo|publico/ },
  { id: 'call', label: 'Llamar a alguien', help: 'Comodín de la llamada: la espera y los 30 s', match: /llama/ },
];

/**
 * Puntos de cada canción, en segundos. `gainDb` iguala el volumen de los colchones (medido: unos −22 dB).
 * loop = [inicio, fin] del bucle; lock = golpe de «respuesta definitiva»; suspense = bucle tras marcar;
 * reveal = golpe final; voteEnd / clockEnd = golpe en el que acaba la votación / la llamada; end = donde acaba el
 * sonido (los archivos traen unos segundos de silencio: así lo siguiente entra enseguida).
 */
export const MILLIONAIRE_CUES = {
  theme: { gainDb: -3.5, end: 38.4 },
  rules: { gainDb: 0, loop: [16.685, 44.509] },
  easy: { gainDb: 3.5, loop: [15.08, 79.08], lock: 84.98, suspense: [91.06, 97.06], reveal: 99.4 },
  medium: { gainDb: 2.4, loop: [17.215, 81.215], lock: 83.12, suspense: [91.2, 97.2], reveal: 99.0 },
  hard: { gainDb: 1.3, loop: [15.965, 47.965], lock: 55.9, suspense: [61.95, 67.95], reveal: 73.45 },
  audience: { gainDb: 1, voteEnd: 22.09, end: 32.8 },
  call: { gainDb: 3, loop: [5.86, 13.86], clockEnd: 44.85, end: 46.8 },
};

export const LEVELS = ['easy', 'medium', 'hard'];

/** Nivel de la pregunta `index` de `count`: por tercios (con 4: fácil, fácil, media, difícil). */
export function levelOf(index, count) {
  if (!(count > 0)) return 'easy';
  return LEVELS[Math.min(2, Math.floor((index * 3) / count))];
}

/** ¿Qué canción del millonario es este archivo? (por su nombre) → id o null */
export function millionaireTrackFor(fileName) {
  const n = fileName
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
  // primero las de pregunta (fácil / difícil antes que media: «intermedia» no lleva «facil»)
  for (const id of ['easy', 'hard', 'medium', 'theme', 'rules', 'audience', 'call']) {
    if (MILLIONAIRE_TRACKS.find((t) => t.id === id).match.test(n)) return id;
  }
  return null;
}

/**
 * Qué tiene que sonar ahora en una sección de millonario, o null si no es una (suena la música de siempre).
 * Una «entrada» = {key, track, from, loop?, after?}: `key` cambia cuando hay que cambiar de punto (si no, sigue);
 * `after` = qué sonará cuando la canción acabe (si no tiene bucle). track null = silencio.
 *
 * @param v {screen, sectionIndex, sectionType, introRules, itemIndex, itemCount, millionaire}
 * @param now reloj de la tele (performance.now) para los comodines con tiempo
 */
export function millionaireCue(v, now) {
  if (v.sectionType !== 'test') return null;
  if (v.screen === 'intro') {
    return v.introRules
      ? { key: `rules:${v.sectionIndex}`, track: 'rules', from: 0, loop: MILLIONAIRE_CUES.rules.loop }
      : { key: `theme:${v.sectionIndex}`, track: 'theme', from: 0 };
  }
  const m = v.millionaire;
  if (v.screen !== 'play' || !m) return null;

  const level = levelOf(v.itemIndex, v.itemCount);
  const c = MILLIONAIRE_CUES[level];
  const r = m.roundId;
  // Tras un comodín con música, el colchón vuelve desde el bucle (sin la intro)
  const resumed = m.used.some((k) => k === 'audience' || k === 'call');
  const bed = { key: `bed:${r}:${resumed ? 1 : 0}`, track: level, from: resumed ? c.loop[0] : 0, loop: c.loop };

  if (m.phase === 'revealed') return m.result?.correct ? { key: `reveal:${r}`, track: level, from: c.reveal } : { key: `wrong:${r}`, track: null, from: 0 };
  if (m.phase === 'marked') return { key: `lock:${r}`, track: level, from: c.lock, loop: c.suspense };

  // El último comodín con música que se usó manda
  const last = [...m.used].reverse().find((k) => k === 'audience' || k === 'call');
  if (last === 'call' && m.call) {
    const k = MILLIONAIRE_CUES.call;
    if (m.call.state === 'waiting') return { key: `callwait:${r}`, track: 'call', from: 0, loop: k.loop };
    if (m.call.state === 'running') return { key: `call:${r}`, track: 'call', from: Math.max(0, k.clockEnd - Math.max(0, m.call.endsAt - now) / 1000), after: bed };
    // acabada (a tiempo o antes): el golpe final y vuelta al colchón
    return { key: `callend:${r}`, track: 'call', from: k.clockEnd - 0.1, after: bed };
  }
  if (last === 'audience' && m.audience && m.audience.state !== 'cancelled') {
    const k = MILLIONAIRE_CUES.audience;
    // votando o ya votado: la misma entrada (la canción sigue hasta el final y luego vuelve el colchón)
    const left = m.audience.state === 'voting' ? Math.max(0, m.audience.endsAt - now) / 1000 : 0;
    return { key: `aud:${r}`, track: 'audience', from: Math.max(0, k.voteEnd - left), after: bed };
  }
  return bed;
}
