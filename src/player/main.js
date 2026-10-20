// Pantalla del jugador (móvil).
import './player.css';
import { $ } from '../shared/dom.js';
import { COLORS, ICONS, getColor, getIcon } from '../shared/appearance.js';
import { isValidRoomCode, normalizeRoomCode } from '../shared/roomCode.js';
import { ERROR_CODE, MSG, PROTOCOL_VERSION } from '../shared/protocol.js';
import { loadJSON, newId, saveJSON } from '../shared/storage.js';
import { PlayerConnection } from './network.js';
import { createProfilePicker } from './profilePicker.js';

const PROFILE_KEY = 'concurso.player.v1';
// sessionStorage: sala en la que está esta pestaña, para volver a entrar sola si se recarga.
const SESSION_KEY = 'concurso.player.session';

const profile = loadProfile();
let connection = null;
let roomCode = null;
let me = null; // lo que el presentador dice de mí (nombre final, color, icono, puntos)

const joinPicker = createProfilePicker(profile);
const editPicker = createProfilePicker(profile);
$('#join-picker').append(joinPicker.root);
$('#edit-picker').append(editPicker.root);

function init() {
  const fromUrl = normalizeRoomCode(new URLSearchParams(location.search).get('sala'));
  $('#code').value = isValidRoomCode(fromUrl) ? fromUrl : '';

  if (isValidRoomCode(fromUrl) && readSession() === fromUrl && profile.name) {
    join(fromUrl);
  } else {
    showJoin();
  }
}

// ---------- Pantallas ----------

function show(id) {
  for (const s of document.querySelectorAll('.screen')) s.hidden = s.id !== id;
}

function showJoin(error = '') {
  show('screen-join');
  $('#join-error').textContent = error;
  if (!$('#code').value) $('#code').focus();
  else if (!joinPicker.value.name) joinPicker.focusName();
}

function showMessage(title, text, actionLabel = 'Volver', action = () => showJoin()) {
  show('screen-message');
  $('#message-title').textContent = title;
  $('#message-text').textContent = text;
  const btn = $('#message-action');
  btn.textContent = actionLabel;
  btn.onclick = action;
}

$('#join-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const code = normalizeRoomCode($('#code').value);
  if (!isValidRoomCode(code)) return showJoin('El código tiene 4 caracteres, como aparece en la tele.');
  const value = joinPicker.value;
  if (!value.name.trim()) {
    $('#join-error').textContent = 'Escribe tu nombre.';
    return joinPicker.focusName();
  }
  Object.assign(profile, value);
  saveProfile();
  join(code);
});

$('#code').addEventListener('input', (e) => {
  e.target.value = normalizeRoomCode(e.target.value);
});

$('#connecting-cancel').addEventListener('click', leave);

// ---------- Conexión ----------

function join(code) {
  connection?.stop();
  roomCode = code;
  writeSession(code);
  history.replaceState(null, '', `?sala=${code}`);
  $('#connecting-text').textContent = `Conectando con la sala ${code}…`;
  show('screen-connecting');

  connection = new PlayerConnection({
    roomCode: code,
    onOpen: () =>
      connection.send({ t: MSG.HELLO, v: PROTOCOL_VERSION, playerId: profile.playerId, name: profile.name, color: profile.color, icon: profile.icon }),
    onMessage: handleMessage,
    onStatus: handleStatus,
  });
  connection.start();
}

function leave() {
  connection?.stop();
  connection = null;
  me = null;
  writeSession(null);
  showJoin();
}

function handleStatus({ state, message }) {
  const banner = $('#net-banner');
  switch (state) {
    case 'connected':
      banner.hidden = true;
      break;
    case 'reconnecting':
    case 'server-down':
      if (me) {
        banner.hidden = false;
        banner.textContent = state === 'server-down' ? message : 'Reconectando…';
      } else {
        $('#connecting-text').textContent = state === 'server-down' ? message : `Conectando con la sala ${roomCode}…`;
      }
      break;
    case 'not-found':
      writeSession(null);
      showJoin(`No encuentro la sala ${roomCode}. Revisa el código y que el presentador tenga la sala abierta.`);
      break;
    case 'fatal':
      showMessage('No se puede jugar en este navegador', message);
      break;
  }
  document.body.classList.toggle('offline', state !== 'connected');
}

