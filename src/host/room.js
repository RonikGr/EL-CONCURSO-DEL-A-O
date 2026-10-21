// Controlador del portátil: une el concurso (show + runner), los jugadores (roster), el motor del pulsador,
// los mandos del presentador, las conexiones y la persistencia. La tele escucha 'change' (repintar) y
// 'decided' (hay ganador); el mando recibe `controlState` y manda órdenes que acaban en `run()`.
import { MAX_PLAYERS, MIN_PLAYERS, Roster } from '../core/players.js';
import { LOCK, PHASE, QuestionEngine, playerView } from '../core/game.js';
import { SCREEN, ShowRunner, isPlayable } from '../core/runner.js';
import { DEFAULT_SETTINGS as SHOW_DEFAULTS, SECTION_TYPES, defaultShow } from '../core/show.js';
import {
  ANSWER_RESULT,
  ANSWER_TYPES,
  APHASE,
  AnswerRound,
  GREEN_MAX_MS,
  GREEN_MIN_MS,
  JokerBank,
  buildQuestion,
  isChoice,
  isTiming,
} from '../core/answers.js';
import { ERROR_CODE, MSG } from '../shared/protocol.js';
import { FPHASE, FreeRound } from '../core/free.js';
import { PeerSource } from './sources/peerSource.js';
import { saveRoom } from './persistence.js';
import { sectionEnv } from '../shared/environments.js';

/** Ajustes de tiempos del pulsador y del sonido de la tele (los puntos vienen del concurso). */
export const DEFAULT_SETTINGS = {
  lockEarlyBuzz: true,
  scheduledOpenMs: 300,
  countdownSec: 3, // cuenta atrás 3-2-1 antes de cada pregunta (pulsador y respuestas)
  decisionWindowMs: 150,
  nearTieMs: 30,
  musicOn: true,
  sfxOn: true,
  volume: 70,
};

const CONTROL_PUSH_MS = 150; // agrupar cambios antes de mandar el estado completo al mando
const ANSWER_GRACE_MS = 500; // tras el final, se espera un poco a respuestas dadas a tiempo que aún viajan
const now = () => performance.now();

export class HostRoom extends EventTarget {
  #windowTimer = null;
  #openTimer = null;
  #answerTimer = null;
  #greenTimer = null;
  #controlPush = null;
  #playKey = null;
  #roundSeq = 0;

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
    this.jokers = new JokerBank(this.show.settings?.jokers ?? SHOW_DEFAULTS.jokers, saved?.jokersUsed ?? {});
    this.itemResults = saved?.itemResults ?? {}; // playKey → resultado ya puntuado de una pregunta de respuestas
    this.answerRound = null;
    this.freeRound = null; // sección Libre: la prueba actual
    this.duelPick = []; // Duelo de reflejos: los dos que juegan (se mantiene entre rondas)
    this.#playKey = this.runner.playKey;
    this.#syncAnswerRound();
    this.#syncFreeRound();
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
        onAnswer: (playerId, msg) => this.#onAnswer(playerId, msg),
        onJoker: (playerId, msg) => this.#onJoker(playerId, msg),
        onFreeCount: (playerId, msg) => this.#onFreeCount(playerId, msg),
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

  /** ¿Se está jugando una pregunta de una sección de respuestas (Test, votación…)? */
  get inAnswerPlay() {
    return this.runner.screen === SCREEN.PLAY && ANSWER_TYPES.has(this.runner.section?.type) && !this.runner.peekScoreboard && !!this.answerRound;
  }

  /** ¿Se está jugando una prueba de la sección Libre? */
  get inFreePlay() {
    return this.runner.screen === SCREEN.PLAY && this.runner.section?.type === 'libre' && !this.runner.peekScoreboard && !!this.freeRound;
  }

  /** Dueño de los comodines de un jugador: su equipo, o él mismo si no hay equipos (o aún no tiene). */
  ownerOf = (playerId) => (this.roster.hasTeams ? (this.roster.get(playerId)?.teamId ?? playerId) : playerId);

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

