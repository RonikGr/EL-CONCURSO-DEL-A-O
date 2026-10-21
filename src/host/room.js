// Controlador del portátil: une el concurso (show + runner), los jugadores (roster), el motor del pulsador,
// los mandos del presentador, las conexiones y la persistencia. La tele escucha 'change' (repintar) y
// 'decided' (hay ganador); el mando recibe `controlState` y manda órdenes que acaban en `run()`.
import { MAX_PLAYERS, MIN_PLAYERS, Roster } from '../core/players.js';
import { LOCK, PHASE, QuestionEngine, playerView } from '../core/game.js';
import { SCREEN, ShowRunner, isPlayable } from '../core/runner.js';
import { SECTION_TYPES, defaultShow } from '../core/show.js';
import { ERROR_CODE, MSG } from '../shared/protocol.js';
import { PeerSource } from './sources/peerSource.js';
import { saveRoom } from './persistence.js';

/** Ajustes de tiempos del pulsador (los puntos vienen del concurso). */
export const DEFAULT_SETTINGS = {
  lockEarlyBuzz: true,
  scheduledOpenMs: 300,
  decisionWindowMs: 150,
  nearTieMs: 30,
};

const CONTROL_PUSH_MS = 150; // agrupar cambios antes de mandar el estado completo al mando
const now = () => performance.now();

export class HostRoom extends EventTarget {
  #windowTimer = null;
  #openTimer = null;
  #controlPush = null;
  #playKey = null;

