// Controlador de la sala del presentador: une el roster (lógica pura), la fuente de móviles y la persistencia.
// La interfaz escucha el evento 'change' y vuelve a pintar.
import { MAX_PLAYERS, MIN_PLAYERS, Roster } from '../core/players.js';
import { ERROR_CODE, MSG } from '../shared/protocol.js';
import { PeerSource } from './sources/peerSource.js';
import { saveRoom } from './persistence.js';

export const DEFAULT_SETTINGS = {
  pointsForCorrect: 1,
  pointsForWrong: 0,
  lockEarlyBuzz: true,
  scheduledOpenMs: 300,
  decisionWindowMs: 150,
  nearTieMs: 30,
};

export class HostRoom extends EventTarget {
  constructor({ code, savedPlayers = [], settings = {} }) {
    super();
    this.code = code;
    this.roster = new Roster(savedPlayers);
    this.settings = { ...DEFAULT_SETTINGS, ...settings };
    this.network = { state: 'connecting', message: '' };
    this.rtt = new Map();
    this.source = new PeerSource({
      roomCode: code,
      handlers: {
        onStatus: (s) => {
          this.network = s;
          this.#changed();
        },
        onHello: (playerId, msg) => this.#onHello(playerId, msg),
        onProfile: (playerId, msg) => this.#onProfile(playerId, msg),
        onLeave: (playerId) => this.#onLeave(playerId),
        onRtt: (playerId, ms) => {
          this.rtt.set(playerId, ms);
          this.#changed({ persist: false });
        },
      },
    });
  }

  start() {
    this.source.start();
    this.#persist();
  }

  destroy() {
    this.source.destroy();
  }

  get canPlay() {
    return this.roster.connectedCount >= MIN_PLAYERS;
  }

  /** Jugadores con datos para pintar en la tele. */
  players() {
    return this.roster.list().map((p) => ({ ...p, rtt: p.connected ? (this.rtt.get(p.id) ?? null) : null }));
  }

  adjustScore(playerId, delta) {
    if (this.roster.adjustScore(playerId, delta) == null) return;
    this.#sendState(playerId);
    this.#changed();
  }

  resetScores() {
    this.roster.resetScores();
    this.#broadcastState();
    this.#changed();
  }

  removePlayer(playerId) {
    this.source.kick(playerId, { code: ERROR_CODE.REMOVED, message: 'El presentador te ha quitado de la sala.' });
    this.roster.remove(playerId);
    this.rtt.delete(playerId);
    this.#broadcastState();
    this.#changed();
  }

  #onHello(playerId, msg) {
    const res = this.roster.join({ playerId, name: msg.name, color: msg.color, icon: msg.icon });
    if (!res.ok) {
      return { ok: false, error: { code: ERROR_CODE.ROOM_FULL, message: `La sala está llena (máximo ${MAX_PLAYERS} jugadores).` } };
    }
    this.source.sendTo(playerId, {
      t: MSG.WELCOME,
      you: publicPlayer(res.player),
      adjusted: { renamed: res.renamed, appearanceChanged: res.appearanceChanged },
    });
    this.#broadcastState(); // cambia el número de jugadores y las parejas ocupadas para todos
    this.#changed();
    return { ok: true };
  }

  #onProfile(playerId, msg) {
    const res = this.roster.updateProfile(playerId, msg);
    if (!res) return;
    this.source.sendTo(playerId, {
      t: MSG.WELCOME,
      you: publicPlayer(res.player),
      adjusted: { renamed: res.renamed, appearanceChanged: res.appearanceChanged },
    });
    this.#broadcastState();
    this.#changed();
  }

  #onLeave(playerId) {
    this.roster.setConnected(playerId, false);
    this.rtt.delete(playerId);
    this.#broadcastState();
    this.#changed();
  }

  #stateFor(player) {
    return {
      t: MSG.STATE,
      phase: 'lobby',
      room: this.code,
      playerCount: this.roster.connectedCount,
      minPlayers: MIN_PLAYERS,
      taken: this.roster.takenAppearances(player.id),
      you: publicPlayer(player),
    };
  }

  #sendState(playerId) {
    const p = this.roster.get(playerId);
    if (p?.connected) this.source.sendTo(playerId, this.#stateFor(p));
  }

  #broadcastState() {
    for (const p of this.roster.list()) if (p.connected) this.source.sendTo(p.id, this.#stateFor(p));
  }

  #persist() {
    saveRoom({ code: this.code, players: this.roster.toJSON(), settings: this.settings });
  }

  #changed({ persist = true } = {}) {
    if (persist) this.#persist();
    this.dispatchEvent(new Event('change'));
  }
}

const publicPlayer = ({ id, name, color, icon, score }) => ({ id, name, color, icon, score });