  /** Pregunta de respuestas para la tele (sin la solución hasta revelarla). */
  answerView({ forControl = false } = {}) {
    const r = this.answerRound;
    const q = r.question;
    const revealed = r.phase === APHASE.REVEALED;
    const pub = (id) => {
      const p = this.roster.get(id);
      return p ? publicPlayer(p) : { id, name: '¿?', color: 'gris', icon: 'zorro', score: 0, teamId: null };
    };
    const showCounts = revealed || forControl;
    return {
      roundId: r.roundId, // la tele lo usa para no repetir el suspense de un revelado ya visto
      kind: q.kind,
      label: SECTION_TYPES[q.kind].label,
      phase: r.phase,
      text: q.text,
      image: q.image,
      unit: q.unit,
      noOver: q.noOver,
      options: q.options,
      seconds: q.seconds ?? null,
      target: q.target ?? null,
      mode: q.mode ?? null,
      hideAfter: q.hideAfter ?? null,
      round: q.round ?? null,
      rounds: q.rounds ?? null,
      duel: !!q.duel,
      duelPick: q.duel ? this.duelPick.map(pub) : [],
      tGreen: r.tGreen,
      candidates: r.candidates.map(pub),
      subject: q.subjectId ? pub(q.subjectId) : q.subjectName ? { name: q.subjectName } : null,
      tOpen: r.tOpen,
      deadline: r.deadline,
      answeredIds: [...r.answers.keys()],
      eligibleIds: [...r.eligible],
      counts: showCounts ? r.counts() : null,
      correct: revealed || forControl ? q.correct : null,
      points: q.points,
      results: revealed
        ? {
            points: r.results.points,
            fooled: r.results.fooled ?? null,
            winners: (r.results.winners ?? []).map(pub),
            entries: r.results.entries.map((e) => ({ ...e, player: pub(e.playerId) })),
          }
        : null,
      // Solo el mando ve qué ha respondido cada uno antes de revelar.
      answers: forControl ? [...r.answers].map(([id, a]) => ({ player: pub(id), value: a.value })) : null,
    };
  }