function handleMessage(msg) {
  switch (msg.t) {
    case MSG.WELCOME: {
      const firstTime = !me;
      me = msg.you;
      // Guardar lo que asignó el presentador (color/icono); el nombre se guarda tal como lo escribió la persona.
      profile.color = me.color;
      profile.icon = me.icon;
      saveProfile();
      const notes = [];
      if (msg.adjusted?.renamed) notes.push(`Ya había alguien con ese nombre: aparecerás como «${me.name}».`);
      if (msg.adjusted?.appearanceChanged) notes.push('Esa combinación de color e icono ya estaba cogida: te hemos puesto otra.');
      if (notes.length) toast(notes.join(' ') + ' Puedes cambiarlo en «Cambiar».');
      if (firstTime) show('screen-game');
      renderMe();
      break;
    }
    case MSG.STATE:
      me = msg.you;
      editPicker.setTaken(msg.taken ?? []);
      $('#room-line').textContent = `Sala ${msg.room} · ${msg.playerCount} ${msg.playerCount === 1 ? 'jugador' : 'jugadores'}`;
      renderMe();
      renderBuzzer(msg);
      if ($('#screen-game').hidden) show('screen-game');
      break;
    case MSG.ERROR:
      handleError(msg);
      break;
  }
}

function handleError(msg) {
  connection?.stop();
  connection = null;
  me = null;
  writeSession(null);
  if (msg.code === ERROR_CODE.ROOM_FULL) showMessage('Sala llena', msg.message);
  else if (msg.code === ERROR_CODE.REMOVED) showMessage('Fuera de la sala', msg.message, 'Volver a entrar', () => join(roomCode));
  else if (msg.code === ERROR_CODE.VERSION) showMessage('Versión distinta', msg.message, 'Recargar', () => location.reload());
  else showMessage('Error', msg.message ?? 'Error desconocido.');
}

// ---------- Interfaz del juego ----------

function renderMe() {
  if (!me) return;
  const color = getColor(me.color);
  document.documentElement.style.setProperty('--me', color.bg);
  document.documentElement.style.setProperty('--me-fg', color.fg);
  $('#me-avatar').textContent = getIcon(me.icon).glyph;
  $('#me-name').textContent = me.name;
  $('#me-score').textContent = me.score;
}

function renderBuzzer(state) {
  const buzzer = $('#buzzer');
  buzzer.dataset.state = 'wait';
  $('#buzzer-label').textContent = 'Espera';
  $('#buzzer-sub').textContent =
    state.playerCount < state.minPlayers ? `Esperando jugadores (mínimo ${state.minPlayers})` : 'Esperando al presentador';
}

// El pulsador responde a pointerdown (no a click). En esta fase solo da respuesta visual.
const buzzer = $('#buzzer');
buzzer.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  buzzer.classList.add('pressed');
  setTimeout(() => buzzer.classList.remove('pressed'), 140);
});
buzzer.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('contextmenu', (e) => {
  if (!$('#screen-game').hidden) e.preventDefault();
});

// ---------- Cambiar perfil ----------

const dialog = $('#profile-dialog');
$('#edit-profile').addEventListener('click', () => {
  editPicker.value = { ...profile, color: me?.color ?? profile.color, icon: me?.icon ?? profile.icon };
  dialog.showModal();
});
dialog.addEventListener('close', () => {
  if (dialog.returnValue !== 'save') return;
  const value = editPicker.value;
  Object.assign(profile, value);
  saveProfile();
  connection?.send({ t: MSG.PROFILE, name: value.name, color: value.color, icon: value.icon });
});

// ---------- Utilidades ----------

let toastTimer = null;
function toast(text) {
  const el = $('#toast');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 5000);
}

function loadProfile() {
  const saved = loadJSON(PROFILE_KEY, {}) ?? {};
  const p = {
    playerId: typeof saved.playerId === 'string' ? saved.playerId : newId(),
    name: typeof saved.name === 'string' ? saved.name : '',
    color: saved.color ?? COLORS[Math.floor(Math.random() * COLORS.length)].id,
    icon: saved.icon ?? ICONS[Math.floor(Math.random() * ICONS.length)].id,
  };
  saveJSON(PROFILE_KEY, p);
  return p;
}

function saveProfile() {
  saveJSON(PROFILE_KEY, profile);
}

function readSession() {
  try {
    return sessionStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}

function writeSession(code) {
  try {
    if (code) sessionStorage.setItem(SESSION_KEY, code);
    else sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // sin sessionStorage solo se pierde la vuelta automática tras recargar
  }
}

init();
