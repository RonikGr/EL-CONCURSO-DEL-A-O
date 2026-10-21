// Pantalla del presentador (la que se ve en la tele).
import './host.css';
import QRCode from 'qrcode';
import { $, clear, h } from '../shared/dom.js';
import { getColor, getIcon } from '../shared/appearance.js';
import { generateRoomCode } from '../shared/roomCode.js';
import { MAX_PLAYERS, MIN_PLAYERS } from '../core/players.js';
import { LOCK, PHASE } from '../core/game.js';
import { HostRoom } from './room.js';
import { clearSavedRoom, loadSavedRoom } from './persistence.js';
import { createStage } from './stage.js';
import { openSettingsDialog } from './settingsDialog.js';
import { createDebugPanel } from './debugPanel.js';

// Marca de esta pestaña: si se recarga, se recupera la sala sin preguntar.
const TAB_KEY = 'concurso.host.tab';
const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

const app = $('#app');
let room = null;
let stage = null;
const debug = createDebugPanel();
const cards = new Map(); // playerId → elementos de su tarjeta

const actions = {
  open: () => room?.openTurn(),
  correct: () => room?.markCorrect(),
  wrong: () => room?.markWrong(),
  next: () => room?.nextQuestion(),
  restart: () => room?.restartQuestion(),
};

function boot() {
  const saved = loadSavedRoom();
  if (saved && readTabMark() === saved.code) return startRoom(saved);
  if (saved && saved.players.length) return showRecover(saved);
  startRoom({ code: generateRoomCode() });
}