  /** Prueba de la sección Libre (para la tele y el mando). */
  freeView({ forControl = false } = {}) {
    const r = this.freeRound;
    const t = now();
    const who = (id) => {
      if (r.byTeams) {
        const team = this.roster.team(id);
        return { id, name: team?.name ?? '¿?', color: team?.color ?? 'gris', icon: null, isTeam: true };
      }
      const p = this.roster.get(id);
      return { id, name: p?.name ?? '¿?', color: p?.color ?? 'gris', icon: p?.icon ?? null, isTeam: false };
    };
    const pool = r.byTeams ? this.roster.teams.map((tm) => tm.id) : this.roster.list().map((p) => p.id);
    return {
      roundId: r.roundId,
      title: r.item.title,
      description: r.item.description,
      tool: r.tool,
      byTeams: r.byTeams,
      points: r.item.points,
      phase: r.phase,
      tStart: r.tStart,
      tStop: r.tStop,
      participants: r.participants.map((id) => ({
        ...who(id),
        out: id in r.out ? r.out[id] : null,
        count: r.counts[id] ?? 0,
      })),
      ranking: r.ranking(t).map((row) => ({ ...row, who: who(row.id) })),
      winners: r.winners.map(who),
      awarded: r.points,
      // Solo el mando: a quién se puede elegir y qué ganador propone la herramienta.
      pool: forControl ? pool.map(who) : null,
      suggestion: forControl ? r.suggestion(t) : null,
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
      // Lista para la introducción del concurso en la tele
      sections: this.show.sections.map((s, i) => ({ name: s.name, label: SECTION_TYPES[s.type].label, env: sectionEnv(s, i) })),
      section: r.section,
      sectionLabel: r.section ? SECTION_TYPES[r.section.type].label : '',
      playable: isPlayable(r.section),
      item: r.item,
      itemIndex: r.itemIndex,
      itemCount: r.itemCount,
      shown: r.shown,
      game: this.inBuzzerPlay ? this.gameView() : null,
      answer: this.inAnswerPlay ? this.answerView() : null,
      free: this.inFreePlay ? this.freeView() : null,
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
      section: v.section && {
        name: v.section.name,
        type: v.section.type,
        description: v.section.description,
        points: v.section.points,
        env: sectionEnv(v.section, v.sectionIndex),
      },
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
      answer: this.inAnswerPlay ? this.answerView({ forControl: true }) : null,
      free: this.inFreePlay ? this.freeView({ forControl: true }) : null,
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
      if (this.inAnswerPlay) return this.#restartAnswerRound();
      if (this.inFreePlay) return this.#restartFreeRound();
      if (!this.inBuzzerPlay) return false;
      this.#clearTimers();
      this.game.restart();
      return true;
    },

    openAnswers: () => {
      if (!this.inAnswerPlay) return false;
      if (!this.canStart) return `Hacen falta al menos ${MIN_PLAYERS} jugadores conectados.`;
      const q = this.answerRound.question;
      let eligibleIds = this.roster.list().filter((p) => p.connected).map((p) => p.id);
      if (q.duel) {
        eligibleIds = this.duelPick.filter((id) => eligibleIds.includes(id));
        if (eligibleIds.length !== 2) return 'Elige a los dos jugadores del duelo (y que estén conectados).';
      }
      const greenDelayMs = GREEN_MIN_MS + Math.random() * (GREEN_MAX_MS - GREEN_MIN_MS);
      if (!this.answerRound.open({ now: now(), eligibleIds, scheduledOpenMs: this.settings.scheduledOpenMs, greenDelayMs, countdownMs: this.settings.countdownSec * 1000 })) return false;
      if (!this.answerRound.eligible.size) return 'No hay nadie que pueda responder a esta pregunta.';
      const r = this.answerRound;
      // Reflejos: repintar la tele justo al ponerse verde (los móviles cambian solos con su reloj sincronizado).
      clearTimeout(this.#greenTimer);
      if (r.tGreen != null) this.#greenTimer = setTimeout(() => this.#changed({ persist: false }), Math.max(0, r.tGreen - now()));
      clearTimeout(this.#answerTimer);
      this.#answerTimer = setTimeout(() => this.#closeAnswers(r), r.deadline + ANSWER_GRACE_MS - now());
      // Repintar la tele al empezar (para que salgan las opciones a la vez que en los móviles).
      clearTimeout(this.#openTimer);
      this.#openTimer = setTimeout(() => this.#changed({ persist: false }), Math.max(0, r.tOpen - now()));
      return true;
    },
    freeParticipants: ({ ids = '' }) => this.inFreePlay && this.freeRound.setParticipants(String(ids).split(',').filter(Boolean)),
    freeStart: () => this.inFreePlay && this.freeRound.start(now()),
    freeOut: ({ id }) => this.inFreePlay && this.freeRound.eliminate(id, now()),
    freeRevive: ({ id }) => this.inFreePlay && this.freeRound.revive(id),
    freeCount: ({ id, delta }) => this.inFreePlay && this.freeRound.count(id, Number(delta) || 0),
    freeStop: () => this.inFreePlay && this.freeRound.stop(now()),
    freeAward: ({ ids = '' }) => {
      if (!this.inFreePlay) return false;
      const r = this.freeRound;
      const points = r.award(String(ids).split(',').filter(Boolean), now());
      if (!points) return 'Elige al menos un ganador.';
      for (const [id, pts] of Object.entries(points)) {
        if (r.byTeams) this.roster.adjustTeamBonus(id, pts);
        else this.roster.adjustScore(id, pts);
      }
      this.itemResults[this.runner.playKey] = { free: r.toJSON(), byTeams: r.byTeams };
      return true;
    },
    setDuel: ({ a, b }) => {
      if (!this.inAnswerPlay || !this.answerRound.question.duel) return false;
      if (!a || !b || a === b || !this.roster.get(a) || !this.roster.get(b)) return 'Elige a dos jugadores distintos.';
      this.duelPick = [a, b];
      return true;
    },
    closeAnswers: () => {
      if (!this.inAnswerPlay || !this.answerRound.close()) return false;
      clearTimeout(this.#answerTimer);
      return true;
    },
    reveal: () => {
      if (!this.inAnswerPlay) return false;
      const r = this.answerRound;
      if (!r.reveal({ ownerOf: this.ownerOf })) return false;
      clearTimeout(this.#answerTimer);
      for (const [id, pts] of Object.entries(r.results.points)) this.roster.adjustScore(id, pts);
      this.itemResults[this.runner.playKey] = {
        answers: [...r.answers],
        candidates: r.candidates,
        eligible: [...r.eligible],
        results: r.results,
        jokers: [...r.jokers].map(([owner, kinds]) => [owner, [...kinds]]),
        removed: [...r.removed],
      };
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
      // Partida nueva: marcadores, comodines y preguntas ya puntuadas.
      this.roster.resetScores();
      this.jokers.reset();
      this.itemResults = {};
      this.#syncAnswerRound();
      this.#syncFreeRound();
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
    this.jokers = new JokerBank(show.settings.jokers, {});
    this.itemResults = {};
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

  #onAnswer(playerId, msg) {
    const r = this.answerRound;
    const ack = (result) => this.source.sendTo(playerId, { t: MSG.ANSWER_ACK, seq: msg.seq, result });
    if (!this.inAnswerPlay || msg.roundId !== r.roundId) return ack(ANSWER_RESULT.CLOSED);
    const result = r.answer(playerId, msg.value, { tPress: msg.tPress });
    ack(result);
    // En Reflejos, pulsar en rojo queda registrado (eliminado); en el Contador, pulsar en la cuenta atrás no.
    if (!r.answers.has(playerId) || (result !== ANSWER_RESULT.OK && result !== ANSWER_RESULT.EARLY)) return;
    // En cuanto han respondido todos, se cierra (no hace falta esperar al reloj).
    const connected = new Set(this.roster.list().filter((p) => p.connected).map((p) => p.id));
    if (r.allAnswered(connected)) this.#closeAnswers(r);
    else this.#afterChange({ persist: false });
  }

  #onJoker(playerId, msg) {
    const r = this.answerRound;
    const ack = (result, message) => this.source.sendTo(playerId, { t: MSG.ANSWER_ACK, seq: msg.seq, result, message });
    if (!this.inAnswerPlay || msg.roundId !== r.roundId) return ack('closed', 'Ahora no se pueden usar comodines.');
    const owner = this.ownerOf(playerId);
    const blocker = r.jokerBlocker(owner, msg.kind, playerId);
    if (blocker) return ack('denied', blocker);
    if (!this.jokers.use(owner, msg.kind)) return ack('denied', this.roster.hasTeams ? 'A tu equipo no le quedan comodines de ese tipo.' : 'No te quedan comodines de ese tipo.');
    r.activateJoker(owner, msg.kind);
    ack('ok');
    this.#afterChange(); // se guarda: el comodín ya está gastado
  }

  /** Libre con contador: el móvil del concursante (uno por equipo) suma o resta. */
  #onFreeCount(playerId, msg) {
    const r = this.freeRound;
    const ack = (result, message) => this.source.sendTo(playerId, { t: MSG.ANSWER_ACK, seq: msg.seq, result, message });
    if (!this.inFreePlay || msg.roundId !== r.roundId) return ack('closed', 'Ahora no se puede contar.');
    const player = this.roster.get(playerId);
    const result = r.countFrom(playerId, r.byTeams ? player?.teamId : playerId, msg.delta);
    if (result === 'taken') return ack(result, 'Ya lleva la cuenta otro móvil de tu equipo.');
    ack(result);
    if (result === 'ok') this.#afterChange({ persist: false });
  }

  #closeAnswers(round) {
    if (round !== this.answerRound || !round.close()) return;
    clearTimeout(this.#answerTimer);
    this.#afterChange({ persist: false });
  }

  /** Crea la ronda de la pregunta actual (o la recupera ya revelada si ya se puntuó). */
  #syncAnswerRound() {
    const key = this.runner.playKey;
    const section = this.runner.section;
    if (!key || !ANSWER_TYPES.has(section?.type) || !this.runner.item) {
      this.answerRound = null;
      return;
    }
    const question = buildQuestion(section, this.runner.item, { players: this.roster.list(), settings: this.show.settings });
    const round = new AnswerRound(question, { roundId: `${key}#${++this.#roundSeq}` });
    const stored = this.itemResults[key];
    if (stored) {
      round.answers = new Map(stored.answers);
      round.candidates = stored.candidates;
      round.eligible = new Set(stored.eligible);
      round.jokers = new Map(stored.jokers.map(([owner, kinds]) => [owner, new Set(kinds)]));
      round.removed = new Map(stored.removed);
      round.results = stored.results;
      round.phase = APHASE.REVEALED;
    }
    this.answerRound = round;
  }

  /** Al dejar una pregunta sin revelar, sus comodines no cuentan: se devuelven. */
  #leaveAnswerRound() {
    const r = this.answerRound;
    clearTimeout(this.#answerTimer);
    clearTimeout(this.#greenTimer);
    if (r && r.phase !== APHASE.REVEALED) {
      for (const [owner, kinds] of r.jokers) for (const kind of kinds) this.jokers.refund(owner, kind);
    }
  }

  /** Crea la prueba Libre actual (o la recupera si ya dio sus puntos). */
  #syncFreeRound() {
    const key = this.runner.playKey;
    const section = this.runner.section;
    if (!key || section?.type !== 'libre' || !this.runner.item) {
      this.freeRound = null;
      return;
    }
    const stored = this.itemResults[key]?.free;
    this.freeRound = stored ? FreeRound.fromJSON(this.runner.item, stored) : new FreeRound(this.runner.item, { roundId: `${key}#${++this.#roundSeq}` });
  }

  /** "R" en una prueba Libre: quita los puntos que dio y empieza de cero. */
  #restartFreeRound() {
    const key = this.runner.playKey;
    const stored = this.itemResults[key];
    if (stored?.free) {
      for (const [id, pts] of Object.entries(stored.free.points)) {
        if (stored.byTeams) this.roster.adjustTeamBonus(id, -pts);
        else this.roster.adjustScore(id, -pts);
      }
      delete this.itemResults[key];
    }
    this.freeRound = null;
    this.#syncFreeRound();
    return true;
  }

  /** "R" en una pregunta de respuestas: deshace sus puntos, devuelve los comodines y empieza de cero. */
  #restartAnswerRound() {
    const key = this.runner.playKey;
    const stored = this.itemResults[key];
    if (stored) {
      for (const [id, pts] of Object.entries(stored.results.points)) this.roster.adjustScore(id, -pts);
      for (const [owner, kinds] of stored.jokers) for (const kind of kinds) this.jokers.refund(owner, kind);
      delete this.itemResults[key];
    } else {
      this.#leaveAnswerRound();
    }
    clearTimeout(this.#answerTimer);
    this.#syncAnswerRound();
    return true;
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
      section: showSection
        ? {
            name: r.section.name,
            label: SECTION_TYPES[r.section.type].label,
            description: r.section.description,
            points: r.section.points,
            index: r.sectionIndex,
            count: this.show.sections.length,
            env: sectionEnv(r.section, r.sectionIndex), // entorno de Halloween: el fondo del móvil
            // En juego: qué pregunta / prueba / ronda va (0 = sin lista).
            itemIndex: r.screen === SCREEN.PLAY ? r.itemIndex : null,
            itemCount: r.itemCount,
          }
        : null,
      // Marcador para consultarlo sin salir del juego.
      standings: {
        teams: this.roster.teamStandings().map((s) => ({ id: s.team.id, name: s.team.name, color: s.team.color, score: s.score })),
        players: this.roster
          .list()
          .map(publicPlayer)
          .sort((a, b) => b.score - a.score),
      },
      game: play ? playerView(g, player.id, now()) : null,
      winner: winner ? publicPlayer(winner) : null,
      answer: this.inAnswerPlay ? this.#answerViewFor(player) : null,
      free: this.inFreePlay ? this.#freeViewFor(player) : null,
    };
  }

  /** Sección Libre en el móvil: solo saber si le toca y cómo va. */
  #freeViewFor(player) {
    const r = this.freeRound;
    const me = r.byTeams ? player.teamId : player.id;
    const participating = r.participants.includes(me);
    return {
      title: r.item.title,
      tool: r.tool,
      phase: r.phase,
      byTeams: r.byTeams,
      participating,
      out: participating && me in r.out,
      won: r.phase === FPHASE.AWARDED && r.winners.includes(me),
      points: r.item.points,
      roundId: r.roundId,
      // Contador: lleva la cuenta este móvil (o nadie aún) → botones +1/−1; si la lleva otro, su nombre.
      count: participating && r.tool === 'counter' ? (r.counts[me] ?? 0) : null,
      counter:
        participating && r.tool === 'counter'
          ? { mine: !r.counters[me] || r.counters[me] === player.id, by: this.roster.get(r.counters[me])?.name ?? null }
          : null,
    };
  }

