// Concursantes de prueba («bots»): para probar el concurso sin tener varios móviles. Aquí, lo que deciden (puro, con
// un generador de azar que se puede fijar en los tests); host/bots.js los hace entrar y jugar en la sala.

export const BOT_PREFIX = 'bot-';
export const isBot = (playerId) => typeof playerId === 'string' && playerId.startsWith(BOT_PREFIX);

const NAMES = ['Lola', 'Paco', 'Nuria', 'Toni', 'Marga', 'Juanjo', 'Pili', 'Quique', 'Rocío', 'Chema', 'Mari', 'Fermín', 'Begoña', 'Rafa', 'Encarna', 'Luismi', 'Tere', 'Nacho', 'Conchi', 'Germán'];

/** Nombre de un bot que no esté ya en la sala («🤖 Lola», «🤖 Paco»…). */
export function botName(taken) {
  const used = new Set(taken);
  for (let round = 1; ; round++) {
    for (const n of NAMES) {
      const name = round === 1 ? `🤖 ${n}` : `🤖 ${n} ${round}`;
      if (!used.has(name)) return name;
    }
  }
}

/** Entero al azar en [min, max]. */
export const randInt = (rng, min, max) => min + Math.floor(rng() * (max - min + 1));

/** Elemento al azar (o null). */
export const pick = (rng, list) => (list.length ? list[Math.floor(rng() * list.length)] : null);

/** Mezcla (Fisher–Yates) sin tocar la lista. */
export function shuffle(rng, list) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Equipo para un bot nuevo: el que tenga menos gente (con equipos). */
export function teamFor(teams, players) {
  if (!teams.length) return null;
  const size = (id) => players.filter((p) => p.teamId === id).length;
  return [...teams].sort((a, b) => size(a.id) - size(b.id))[0].id;
}

/**
 * Respuesta de un bot en una pregunta de respuestas (no de tiempo): índice de opción, jugador votado o número.
 * Aciertan algo más que al azar (60 % en las de opciones) para que haya de todo en el marcador.
 */
export function botAnswer(question, { selfId, candidates = [] }, rng) {
  switch (question.kind) {
    case 'verdad':
    case 'dosVerdades':
    case 'test':
      if (question.correct != null && rng() < 0.6) return question.correct;
      return randInt(rng, 0, question.options.length - 1);
    case 'votacion':
      return pick(
        rng,
        candidates.filter((id) => id !== selfId),
      );
    case 'estimacion': {
      // entre la mitad y el doble de la buena, más cerca cuanto más suerte
      const k = 0.5 + rng() * 1.5;
      const v = Number(question.correct) * k;
      return Math.abs(v) >= 100 ? Math.round(v) : Math.round(v * 10) / 10;
    }
    default:
      return null;
  }
}

/**
 * Cuándo pulsa un bot en las secciones de tiempo (ms del reloj de la tele), o null si no pulsa.
 * Contador: alrededor del objetivo (±1,5 s). Reflejos: de 180 a 700 ms tras la señal; a veces (8 %) antes de tiempo.
 */
export function botPressAt(round, rng) {
  const q = round.question;
  if (q.kind === 'contador') return round.tOpen + (q.correct + (rng() * 3 - 1.5)) * 1000;
  if (q.kind === 'reflejos') {
    if (rng() < 0.08) return round.tOpen + rng() * Math.max(0, round.tGreen - round.tOpen);
    return round.tGreen + randInt(rng, 180, 700);
  }
  return null;
}

/** Millonario: la respuesta que elige el bot que concursa (entre las que quedan; acierta el 55 %). */
export function botMillionaireChoice({ correct, count, removed = [] }, rng) {
  const left = Array.from({ length: count }, (_, i) => i).filter((i) => !removed.includes(i));
  if (left.includes(correct) && rng() < 0.55) return correct;
  return pick(rng, left);
}