  constructor({ code, saved = null }) {
    super();
    this.code = code;
    this.controlSecret = saved?.controlSecret ?? randomSecret();
    this.approvedControls = new Set(saved?.approvedControls ?? []);
    this.pendingControls = new Map(); // controlId → {deviceName}
    this.connectedControls = new Set();

    this.show = saved?.show ?? defaultShow();
    this.roster = new Roster(saved?.players ?? [], {
      teams: this.show.teams,
      teamsLocked: saved?.teamsLocked ?? false,
      teamBonus: saved?.teamBonus ?? {},
    });
    this.runner = new ShowRunner(this.show, saved?.runner);
    this.settings = { ...DEFAULT_SETTINGS, lockEarlyBuzz: this.show.settings?.lockEarlyBuzz ?? true, ...saved?.settings };
    this.game = new QuestionEngine(this.settings);
    this.#playKey = this.runner.playKey;
    this.lastImport = null;

    this.network = { state: 'connecting', message: '' };
    this.rtt = new Map();
    this.sync = new Map(); // playerId → último syncReport del móvil
    this.lastRound = null; // última ronda con pulsaciones, para el modo depuración

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
        onSyncReport: (playerId, report) => {
          this.sync.set(playerId, report);
          this.#changed({ persist: false });
        },
        onLeave: (playerId) => this.#onLeave(playerId),
        onRtt: (playerId, ms) => {
          this.rtt.set(playerId, ms);
          this.#changed({ persist: false });
        },
        onControlHello: (controlId, msg) => this.#onControlHello(controlId, msg),
        onCommand: (controlId, msg) => this.run(msg.action, msg.args),
        onControlLeave: (controlId) => {
          this.connectedControls.delete(controlId);
          this.pendingControls.delete(controlId);
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
    clearTimeout(this.#controlPush);
    this.source.destroy();
  }

  get canStart() {
    return this.roster.connectedCount >= MIN_PLAYERS;
  }

  /** ¿Se está jugando una pregunta de pulsador ahora mismo? */
  get inBuzzerPlay() {
    return this.runner.screen === SCREEN.PLAY && this.runner.section?.type === 'pulsador' && !this.runner.peekScoreboard;
  }

  get pointsForCorrect() {
    return this.runner.section?.points?.[0] ?? this.show.settings?.defaultPoints ?? 1;
  }

  get pointsForWrong() {
    return this.show.settings?.wrongPoints ?? 0;
  }

  /** URL del mando (la clave va tras '#': no viaja a ningún servidor). */
  controlUrl(base) {
    const url = new URL('./control.html', base);
    url.search = `?sala=${this.code}`;
    url.hash = `k=${this.controlSecret}`;
    return url;
  }

  // ------------------------------------------------------------------ Vistas

  /** Jugadores con datos para pintar en la tele. */
  players() {
    return this.roster.list().map((p) => ({
      ...p,
      rtt: p.connected ? (this.rtt.get(p.id) ?? null) : null,
      lock: this.inBuzzerPlay ? (this.game.lockouts.get(p.id) ?? null) : null,
    }));
  }

  /** Estado del pulsador para la tele, con los datos de cada jugador ya resueltos. */
  gameView() {
    const g = this.game;
    const ranking = g.phase === PHASE.RESULT || g.phase === PHASE.OPEN ? g.ranking() : [];
    return {
      phase: g.phase,
      tOpen: g.tOpen,
      judged: g.judged,
      rebound: [...g.lockouts.values()].includes(LOCK.WRONG), // alguien ya falló: el turno es para los demás
      winner: g.winnerId ? this.roster.get(g.winnerId) : null,
      ranking: ranking.map((r) => ({ ...r, player: this.roster.get(r.playerId) })).filter((r) => r.player),
    };
  }

  /** Todo lo que necesita pintar la tele. */
  view() {
    const r = this.runner;
    return {
      code: this.code,
      title: this.show.title,
      screen: r.screen,
      peekScoreboard: r.peekScoreboard,
      sectionIndex: r.sectionIndex,
      sectionCount: this.show.sections.length,
      section: r.section,
      sectionLabel: r.section ? SECTION_TYPES[r.section.type].label : '',
      playable: isPlayable(r.section),
      item: r.item,
      itemIndex: r.itemIndex,
      itemCount: r.itemCount,
      shown: r.shown,
      game: this.inBuzzerPlay ? this.gameView() : null,
      pointsForCorrect: this.pointsForCorrect,
      pointsForWrong: this.pointsForWrong,
      players: this.players(),
      teams: this.roster.teams,
      teamsLocked: this.roster.teamsLocked,
      standings: this.roster.teamStandings(),
      canStart: this.canStart,
      pendingControls: [...this.pendingControls].map(([id, info]) => ({ id, ...info })),
      controlsConnected: this.connectedControls.size,
      lastImport: this.lastImport,
      settings: this.settings,
    };
  }

  /** Datos del modo depuración: relojes de cada jugador y tiempos de la última ronda. */
  debugView() {
    const players = this.roster.list().map((p) => ({ player: p, rtt: this.rtt.get(p.id) ?? null, sync: p.connected ? (this.sync.get(p.id) ?? null) : null }));
    const round = this.lastRound && {
      ...this.lastRound,
      ranking: this.lastRound.ranking.map((r) => ({ ...r, player: this.roster.get(r.playerId) })).filter((r) => r.player),
    };
    return { players, round, settings: this.settings };
  }

  /** Vista para el mando del presentador (incluye respuestas: solo se manda a mandos aprobados). */
  controlView() {
    const v = this.view();
    const pub = (p) => p && { id: p.id, name: p.name, icon: p.icon, color: p.color, teamId: p.teamId };
    return {
      code: v.code,
      network: this.network,
      title: v.title,
      screen: v.screen,
      peekScoreboard: v.peekScoreboard,
      sectionIndex: v.sectionIndex,
      sections: this.show.sections.map((s, index) => ({
        index,
        name: s.name,
        type: s.type,
        label: SECTION_TYPES[s.type].label,
        playable: isPlayable(s),
        items: s.items.length,
      })),
      section: v.section && { name: v.section.name, type: v.section.type, description: v.section.description, points: v.section.points },
      sectionLabel: v.sectionLabel,
      playable: v.playable,
      item: v.item,
      itemIndex: v.itemIndex,
      itemCount: v.itemCount,
      shown: v.shown,
      game: v.game && {
        phase: v.game.phase,
        judged: v.game.judged,
        winner: pub(v.game.winner),
        ranking: v.game.ranking.map((r) => ({ place: r.place, deltaMs: r.deltaMs, reactionMs: r.reactionMs, nearTie: r.nearTie, player: pub(r.player) })),
      },
      pointsForCorrect: v.pointsForCorrect,
      pointsForWrong: v.pointsForWrong,
      players: v.players.map((p) => ({ ...pub(p), score: p.score, connected: p.connected, rtt: p.rtt, lock: p.lock })),
      teams: v.teams,
      teamsLocked: v.teamsLocked,
      standings: v.standings.map((s) => ({ team: s.team, score: s.score, members: s.members.map((m) => m.id) })),
      canStart: v.canStart,
      minPlayers: MIN_PLAYERS,
      pendingControls: v.pendingControls,
      lastImport: v.lastImport,
      settings: v.settings,
    };
  }

  // ------------------------------------------------------------------ Órdenes (teclado de la tele y mando)

  /** @returns {{ok: boolean, error?: string}} */
  run(action, args = {}) {
    const fn = this.#actions[action];
    if (!fn) return { ok: false, error: `Orden desconocida: ${action}` };
    const res = fn(args ?? {});
    if (res === false) return { ok: false, error: 'No se puede hacer ahora.' };
    if (typeof res === 'string') return { ok: false, error: res };
    this.#afterChange();
    return { ok: true };
  }

  #actions = {
    next: () => {
      if (this.runner.screen === SCREEN.SETUP) {
        if (!this.canStart) return `Hacen falta al menos ${MIN_PLAYERS} jugadores conectados.`;
        this.roster.lockTeams(true); // al empezar, los equipos quedan cerrados
      }
      return this.runner.next();
    },
    prev: () => this.runner.prev(),
    nextItem: () => this.runner.nextItem(),
    gotoSection: ({ index }) => this.runner.goToSection(Number(index)),
    endSection: () => this.runner.endSection(),
    scoreboard: () => this.runner.toggleScoreboard(),
    toSetup: () => this.runner.toSetup(),
    showQuestion: () => this.runner.showQuestion(),
    showAnswer: () => this.runner.showAnswer(),

    open: () => {
      if (!this.inBuzzerPlay) return false;
      if (!this.canStart) return `Hacen falta al menos ${MIN_PLAYERS} jugadores conectados.`;
      if (!this.game.open(now())) return false;
      if (this.runner.item?.showOnTv) this.runner.showQuestion(); // al abrir, la pregunta se ve en la tele
      this.#scheduleOpenRepaint();
      return true;
    },
    correct: () => {
      if (!this.inBuzzerPlay) return false;
      const winnerId = this.game.correct();
      if (!winnerId) return false;
      this.roster.adjustScore(winnerId, this.pointsForCorrect);
      return true;
    },
    wrong: () => {
      if (!this.inBuzzerPlay) return false;
      const activeIds = this.roster.list().filter((p) => p.connected).map((p) => p.id);
      const res = this.game.wrong(now(), activeIds);
      if (!res) return false;
      if (this.pointsForWrong) this.roster.adjustScore(res.loserId, this.pointsForWrong);
      if (res.reopened) this.#scheduleOpenRepaint();
      return true;
    },
    restart: () => {
      if (!this.inBuzzerPlay) return false;
      this.#clearTimers();
      this.game.restart();
      return true;
    },
    unlock: ({ playerId }) => this.game.unlock(playerId),

    lockTeams: ({ locked = true }) => {
      if (!this.roster.hasTeams) return 'Este concurso no tiene equipos.';
      this.roster.lockTeams(!!locked);
      return true;
    },
    moveTeam: ({ playerId, teamId }) => !!this.roster.moveToTeam(playerId, teamId),
    adjustScore: ({ playerId, delta }) => this.roster.adjustScore(playerId, Number(delta) || 0) != null,
    adjustTeamBonus: ({ teamId, delta }) => this.roster.adjustTeamBonus(teamId, Number(delta) || 0) != null,
    resetScores: () => {
      this.roster.resetScores();
      return true;
    },
    removePlayer: ({ playerId }) => {
      if (!this.roster.get(playerId)) return false;
      this.source.kick(playerId, { code: ERROR_CODE.REMOVED, message: 'El presentador te ha quitado de la sala.' });
      this.roster.remove(playerId);
      this.rtt.delete(playerId);
      this.sync.delete(playerId);
      this.game.unlock(playerId);
      return true;
    },

    approveControl: ({ controlId }) => {
      if (!this.pendingControls.delete(controlId)) return false;
      this.approvedControls.add(controlId);
      this.connectedControls.add(controlId);
      this.source.sendToControl(controlId, { t: MSG.CONTROL_STATUS, status: 'approved' });
      return true;
    },
    denyControl: ({ controlId }) => {
      if (!this.pendingControls.delete(controlId)) return false;
      this.source.kickControl(controlId, { code: ERROR_CODE.CONTROL_DENIED, message: 'El portátil ha rechazado este mando.' });
      return true;
    },

    updateSettings: (patch) => {
      for (const key of Object.keys(DEFAULT_SETTINGS)) if (key in patch) this.settings[key] = patch[key]; // el motor comparte el objeto
      return true;
    },
  };

  /**
   * Carga un concurso leído de la hoja. Solo en preparación: cambia equipos y empieza desde la portada.
   * @param report {fileName, errors, warnings}
   */
  loadShow(show, report) {
    if (this.runner.screen !== SCREEN.SETUP) return 'Solo se puede cargar un concurso desde la pantalla de preparación.';
    this.show = show;
    this.roster.setTeams(show.teams);
    this.roster.lockTeams(false);
    this.runner = new ShowRunner(show);
    this.settings.lockEarlyBuzz = show.settings.lockEarlyBuzz;
    this.lastImport = { ...report, title: show.title, sections: show.sections.length, teams: show.teams.length };
    this.#afterChange();
    return true;
  }

  /** Informe de una importación fallida (no cambia el concurso). */
  reportImportFailure(report) {
    this.lastImport = { ...report, failed: true };
    this.#changed({ persist: false });
  }

  // ------------------------------------------------------------------ Mensajes de los jugadores

  #onHello(playerId, msg) {
    const res = this.roster.join({ playerId, name: msg.name, color: msg.color, icon: msg.icon, teamId: msg.teamId });
    if (!res.ok) {
      return { ok: false, error: { code: ERROR_CODE.ROOM_FULL, message: `La sala está llena (máximo ${MAX_PLAYERS} jugadores).` } };
    }
    this.#sendWelcome(res);
    this.#afterChange(); // cambian el número de jugadores y los iconos ocupados para todos
    return { ok: true };
  }