  /** Lo que ve un jugador en su móvil en una pregunta de respuestas. */
  #answerViewFor(player) {
    const r = this.answerRound;
    const q = r.question;
    const t = now();
    const own = r.answers.get(player.id);
    const owner = this.ownerOf(player.id);
    const active = r.activeJokers(player.id, this.ownerOf);
    const revealed = r.phase === APHASE.REVEALED;
    const opened = r.phase !== APHASE.READY;

    let result = null;
    if (revealed) {
      const entry = r.results.entries.find((e) => e.playerId === player.id) ?? null;
      const name = (id) => this.roster.get(id)?.name ?? '¿?';
      result = {
        points: r.results.points[player.id] ?? 0,
        correct: entry ? !!entry.correct : null,
        place: entry?.place ?? null,
        diff: entry?.diff ?? null,
        over: !!entry?.over,
        correctLabel: isChoice(q.kind)
          ? q.options[q.correct]
          : q.kind === 'estimacion' || q.kind === 'contador'
            ? `${String(q.correct).replace('.', ',')}${q.unit ? ` ${q.unit}` : ''}`
            : null,
        value: own?.value ?? null,
        early: !!entry?.early,
        winners: (r.results.winners ?? []).map(name),
        fooled: q.subjectId === player.id ? (r.results.fooled ?? 0) : null,
      };
    }

