// Pantalla del portátil conectado a la tele: el espectáculo. También se puede manejar con teclado y ratón,
// aunque lo normal es hacerlo desde el mando del presentador (control.html).
import './host.css';
import QRCode from 'qrcode';
import { $, clear, fill, h } from '../shared/dom.js';
import { getColor, getIcon } from '../shared/appearance.js';
import { generateRoomCode } from '../shared/roomCode.js';
import { LOCK, PHASE } from '../core/game.js';
import { SCREEN } from '../core/runner.js';
import { parseShowWorkbook } from '../core/show.js';
import { HostRoom } from './room.js';
import { clearSavedRoom, loadSavedRoom } from './persistence.js';
import { createStage } from './stage.js';
import { createAnswerStage } from './answerStage.js';
import { createFreeStage } from './freeStage.js';
import { APHASE } from '../core/answers.js';
import { coverScreen, finalScreen, introScreen, scoreboardScreen, setupScreen } from './screens.js';
import { openSettingsDialog } from './settingsDialog.js';
import { createDebugPanel } from './debugPanel.js';

// Marca de esta pestaña: si se recarga, se recupera la sala sin preguntar.
const TAB_KEY = 'concurso.host.tab';
const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

const app = $('#app');
let room = null;
let stage = null;
let answerStage = null;
let freeStage = null;
let qrs = null; // {join, joinMini, control}
let lastScreenSignature = null;
const debug = createDebugPanel();
const cards = new Map(); // playerId → elementos de su tarjeta

/** Ejecuta una orden y avisa si no se pudo. */
function run(action, args) {
  const res = room?.run(action, args);
  if (res && !res.ok) toast(res.error);
  return res;
}

const actions = {
  open: () => run('open'),
  correct: () => run('correct'),
  wrong: () => run('wrong'),
  nextItem: () => run('nextItem'),
  restart: () => run('restart'),
  showQuestion: () => run('showQuestion'),
  showAnswer: () => run('showAnswer'),
};

function boot() {
  const saved = loadSavedRoom();
  if (saved && readTabMark() === saved.code) return startRoom(saved);
  if (saved && saved.players.length) return showRecover(saved);
  startRoom(null);
}

function showRecover(saved) {
  const minutes = Math.max(1, Math.round((Date.now() - saved.savedAt) / 60000));
  const n = saved.players.length;
  clear(app).append(
    h(
      'main',
      { class: 'recover' },
      h('h1', {}, saved.show?.title ?? 'Concurso del año'),
      h(
        'p',
        { class: 'lead' },
        'Hay una sala guardada ',
        h('strong', { class: 'code-inline' }, saved.code),
        ` con ${n} ${n === 1 ? 'jugador' : 'jugadores'}, de hace ${minutes} min.`,
      ),
      h(
        'div',
        { class: 'actions' },
        h('button', { class: 'btn primary', autofocus: true, onclick: () => startRoom(saved) }, 'Recuperar sala'),
        h('button', { class: 'btn', onclick: newRoom }, 'Sala nueva'),
      ),
    ),
  );
}

function newRoom() {
  room?.destroy();
  room = null;
  clearSavedRoom();
  startRoom(null);
}

function startRoom(saved) {
  const code = saved?.code ?? generateRoomCode();
  writeTabMark(code);
  room = new HostRoom({ code, saved });
  qrs = makeQrs();
  renderShell();
  room.addEventListener('change', render);
  room.start();
  render();
}

function makeQrs() {
  const joinUrl = playerUrl(room.code);
  const qr = (url, label) => {
    const el = h('div', { class: 'qr', role: 'img', 'aria-label': label });
    QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' })
      .then((svg) => (el.innerHTML = svg))
      .catch(() => el.append('No se pudo generar el QR'));
    return el;
  };
  return {
    joinUrlText: joinUrl.host + joinUrl.pathname.replace(/\/$/, ''),
    join: qr(joinUrl.href, `QR para unirse a la sala ${room.code}`),
    joinMini: qr(joinUrl.href, `QR para unirse a la sala ${room.code}`),
    control: qr(room.controlUrl(location.href).href, 'QR del mando del presentador'),
  };
}