function showRecover(saved) {
  const minutes = Math.max(1, Math.round((Date.now() - saved.savedAt) / 60000));
  const n = saved.players.length;
  clear(app).append(
    h(
      'main',
      { class: 'recover' },
      h('h1', {}, 'Concurso del año'),
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
  startRoom({ code: generateRoomCode() });
}

function startRoom({ code, players = [], settings = {}, qid = 1 }) {
  writeTabMark(code);
  room = new HostRoom({ code, savedPlayers: players, settings, qid });
  renderShell();
  room.addEventListener('change', render);
  room.start();
  render();
}

// ---------- Estructura fija ----------

function renderShell() {
  cards.clear();
  stage = createStage(actions);
  const joinUrl = playerUrl(room.code);
  const shownUrl = joinUrl.host + joinUrl.pathname.replace(/\/$/, '');

  const qr = h('div', { class: 'qr', role: 'img', 'aria-label': `QR para unirse a la sala ${room.code}` });
  QRCode.toString(joinUrl.href, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' })
    .then((svg) => (qr.innerHTML = svg))
    .catch(() => qr.append('No se pudo generar el QR'));

  clear(app).append(
    h(
      'div',
      { class: 'host-shell' },
      h('header', { class: 'topbar' }, h('h1', {}, 'Concurso del año'), h('span', { class: 'net-pill', id: 'net-pill' })),
      h('div', { class: 'banners', id: 'banners' }),
      h(
        'main',
        { class: 'board' },
        stage.root,
        h(
          'aside',
          { class: 'join-panel', 'aria-label': 'Cómo unirse' },
          h('p', { class: 'join-label' }, 'Únete con el móvil'),
          qr,
          h('p', { class: 'join-url' }, shownUrl),
          h('p', { class: 'join-code', 'aria-label': `Código ${room.code.split('').join(' ')}` }, room.code),
        ),
        h(
          'section',
          { class: 'players-panel', 'aria-label': 'Jugadores' },
          h(
            'div',
            { class: 'players-head' },
            h('h2', {}, 'Jugadores ', h('span', { class: 'players-count', id: 'players-count' })),
            h('p', { class: 'ready-hint', id: 'ready-hint' }),
          ),
          h('div', { class: 'empty', id: 'empty' }, 'Todavía no hay nadie. ¡Escanead el QR!'),
          h('ul', { class: 'player-grid', id: 'player-grid' }),
        ),
      ),
      h(
        'footer',
        { class: 'toolbar' },
        h('span', { class: 'hint' }, 'Teclas: Espacio abrir / siguiente · A acierto · F fallo · R reiniciar · D depuración'),
        h('button', { class: 'btn', onclick: () => debug.toggle(room) }, 'Depuración'),
        h('button', { class: 'btn', onclick: () => openSettingsDialog(room) }, 'Ajustes'),
        h('button', { class: 'btn', onclick: toggleFullscreen }, 'Pantalla completa'),
        h('button', { class: 'btn', onclick: confirmResetScores }, 'Marcadores a 0'),
        h('button', { class: 'btn danger', onclick: confirmNewRoom }, 'Cerrar sala y crear otra'),
      ),
    ),
    stage.overlay,
    debug.root,
  );
}

// ---------- Partes que cambian ----------

function render() {
  if (!room) return;
  renderNetwork();
  stage.render(room);
  renderPlayers();
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
  if (LOCAL_HOSTS.includes(location.hostname)) {
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

function renderPlayers() {
  const players = room.players();
  const connected = players.filter((p) => p.connected).length;
  $('#players-count').textContent = `${connected} conectados · ${players.length}/${MAX_PLAYERS}`;
  $('#empty').hidden = players.length > 0;

  const hint = $('#ready-hint');
  const missing = MIN_PLAYERS - connected;
  hint.hidden = missing <= 0;
  hint.textContent = missing > 0 ? `Falta${missing > 1 ? 'n' : ''} ${missing} para empezar (mínimo ${MIN_PLAYERS})` : '';

  // Puesto de cada uno en la ronda actual (mientras el turno está abierto o se ve el resultado).
  const view = room.gameView();
  const places = new Map(view.phase === PHASE.OPEN || view.phase === PHASE.RESULT ? view.ranking.map((r) => [r.playerId, r.place]) : []);

  // Tarjetas con clave: no se recrean en cada latido, así no se pierde el foco ni el hover.
  const grid = $('#player-grid');
  const seen = new Set();
  for (const p of players) {
    seen.add(p.id);
    let card = cards.get(p.id);
    if (!card) {
      card = createCard(p.id);
      cards.set(p.id, card);
    }
    updateCard(card, p, places.get(p.id));
    grid.append(card.root); // append mueve el nodo: mantiene el orden de llegada
  }
  for (const [id, card] of cards) {
    if (!seen.has(id)) {
      card.root.remove();
      cards.delete(id);
    }
  }
}

function createCard(playerId) {
  const avatar = h('div', { class: 'avatar emoji', 'aria-hidden': 'true' });
  const name = h('div', { class: 'pc-name' });
  const meta = h('span', {});
  const place = h('span', { class: 'pc-place' });
  const score = h('span', { class: 'score', 'aria-live': 'polite' });
  const minus = h('button', { class: 'score-btn', onclick: () => room.adjustScore(playerId, -1) }, '−');
  const plus = h('button', { class: 'score-btn', onclick: () => room.adjustScore(playerId, +1) }, '+');
  const unlock = h('button', { class: 'pc-unlock', onclick: () => room.unlockPlayer(playerId) }, 'Desbloquear');
  const remove = h('button', { class: 'pc-remove', onclick: () => confirmRemove(playerId) }, '✕');
  // Rejilla: avatar | nombre (todo el ancho que necesite) | puntos
  //          avatar | estado · Desbloquear · ✕             | − +
  const root = h(
    'li',
    { class: 'player-card' },
    avatar,
    name,
    h('div', { class: 'pc-meta' }, h('span', { class: 'dot' }), meta, unlock, remove),
    score,
    h('div', { class: 'pc-controls' }, minus, plus),
    place,
  );
  return { root, avatar, name, meta, place, score, minus, plus, unlock, remove };
}

const LOCK_TEXT = { [LOCK.EARLY]: 'Bloqueado · pulsó antes', [LOCK.WRONG]: 'Bloqueado · falló' };

function updateCard(card, p, place) {
  const color = getColor(p.color);
  card.root.style.setProperty('--pc', color.bg);
  card.root.style.setProperty('--pc-fg', color.fg);
  card.root.classList.toggle('offline', !p.connected);
  card.root.classList.toggle('locked', !!p.lock);
  card.avatar.textContent = getIcon(p.icon).glyph;
  card.name.textContent = p.name;
  let status = p.connected ? `Conectado${p.rtt != null ? ` · ${Math.round(p.rtt)} ms` : ''}` : 'Desconectado';
  if (p.lock) status = LOCK_TEXT[p.lock] + (p.connected ? '' : ' · desconectado');
  card.meta.textContent = status;
  card.unlock.hidden = !p.lock;
  card.place.textContent = place ? `${place}º` : '';
  card.place.hidden = !place;
  card.score.textContent = p.score;
  card.minus.setAttribute('aria-label', `Restar un punto a ${p.name}`);
  card.plus.setAttribute('aria-label', `Sumar un punto a ${p.name}`);
  card.remove.setAttribute('aria-label', `Quitar a ${p.name} de la sala`);
  card.remove.title = `Quitar a ${p.name}`;
}

// ---------- Teclado ----------

document.addEventListener('keydown', (e) => {
  if (!room || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
  if (document.querySelector('dialog[open]') || e.target.closest?.('input, textarea, select')) return;
  const phase = room.game.phase;
  switch (e.code) {
    case 'Space':
      e.preventDefault(); // que no "pulse" el botón con foco
      if (phase === PHASE.IDLE) actions.open();
      else if (phase === PHASE.RESULT || phase === PHASE.CLOSED) actions.next();
      break;
    case 'KeyR':
      actions.restart();
      break;
    case 'KeyA':
      if (phase === PHASE.RESULT) actions.correct();
      break;
    case 'KeyF':
      if (phase === PHASE.RESULT) actions.wrong();
      break;
    case 'KeyD':
      debug.toggle(room);
      break;
  }
});

// ---------- Acciones ----------

function confirmRemove(playerId) {
  const p = room.roster.get(playerId);
  if (p && confirm(`¿Quitar a ${p.name} de la sala? Perderá sus puntos.`)) room.removePlayer(playerId);
}

function confirmResetScores() {
  if (confirm('¿Poner todos los marcadores a 0?')) room.resetScores();
}

function confirmNewRoom() {
  if (confirm('¿Cerrar esta sala y crear otra? Los jugadores tendrán que volver a entrar.')) newRoom();
}

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen?.().catch(() => {});
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