    return {
      kind: q.kind,
      label: SECTION_TYPES[q.kind].label,
      phase: r.phase,
      roundId: r.roundId,
      text: q.text,
      unit: q.unit,
      noOver: q.noOver,
      options: q.options,
      seconds: q.seconds ?? null,
      target: q.target ?? null,
      mode: q.mode ?? null,
      hideAfter: q.hideAfter ?? null,
      round: q.round ?? null,
      rounds: q.rounds ?? null,
      tGreen: r.tGreen,
      greenInMs: r.tGreen != null ? Math.max(0, r.tGreen - t) : null,
      removed: r.removedFor(player.id, this.ownerOf),
      candidates: r.candidates.filter((id) => id !== player.id).map((id) => publicPlayer(this.roster.get(id) ?? { id, name: '¿?' })),
      tOpen: r.tOpen,
      opensInMs: r.tOpen != null ? Math.max(0, r.tOpen - t) : null,
      deadline: r.deadline,
      remainingMs: r.deadline != null ? Math.max(0, r.deadline - t) : null,
      canAnswer: opened && r.eligible.has(player.id),
      isSubject: q.subjectId === player.id,
      // En las de tiempo, el tiempo propio no se enseña hasta revelar (suspense).
      you: { answered: !!own, early: !!own?.early, value: own && (!isTiming(q.kind) || revealed) ? own.value : null },
      jokers: q.kind === 'test' ? { remaining: this.jokers.remaining(owner), active } : null,
      audience: active.includes('audience') && r.phase === APHASE.OPEN ? r.counts() : null,
      result,
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
      this.#leaveAnswerRound();
      this.game.next();
      this.#syncAnswerRound();
      this.#syncFreeRound();
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
    clearTimeout(this.#answerTimer);
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
      jokersUsed: this.jokers.toJSON(),
      itemResults: this.itemResults,
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