// ---------- Estructura fija ----------

function renderShell() {
  cards.clear();
  lastScreenSignature = null;
  stage = createStage();
  answerStage = createAnswerStage();
  freeStage = createFreeStage();

  clear(app).append(
    h(
      'div',
      { class: 'host-shell' },
      h(
        'header',
        { class: 'topbar' },
        h('h1', { id: 'show-title' }),
        h('div', { class: 'join-chip', id: 'join-chip' }, qrs.joinMini, h('span', {}, h('small', {}, 'Únete · '), h('strong', { id: 'chip-code' }, room.code))),
        h('span', { class: 'net-pill', id: 'net-pill' }),
      ),
      h('div', { class: 'banners', id: 'banners' }),
      h('main', { class: 'screen-area', id: 'screen' }),
      h(
        'section',
        { class: 'players-panel', id: 'players-panel', 'aria-label': 'Jugadores' },
        h('ul', { class: 'player-grid', id: 'player-grid' }),
      ),
      h(
        'footer',
        { class: 'toolbar' },
        h('span', { class: 'hint' }, 'Espacio · ← → · P pregunta · V respuesta · A acierto · F fallo · R reiniciar · M marcador · D depuración'),
        h('button', { class: 'btn', onclick: () => debug.toggle(room) }, 'Depuración'),
        h('button', { class: 'btn', onclick: () => openSettingsDialog(room) }, 'Ajustes'),
        h('button', { class: 'btn', onclick: toggleFullscreen }, 'Pantalla completa'),
        h('button', { class: 'btn', onclick: confirmResetScores }, 'Marcadores a 0'),
        h('button', { class: 'btn danger', onclick: confirmNewRoom }, 'Cerrar sala y crear otra'),
      ),
    ),
    stage.overlay,
    debug.root,
    h('div', { class: 'approve-overlay', id: 'approve', hidden: true }),
    h('div', { class: 'host-toast', id: 'toast', role: 'status', hidden: true }),
  );
}

// ---------- Partes que cambian ----------

function render() {
  if (!room) return;
  const view = room.view();
  $('#show-title').textContent = view.title;
  $('#join-chip').hidden = view.screen === SCREEN.SETUP;
  // Durante el espectáculo la tele no enseña controles (ver CSS .show-mode); en preparación, sí.
  document.body.classList.toggle('show-mode', view.screen !== SCREEN.SETUP);
  renderNetwork(view);
  renderScreen(view);
  renderPlayers(view);
  renderApproval(view);
  debug.render(room);
}

const NET_LABEL = {
  connecting: 'Conectando…',
  ready: 'Sala abierta',
  'id-busy': 'Recuperando sala…',
  'signaling-lost': 'Sin servidor de enlace',
  fatal: 'Error',
};

function renderNetwork() {
  const { state, message } = room.network;
  const pill = $('#net-pill');
  pill.dataset.state = state;
  pill.textContent = `Sala ${room.code} · ${NET_LABEL[state] ?? state}`;

  const banners = [];
  if (LOCAL_HOSTS.includes(location.hostname) && room.runner.screen === SCREEN.SETUP) {
    banners.push(
      h(
        'div',
        { class: 'banner' },
        'Estás usando "localhost": los móviles no podrán abrir el QR. Abre esta página con la dirección "Network" que muestra Vite (https://192.168.…:5173/host.html).',
      ),
    );
  }
  if (state === 'fatal') {
    banners.push(h('div', { class: 'banner error' }, h('span', {}, message), h('button', { class: 'btn', onclick: newRoom }, 'Sala nueva')));
  } else if (message) {
    banners.push(h('div', { class: 'banner' }, message));
  }
  $('#banners').replaceChildren(...banners);
}

/**
 * Repinta la pantalla solo si cambió algo visible (no con cada latido): así las animaciones de entrada
 * no se repiten y no se pierde el foco.
 */