  #onProfile(playerId, msg) {
    const res = this.roster.updateProfile(playerId, msg);
    if (!res) return;
    this.#sendWelcome(res);
    this.#afterChange();
  }

  #sendWelcome(res) {
    this.source.sendTo(res.player.id, {
      t: MSG.WELCOME,
      you: publicPlayer(res.player),
      adjusted: { renamed: res.renamed, appearanceChanged: res.appearanceChanged },
    });
  }

  #onBuzz(playerId, msg) {
    if (!this.inBuzzerPlay) {
      // Fuera de una pregunta de pulsador no cuenta (ni bloquea a quien toque el botón en la portada).
      this.source.sendTo(playerId, { t: MSG.BUZZ_ACK, seq: msg.seq, result: 'closed' });
      return;
    }
    const res = this.game.buzz({ playerId, tPress: msg.tPress, tArrival: msg.tArrival, epoch: msg.epoch, meta: msg.meta });
    this.source.sendTo(playerId, { t: MSG.BUZZ_ACK, seq: msg.seq, result: res.result });
    if (res.windowEndsAt != null && !this.#windowTimer) {
      this.#windowTimer = setTimeout(() => this.#closeWindow(), Math.max(0, res.windowEndsAt - now()));
    }
    if (res.result === 'ok' || res.locked) this.#afterChange({ persist: false });
  }

  #closeWindow() {
    this.#windowTimer = null;
    if (!this.game.closeWindow(now())) return;
    this.#afterChange({ persist: false });
    this.dispatchEvent(new Event('decided'));
  }

  #onLeave(playerId) {
    this.roster.setConnected(playerId, false);
    this.rtt.delete(playerId);
    this.sync.delete(playerId);
    this.#afterChange();
  }

  // ------------------------------------------------------------------ Mandos

  #onControlHello(controlId, msg) {
    if (msg.token !== this.controlSecret) {
      return {
        ok: false,
        error: { code: ERROR_CODE.CONTROL_DENIED, message: 'Este enlace de mando no vale para esta sala. Escanea el QR de mando que muestra la tele.' },
      };
    }
    if (this.approvedControls.has(controlId)) {
      this.connectedControls.add(controlId);
      this.source.sendToControl(controlId, { t: MSG.CONTROL_STATUS, status: 'approved' });
      this.#pushControlsNow();
      this.#changed({ persist: false });
      return { ok: true };
    }
    // Alguien del sofá podría escanear el QR: hay que confirmarlo en el portátil.
    this.pendingControls.set(controlId, { deviceName: msg.deviceName || 'Móvil' });
    this.source.sendToControl(controlId, { t: MSG.CONTROL_STATUS, status: 'pending' });
    this.#changed({ persist: false });
    return { pending: true };
  }

  #pushControlsNow() {
    clearTimeout(this.#controlPush);
    this.#controlPush = null;
    if (!this.connectedControls.size) return;
    const msg = { t: MSG.CONTROL_STATE, view: this.controlView() };
    for (const id of this.connectedControls) this.source.sendToControl(id, msg);
  }

  #scheduleControlPush() {
    if (this.#controlPush || !this.connectedControls.size) return;
    this.#controlPush = setTimeout(() => this.#pushControlsNow(), CONTROL_PUSH_MS);
  }

  // ------------------------------------------------------------------ Estado hacia los jugadores

  #stateFor(player) {
    const r = this.runner;
    const g = this.game;
    const play = this.inBuzzerPlay;
    const winner = play && g.winnerId && g.phase === PHASE.RESULT ? this.roster.get(g.winnerId) : null;
    const showSection = r.section && [SCREEN.INTRO, SCREEN.PLAY, SCREEN.SCOREBOARD].includes(r.screen);
    return {
      t: MSG.STATE,
      room: this.code,
      title: this.show.title,
      playerCount: this.roster.connectedCount,
      minPlayers: MIN_PLAYERS,
      taken: this.roster.takenAppearances(player.id),
      teams: this.roster.teams,
      teamsLocked: this.roster.teamsLocked,
      you: publicPlayer(player),
      screen: r.peekScoreboard ? SCREEN.SCOREBOARD : r.screen,
      section: showSection ? { name: r.section.name, label: SECTION_TYPES[r.section.type].label } : null,
      game: play ? playerView(g, player.id, now()) : null,
      winner: winner ? publicPlayer(winner) : null,
    };
  }

  #broadcastState() {
    for (const p of this.roster.list()) if (p.connected) this.source.sendTo(p.id, this.#stateFor(p));
  }

  /** Tras cualquier cambio de juego: si cambió la pregunta, el motor empieza de cero; luego avisar a todos. */
  #afterChange({ persist = true } = {}) {
    const key = this.runner.playKey;
    if (key !== this.#playKey) {
      this.#playKey = key;
      this.#clearTimers();
      this.game.next();
    }
    const ranking = this.game.ranking();
    if (ranking.length) this.lastRound = { qid: this.runner.itemIndex + 1, tOpen: this.game.tOpen, decided: !!this.game.winnerId, ranking };
    this.#broadcastState();
    this.#changed({ persist });
  }

  #scheduleOpenRepaint() {
    // Repintar la tele justo cuando empieza el turno ("Preparados…" → "¡Pulsad!").
    clearTimeout(this.#openTimer);
    this.#openTimer = setTimeout(() => this.#changed({ persist: false }), Math.max(0, this.game.tOpen - now()));
  }

  #clearTimers() {
    clearTimeout(this.#windowTimer);
    clearTimeout(this.#openTimer);
    this.#windowTimer = null;
    this.#openTimer = null;
  }

  #persist() {
    saveRoom({
      code: this.code,
      controlSecret: this.controlSecret,
      approvedControls: [...this.approvedControls],
      show: this.show,
      runner: this.runner.toJSON(),
      players: this.roster.toJSON(),
      teamsLocked: this.roster.teamsLocked,
      teamBonus: Object.fromEntries(this.roster.teamBonus),
      settings: this.settings,
    });
  }

  #changed({ persist = true } = {}) {
    if (persist) this.#persist();
    this.#scheduleControlPush();
    this.dispatchEvent(new Event('change'));
  }
}

const publicPlayer = ({ id, name, color, icon, score, teamId }) => ({ id, name, color, icon, score, teamId });

function randomSecret() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
