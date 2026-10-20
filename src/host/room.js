// Controlador de la sala del presentador: une el roster y el motor de preguntas (lógica pura),
// la fuente de móviles y la persistencia. La interfaz escucha 'change' (repintar) y 'decided' (hay ganador).
import { MAX_PLAYERS, MIN_PLAYERS, Roster } from '../core/players.js';
import { PHASE, QuestionEngine, playerView } from '../core/game.js';
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

const now = () => performance.now();

export class HostRoom extends EventTarget {
  #windowTimer = null;
  #openTimer = null;

  constructor({ code, savedPlayers = [], settings = {}, qid = 1 }) {
    super();
    this.code = code;
    this.roster = new Roster(savedPlayers);
    this.settings = { ...DEFAULT_SETTINGS, ...settings };
    this.game = new QuestionEngine(this.settings, { qid });
    this.network = { state: 'connecting', message: '' };
    this.rtt = new Map();
    this.source = new PeerSource({
      roomCode: code,
      handlers: {
        onStatus: (s) => {
          this.network = s;
          this.#changed({ persist: false });
        },
        onHello: (playerId, msg) => this.#onHello(playerId, msg),
        onProfile: (playerId, msg) => this.#onProfile(playerId, msg),
        onBuzz: (playerId, msg) => this.#onBuzz(playerId, msg),
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
    this.#clearTimers();
    this.source.destroy();
  }

  get canPlay() {
    return this.roster.connectedCount >= MIN_PLAYERS;
  }

  /** Jugadores con datos para pintar en la tele. */
  players() {
    return this.roster.list().map((p) => ({
      ...p,
      rtt: p.connected ? (this.rtt.get(p.id) ?? null) : null,
      lock: this.game.lockouts.get(p.id) ?? null,
    }));
  }

  /** Estado de la pregunta para la tele, con los datos de cada jugador ya resueltos. */
  gameView() {
    const g = this.game;
    const ranking = g.phase === PHASE.RESULT || g.phase === PHASE.OPEN ? g.ranking() : [];
    return {
      qid: g.qid,
      phase: g.phase,
      tOpen: g.tOpen,
      judged: g.judged,
      winner: g.winnerId ? this.roster.get(g.winnerId) : null,
      ranking: ranking.map((r) => ({ ...r, player: this.roster.get(r.playerId) })).filter((r) => r.player),
    };
  }

  // ---------- Acciones del presentador ----------

  openTurn() {
    if (!this.canPlay || !this.game.open(now())) return false;
    // Repintar la tele justo cuando empieza el turno ("Preparados…" → "¡Pulsad!").
    clearTimeout(this.#openTimer);
    this.#openTimer = setTimeout(() => this.#changed({ persist: false }), Math.max(0, this.game.tOpen - now()));
    this.#afterGameChange();
    return true;
  }

  markCorrect() {
    const winnerId = this.game.correct();
    if (!winnerId) return false;
    this.roster.adjustScore(winnerId, this.settings.pointsForCorrect);
    this.#afterGameChange();
    return true;
  }

  markWrong() {
    const activeIds = this.roster.list().filter((p) => p.connected).map((p) => p.id);
    const res = this.game.wrong(now(), activeIds);
    if (!res) return false;
    if (this.settings.pointsForWrong) this.roster.adjustScore(res.loserId, this.settings.pointsForWrong);
    if (res.reopened) {
      clearTimeout(this.#openTimer);
      this.#openTimer = setTimeout(() => this.#changed({ persist: false }), Math.max(0, this.game.tOpen - now()));
    }
    this.#afterGameChange();
    return true;
  }

  nextQuestion() {
    this.#clearTimers();
    this.game.next();
    this.#afterGameChange();
  }

  restartQuestion() {
    this.#clearTimers();
    this.game.restart();
    this.#afterGameChange();
  }

  unlockPlayer(playerId) {
    if (this.game.unlock(playerId)) this.#afterGameChange();
  }

  updateSettings(patch) {
    Object.assign(this.settings, patch); // el motor comparte este objeto
    this.#changed();
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
    this.game.unlock(playerId);
    this.#broadcastState();
    this.#changed();
  }

  // ---------- Mensajes de los jugadores ----------

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

  #onBuzz(playerId, msg) {
    const res = this.game.buzz({ playerId, tPress: msg.tPress, tArrival: msg.tArrival, epoch: msg.epoch });
    this.source.sendTo(playerId, { t: MSG.BUZZ_ACK, seq: msg.seq, result: res.result });
    if (res.windowEndsAt != null && !this.#windowTimer) {
      this.#windowTimer = setTimeout(() => this.#closeWindow(), Math.max(0, res.windowEndsAt - now()));
    }
    if (res.result === 'ok' || res.locked) this.#afterGameChange();
  }

  #closeWindow() {
    this.#windowTimer = null;
    if (!this.game.closeWindow(now())) return;
    this.#afterGameChange();
    this.dispatchEvent(new Event('decided'));
  }

  #onLeave(playerId) {
    this.roster.setConnected(playerId, false);
    this.rtt.delete(playerId);
    this.#broadcastState();
    this.#changed();
  }

  // ---------- Estado hacia los móviles ----------

  #stateFor(player) {
    const g = this.game;
    const winner = g.winnerId && g.phase === PHASE.RESULT ? this.roster.get(g.winnerId) : null;
    return {
      t: MSG.STATE,
      room: this.code,
      playerCount: this.roster.connectedCount,
      minPlayers: MIN_PLAYERS,
      taken: this.roster.takenAppearances(player.id),
      you: publicPlayer(player),
      game: playerView(g, player.id, now()),
      winner: winner ? publicPlayer(winner) : null,
    };
  }

  #sendState(playerId) {
    const p = this.roster.get(playerId);
    if (p?.connected) this.source.sendTo(playerId, this.#stateFor(p));
  }

  #broadcastState() {
    for (const p of this.roster.list()) if (p.connected) this.source.sendTo(p.id, this.#stateFor(p));
  }

  #afterGameChange() {
    this.#broadcastState();
    this.#changed();
  }

  #clearTimers() {
    clearTimeout(this.#windowTimer);
    clearTimeout(this.#openTimer);
    this.#windowTimer = null;
    this.#openTimer = null;
  }

  #persist() {
    saveRoom({ code: this.code, players: this.roster.toJSON(), settings: this.settings, qid: this.game.qid });
  }

  #changed({ persist = true } = {}) {
    if (persist) this.#persist();
    this.dispatchEvent(new Event('change'));
  }
}

const publicPlayer = ({ id, name, color, icon, score }) => ({ id, name, color, icon, score });