function renderScreen(view) {
  const t = performance.now();
  const visible = {
    ...view,
    players: view.players.map(({ rtt, ...p }) => p),
    settings: null,
    // La apertura programada no cambia ningún dato: hay que repintar igualmente cuando llega.
    started: [
      view.game && t >= view.game.tOpen,
      view.answer && view.answer.tOpen != null && t >= view.answer.tOpen,
      view.answer && view.answer.tGreen != null && t >= view.answer.tGreen, // Reflejos: rojo → verde
    ],
  };
  const signature = JSON.stringify(visible);
  if (signature === lastScreenSignature) return;
  lastScreenSignature = signature;

  // Antes de pintar, se limpia todo lo de la pantalla anterior (el ganador a pantalla completa del pulsador,
  // relojes y cuentas atrás): la pantalla que toque ahora vuelve a poner lo suyo. Si no, al saltar de sección
  // se quedaba encima el ganador de la pregunta anterior.
  stage.stop();
  answerStage.stop();
  freeStage.stop();

  const screen = $('#screen');
  screen.dataset.screen = view.peekScoreboard ? 'scoreboard' : view.screen;
  if (view.peekScoreboard) return fill(screen, scoreboardScreen(view));

  switch (view.screen) {
    case SCREEN.SETUP:
      return fill(
        screen,
        setupScreen(view, {
          joinQr: qrs.join,
          controlQr: qrs.control,
          joinUrlText: qrs.joinUrlText,
          onFile: importFile,
          onStart: () => run('next'),
          onLockTeams: (locked) => run('lockTeams', { locked }),
          onMoveTeam: (playerId, teamId) => run('moveTeam', { playerId, teamId }),
        }),
      );
    case SCREEN.COVER:
      return fill(screen, coverScreen(view));
    case SCREEN.INTRO:
      return fill(screen, introScreen(view));
    case SCREEN.PLAY:
      if (view.free) {
        freeStage.render(view);
        if (freeStage.root.parentNode !== screen) fill(screen, freeStage.root);
        return;
      }
      if (view.answer) {
        answerStage.render(view);
        if (answerStage.root.parentNode !== screen) fill(screen, answerStage.root);
        return;
      }
      if (view.game) {
        stage.render(view);
        if (stage.root.parentNode !== screen) fill(screen, stage.root);
        return;
      }
      return fill(screen, introScreen(view));
    case SCREEN.SCOREBOARD:
      return fill(screen, scoreboardScreen(view, { title: `Marcador tras «${view.section?.name ?? ''}»` }));
    case SCREEN.FINAL:
      return fill(screen, finalScreen(view));
  }
}

function renderPlayers(view) {
  const panel = $('#players-panel');
  panel.hidden = !(view.screen === SCREEN.PLAY && (view.game || view.answer) && !view.peekScoreboard);
  if (panel.hidden) return;

  // Puesto de cada uno en la ronda actual (mientras el turno está abierto o se ve el resultado).
  const game = view.game;
  const places = new Map(game && (game.phase === PHASE.OPEN || game.phase === PHASE.RESULT) ? game.ranking.map((r) => [r.playerId, r.place]) : []);
  // En las secciones de respuestas: quién ha respondido ya (sin decir qué).
  const answer = view.answer;
  const answering = answer && (answer.phase === APHASE.OPEN || answer.phase === APHASE.CLOSED);
  const answered = new Set(answering ? answer.answeredIds : []);
  const eligible = new Set(answering ? answer.eligibleIds : []);

  // Tarjetas con clave: no se recrean en cada latido, así no se pierde el foco ni el hover.
  const grid = $('#player-grid');
  const seen = new Set();
  for (const p of view.players) {
    seen.add(p.id);
    let card = cards.get(p.id);
    if (!card) {
      card = createCard();
      cards.set(p.id, card);
    }
    updateCard(card, p, places.get(p.id), answering && eligible.has(p.id) ? answered.has(p.id) : null);
    grid.append(card.root); // append mueve el nodo: mantiene el orden de llegada
  }
  for (const [id, card] of cards) {
    if (!seen.has(id)) {
      card.root.remove();
      cards.delete(id);
    }
  }
}

