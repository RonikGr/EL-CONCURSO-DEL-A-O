// Pantalla del presentador (la que se ve en la tele).
import './host.css';
import QRCode from 'qrcode';
import { $, clear, h } from '../shared/dom.js';
import { getColor, getIcon } from '../shared/appearance.js';
import { generateRoomCode } from '../shared/roomCode.js';
import { MAX_PLAYERS, MIN_PLAYERS } from '../core/players.js';
import { HostRoom } from './room.js';
import { clearSavedRoom, loadSavedRoom } from './persistence.js';

// Marca de esta pestaña: si se recarga, se recupera la sala sin preguntar.
const TAB_KEY = 'concurso.host.tab';
const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

const app = $('#app');
let room = null;
const cards = new Map(); // playerId → elementos de su tarjeta

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

function startRoom({ code, players = [], settings = {} }) {
  writeTabMark(code);
  room = new HostRoom({ code, savedPlayers: players, settings });
  renderShell();
  room.addEventListener('change', render);
  room.start();
  render();
}

// ---------- Estructura fija ----------

function renderShell() {
  cards.clear();
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
        { class: 'lobby' },
        h(
          'section',
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
        h('span', { class: 'hint' }, 'Consejo: pon esta ventana a pantalla completa en la tele.'),
        h('button', { class: 'btn', onclick: toggleFullscreen }, 'Pantalla completa'),
        h('button', { class: 'btn', onclick: confirmResetScores }, 'Poner marcadores a 0'),
        h('button', { class: 'btn danger', onclick: confirmNewRoom }, 'Cerrar sala y crear otra'),
      ),
    ),
  );
}

// ---------- Partes que cambian ----------

function render() {
  if (!room) return;
  renderNetwork();
  renderPlayers();
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
  pill.textContent = NET_LABEL[state] ?? state;

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
  hint.classList.toggle('ok', missing <= 0);
  hint.textContent = missing > 0 ? `Falta${missing > 1 ? 'n' : ''} ${missing} para empezar (mínimo ${MIN_PLAYERS})` : '¡Todo listo para jugar!';

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
    updateCard(card, p);
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
  const score = h('span', { class: 'score', 'aria-live': 'polite' });
  const minus = h('button', { class: 'score-btn', onclick: () => room.adjustScore(playerId, -1) }, '−');
  const plus = h('button', { class: 'score-btn', onclick: () => room.adjustScore(playerId, +1) }, '+');
  const remove = h('button', { class: 'pc-remove', onclick: () => confirmRemove(playerId) }, '✕');
  const root = h(
    'li',
    { class: 'player-card' },
    avatar,
    h('div', { class: 'pc-main' }, name, h('div', { class: 'pc-meta' }, h('span', { class: 'dot' }), meta)),
    h('div', { class: 'pc-score' }, minus, score, plus),
    remove,
  );
  return { root, avatar, name, meta, score, minus, plus, remove };
}

function updateCard(card, p) {
  const color = getColor(p.color);
  card.root.style.setProperty('--pc', color.bg);
  card.root.style.setProperty('--pc-fg', color.fg);
  card.root.classList.toggle('offline', !p.connected);
  card.avatar.textContent = getIcon(p.icon).glyph;
  card.name.textContent = p.name;
  card.meta.textContent = p.connected ? `Conectado${p.rtt != null ? ` · ${Math.round(p.rtt)} ms` : ''}` : 'Desconectado';
  card.score.textContent = p.score;
  card.minus.setAttribute('aria-label', `Restar un punto a ${p.name}`);
  card.plus.setAttribute('aria-label', `Sumar un punto a ${p.name}`);
  card.remove.setAttribute('aria-label', `Quitar a ${p.name} de la sala`);
  card.remove.title = `Quitar a ${p.name}`;
}

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
