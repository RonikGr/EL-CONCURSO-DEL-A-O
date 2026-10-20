// Lista de jugadores de la sala. Lógica pura: la usa el presentador y la prueban los tests.
import { COLORS, ICONS, appearanceKey, isKnownColor, isKnownIcon } from '../shared/appearance.js';

export const MAX_PLAYERS = 20;
export const MIN_PLAYERS = 2;
export const MAX_NAME_LENGTH = 16;
export const DEFAULT_NAME = 'Jugador';

export function sanitizeName(raw) {
  const clean = String(raw ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  // Por puntos de código para no partir emojis.
  return [...clean].slice(0, MAX_NAME_LENGTH).join('').trim() || DEFAULT_NAME;
}

const nameKey = (name) => name.toLocaleLowerCase('es');

/** "Ana" → "Ana (2)", "Ana (3)"… si ya existe (sin distinguir mayúsculas). */
export function uniqueName(name, takenNames) {
  const taken = new Set([...takenNames].map(nameKey));
  if (!taken.has(nameKey(name))) return name;
  for (let n = 2; ; n++) {
    const candidate = `${name} (${n})`;
    if (!taken.has(nameKey(candidate))) return candidate;
  }
}

/**
 * Devuelve una pareja color+icono libre lo más parecida posible a la pedida:
 * la misma si está libre; si no, mismo color con otro icono; si no, mismo icono con otro color; si no, cualquiera.
 */
export function pickFreeAppearance(color, icon, takenKeys) {
  const taken = new Set(takenKeys);
  const wantedColor = isKnownColor(color) ? color : COLORS[0].id;
  const wantedIcon = isKnownIcon(icon) ? icon : ICONS[0].id;
  const free = (c, i) => !taken.has(appearanceKey(c, i));

  if (free(wantedColor, wantedIcon)) return { color: wantedColor, icon: wantedIcon };
  for (const i of ICONS) if (free(wantedColor, i.id)) return { color: wantedColor, icon: i.id };
  for (const c of COLORS) if (free(c.id, wantedIcon)) return { color: c.id, icon: wantedIcon };
  for (const c of COLORS) for (const i of ICONS) if (free(c.id, i.id)) return { color: c.id, icon: i.id };
  return { color: wantedColor, icon: wantedIcon }; // imposible con MAX_PLAYERS < colores × iconos
}

export class Roster {
  /** @param {Array} saved lista de `toJSON()` (p. ej. tras recargar el presentador) */
  constructor(saved = []) {
    this.players = new Map();
    this.nextSeq = 1;
    for (const p of saved) {
      if (!p?.id) continue;
      this.players.set(p.id, {
        id: p.id,
        name: sanitizeName(p.name),
        color: p.color,
        icon: p.icon,
        score: Number.isFinite(p.score) ? p.score : 0,
        joinSeq: p.joinSeq ?? this.nextSeq,
        connected: false,
      });
      this.nextSeq = Math.max(this.nextSeq, (p.joinSeq ?? 0) + 1);
    }
  }

  get size() {
    return this.players.size;
  }

  get connectedCount() {
    let n = 0;
    for (const p of this.players.values()) if (p.connected) n++;
    return n;
  }

  get(id) {
    return this.players.get(id);
  }

  /** En orden de llegada a la sala. */
  list() {
    return [...this.players.values()].sort((a, b) => a.joinSeq - b.joinSeq);
  }

  takenAppearances(exceptId = null) {
    return this.list()
      .filter((p) => p.id !== exceptId)
      .map((p) => appearanceKey(p.color, p.icon));
  }

  /**
   * Alta o reconexión. Si `playerId` ya existe, conserva los puntos.
   * @returns {{ok: true, player, isNew, renamed, appearanceChanged} | {ok: false, reason: 'full'}}
   */
  join({ playerId, name, color, icon }) {
    const existing = this.players.get(playerId);
    if (!existing && this.players.size >= MAX_PLAYERS) return { ok: false, reason: 'full' };

    const resolved = this.#resolveProfile(playerId, { name, color, icon });
    let player = existing;
    if (player) {
      Object.assign(player, resolved.profile, { connected: true });
    } else {
      player = { id: playerId, ...resolved.profile, score: 0, joinSeq: this.nextSeq++, connected: true };
      this.players.set(playerId, player);
    }
    return { ok: true, player, isNew: !existing, renamed: resolved.renamed, appearanceChanged: resolved.appearanceChanged };
  }

  /** Cambio de nombre/color/icono desde el móvil. */
  updateProfile(playerId, wanted) {
    const player = this.players.get(playerId);
    if (!player) return null;
    const resolved = this.#resolveProfile(playerId, wanted);
    Object.assign(player, resolved.profile);
    return { player, renamed: resolved.renamed, appearanceChanged: resolved.appearanceChanged };
  }

  setConnected(playerId, connected) {
    const p = this.players.get(playerId);
    if (p) p.connected = connected;
    return p;
  }

  adjustScore(playerId, delta) {
    const p = this.players.get(playerId);
    if (!p) return null;
    p.score += delta;
    return p.score;
  }

  resetScores() {
    for (const p of this.players.values()) p.score = 0;
  }

  remove(playerId) {
    return this.players.delete(playerId);
  }

  toJSON() {
    return this.list().map(({ id, name, color, icon, score, joinSeq }) => ({ id, name, color, icon, score, joinSeq }));
  }

  #resolveProfile(selfId, { name, color, icon }) {
    const others = this.list().filter((p) => p.id !== selfId);
    const wantedName = sanitizeName(name);
    const finalName = uniqueName(
      wantedName,
      others.map((p) => p.name),
    );
    const appearance = pickFreeAppearance(
      color,
      icon,
      others.map((p) => appearanceKey(p.color, p.icon)),
    );
    return {
      profile: { name: finalName, ...appearance },
      renamed: finalName !== wantedName,
      appearanceChanged: appearance.color !== color || appearance.icon !== icon,
    };
  }
}