// Tarjetas de la tele: solo información. Puntos, desbloquear y quitar se hacen desde el mando.
function createCard() {
  const avatar = h('div', { class: 'avatar emoji', 'aria-hidden': 'true' });
  const name = h('div', { class: 'pc-name' });
  const meta = h('span', {});
  const place = h('span', { class: 'pc-place' });
  const score = h('span', { class: 'score', 'aria-live': 'polite' });
  // Rejilla: avatar | nombre (todo el ancho que necesite) | puntos
  //          avatar | estado                               |
  const root = h(
    'li',
    { class: 'player-card' },
    avatar,
    name,
    h('div', { class: 'pc-meta' }, h('span', { class: 'dot' }), meta),
    score,
    place,
  );
  return { root, avatar, name, meta, place, score };
}

const LOCK_TEXT = { [LOCK.EARLY]: 'Bloqueado · pulsó antes', [LOCK.WRONG]: 'Bloqueado · falló' };

/** @param hasAnswered true/false en una pregunta de respuestas abierta; null si no aplica */
function updateCard(card, p, place, hasAnswered = null) {
  const color = getColor(p.color);
  card.root.style.setProperty('--pc', color.bg);
  card.root.style.setProperty('--pc-fg', color.fg);
  card.root.classList.toggle('offline', !p.connected);
  card.root.classList.toggle('locked', !!p.lock);
  card.avatar.textContent = getIcon(p.icon).glyph;
  card.name.textContent = p.name;
  let status = p.connected ? `Conectado${p.rtt != null ? ` · ${Math.round(p.rtt)} ms` : ''}` : 'Desconectado';
  if (p.lock) status = LOCK_TEXT[p.lock] + (p.connected ? '' : ' · desconectado');
  if (hasAnswered != null) status = hasAnswered ? '✓ Ha respondido' : 'Pensando…';
  card.meta.textContent = status;
  card.root.classList.toggle('answered', hasAnswered === true);
  card.place.textContent = place ? `${place}º` : '';
  card.place.hidden = !place;
  card.score.textContent = p.score;
}

/** Un móvil pide ser el mando: se confirma aquí (Enter) o se rechaza (Esc). */
function renderApproval(view) {
  const box = $('#approve');
  const pending = view.pendingControls[0];
  box.hidden = !pending;
  if (!pending) return;
  fill(
    box,
    h(
      'div',
      { class: 'approve-card', role: 'alertdialog', 'aria-label': 'Nuevo mando' },
      h('h2', {}, '¿Permitir este mando?'),
      h('p', {}, `«${pending.deviceName}» quiere ser el mando del presentador. Solo acéptalo si es tu móvil.`),
      h(
        'div',
        { class: 'stage-actions' },
        h('button', { class: 'btn primary huge', onclick: () => run('approveControl', { controlId: pending.id }) }, 'Permitir ', h('kbd', {}, 'Enter')),
        h('button', { class: 'btn huge', onclick: () => run('denyControl', { controlId: pending.id }) }, 'Rechazar ', h('kbd', {}, 'Esc')),
      ),
    ),
  );
}

// ---------- Importar el concurso ----------

async function importFile(file) {
  if (!room) return;
  try {
    const { default: readXlsxFile } = await import('read-excel-file/browser');
    const sheets = await readXlsxFile(file);
    const { show, errors, warnings } = parseShowWorkbook(sheets);
    const report = { fileName: file.name, errors, warnings };
    if (errors.length) return room.reportImportFailure(report);
    const res = room.loadShow(show, report);
    if (res !== true) toast(res);
  } catch (e) {
    console.error(e);
    room.reportImportFailure({ fileName: file.name, errors: [{ sheet: 'Archivo', row: null, message: 'No se pudo leer: ¿es un .xlsx?' }], warnings: [] });
  }
}

addEventListener('dragover', (e) => {
  if (room?.runner.screen === SCREEN.SETUP && e.dataTransfer?.types.includes('Files')) e.preventDefault();
});
addEventListener('drop', (e) => {
  if (room?.runner.screen !== SCREEN.SETUP) return;
  const file = e.dataTransfer?.files?.[0];
  if (!file) return;
  e.preventDefault();
  importFile(file);
});

// ---------- Teclado ----------

document.addEventListener('keydown', (e) => {
  if (!room || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
  if (document.querySelector('dialog[open]') || e.target.closest?.('input, textarea, select')) return;

  const pending = room.view().pendingControls[0];
  if (pending && (e.key === 'Enter' || e.key === 'Escape')) {
    e.preventDefault();
    run(e.key === 'Enter' ? 'approveControl' : 'denyControl', { controlId: pending.id });
    return;
  }

  const screen = room.runner.screen;
  const phase = room.inBuzzerPlay ? room.game.phase : null;
  const answerPhase = room.inAnswerPlay ? room.answerRound.phase : null;
  switch (e.code) {
    case 'Space':
      e.preventDefault(); // que no "pulse" el botón con foco
      if (answerPhase) {
        const next = { ready: 'openAnswers', open: 'closeAnswers', closed: 'reveal', revealed: 'nextItem' }[answerPhase];
        run(next);
      } else if (phase === PHASE.IDLE) actions.open();
      else if (phase === PHASE.RESULT || phase === PHASE.CLOSED) actions.nextItem();
      else if (phase == null && screen !== SCREEN.FINAL) run('next');
      break;
    case 'ArrowRight':
      run('next');
      break;
    case 'ArrowLeft':
      run('prev');
      break;
    case 'KeyP':
      actions.showQuestion();
      break;
    case 'KeyV':
      actions.showAnswer();
      break;
    case 'KeyR':
      if (phase || answerPhase || room.inFreePlay) actions.restart();
      break;
    case 'KeyA':
      if (phase === PHASE.RESULT) actions.correct();
      break;
    case 'KeyF':
      if (phase === PHASE.RESULT) actions.wrong();
      break;
    case 'KeyM':
      run('scoreboard');
      break;
    case 'KeyD':
      debug.toggle(room);
      break;
  }
});

// ---------- Ratón durante el espectáculo ----------

// La barra de herramientas y el cursor aparecen solo si se mueve el ratón (como en un reproductor de vídeo).
let mouseTimer = null;
addEventListener('mousemove', () => {
  document.body.classList.add('mouse-active');
  clearTimeout(mouseTimer);
  mouseTimer = setTimeout(() => document.body.classList.remove('mouse-active'), 3000);
});

// ---------- Acciones ----------

function confirmResetScores() {
  if (confirm('¿Poner todos los marcadores a 0?')) run('resetScores');
}

function confirmNewRoom() {
  if (confirm('¿Cerrar esta sala y crear otra? Los jugadores tendrán que volver a entrar y el mando, emparejarse de nuevo.')) newRoom();
}

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen?.().catch(() => {});
}

let toastTimer = null;
function toast(text) {
  const el = $('#toast');
  if (!el || !text) return;
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 4000);
}

// ---------- Utilidades ----------

function playerUrl(code) {
  // index.html está junto a host.html, también en GitHub Pages bajo /<repo>/.
  const url = new URL('./', location.href);
  url.search = `?sala=${code}`;
  return url;
}

function readTabMark() {
  try {
    return sessionStorage.getItem(TAB_KEY);
  } catch {
    return null;
  }
}

function writeTabMark(code) {
  try {
    sessionStorage.setItem(TAB_KEY, code);
  } catch {
    // sin sessionStorage solo se pierde la recuperación automática
  }
}

// Liberar el ID de la sala en el servidor cuanto antes para que la recarga lo recupere rápido.
addEventListener('pagehide', () => room?.destroy());
// Si el navegador restaura la página desde su caché (atrás/adelante), la sala ya está cerrada: recargar.
addEventListener('pageshow', (e) => {
  if (e.persisted) location.reload();
});

boot();
