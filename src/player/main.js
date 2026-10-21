// Pantalla del jugador (móvil).
import '@fontsource-variable/outfit';
import '@fontsource/creepster/latin.css';
import './player.css';
import '../shared/phone.css';
import { $, fill, h } from '../shared/dom.js';
import { COLORS, ICONS, getColor, getIcon } from '../shared/appearance.js';
import { isValidRoomCode, normalizeRoomCode } from '../shared/roomCode.js';
import { ERROR_CODE, MSG, PROTOCOL_VERSION } from '../shared/protocol.js';
import { loadJSON, newId, saveJSON } from '../shared/storage.js';
import { formatDeltaSeconds, formatSeconds } from '../shared/format.js';
import { PlayerConnection } from './network.js';
import { createProfilePicker } from './profilePicker.js';
import { SyncClient } from './syncClient.js';
import { createAnswerPad } from './answerPad.js';
import { envGradient, HOME_ENV } from '../shared/environments.js';
import { keepScreenAwake } from '../shared/wakeLock.js';

// `?perfil=2` usa otra identidad: para probar varios jugadores en pestañas del mismo navegador.
const profileSlot = new URLSearchParams(location.search).get('perfil');
const PROFILE_KEY = 'concurso.player.v1' + (profileSlot ? `.${profileSlot.slice(0, 16)}` : '');
// sessionStorage: sala en la que está esta pestaña, para volver a entrar sola si se recarga.
const SESSION_KEY = 'concurso.player.session';

const profile = loadProfile();
let connection = null;
let roomCode = null;
let me = null; // lo que el presentador dice de mí (nombre final, color, icono, puntos)
let lastState = null; // último mensaje `state`
let stateReceivedAt = 0; // performance.now() al recibirlo (para la apertura programada)
let pressedEpoch = null; // época en la que ya pulsé
let buzzSeq = 0;
let goTimer = null;
let lastShownStatus = null;
let teamRequested = false; // se ha elegido equipo y se espera la confirmación del presentador
const lastResultRound = new Set(); // rondas cuyo resultado ya hizo vibrar el móvil

const sync = new SyncClient({ send: (msg) => connection?.send(msg) ?? false });
// Al volver a primer plano el reloj puede haberse parado (iOS lo hace con la pantalla bloqueada): resincronizar.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && connection?.connected) sync.burst();
});

// Secciones de respuestas: el botón grande se cambia por las opciones.
const ackKinds = new Map(); // seq → 'answer' | 'joker'
const pad = createAnswerPad({
  onAnswer: (roundId, value, tLocal) => {
    const clock = sync.estimate();
    const seq = ++buzzSeq;
    ackKinds.set(seq, 'answer');
    connection?.send({ t: MSG.ANSWER, seq, roundId, value, tLocal: tLocal ?? performance.now(), offset: clock?.offset, err: clock?.err });
    vibrate(30);
  },
  onJoker: (roundId, kind) => {
    const seq = ++buzzSeq;
    ackKinds.set(seq, 'joker');
    connection?.send({ t: MSG.JOKER, seq, roundId, kind });
  },
  toLocal: (tHost) => (tHost == null ? null : sync.toLocal(tHost)),
});
$('#screen-game').append(pad.root);

const ANSWER_REJECTED = {
  late: 'Se acabó el tiempo: tu respuesta llegó tarde.',
  closed: 'La pregunta ya está cerrada.',
  'not-eligible': 'Esta pregunta no es para ti.',
  invalid: 'Respuesta no válida.',
  early: '¡Aún no ha empezado el reloj! Espera a que corra.',
};

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
  history.replaceState(null, '', `?sala=${code}${profileSlot ? `&perfil=${encodeURIComponent(profileSlot)}` : ''}`);
  $('#connecting-text').textContent = `Conectando con la sala ${code}…`;
  show('screen-connecting');

  connection = new PlayerConnection({
    roomCode: code,
    onOpen: () => {
      connection.send({
        t: MSG.HELLO,
        v: PROTOCOL_VERSION,
        playerId: profile.playerId,
        name: profile.name,
        color: profile.color,
        icon: profile.icon,
        teamId: profile.teamId ?? null,
      });
      sync.start(); // después del hello: el presentador ignora todo lo anterior
    },
    onMessage: handleMessage,
    onStatus: handleStatus,
  });
  connection.start();
}

function leave() {
  sync.stop();
  connection?.stop();
  connection = null;
  me = null;
  lastState = null;
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
      sync.stop();
      writeSession(null);
      showJoin(`No encuentro la sala ${roomCode}. Revisa el código y que el presentador tenga la sala abierta.`);
      break;
    case 'fatal':
      showMessage('No se puede jugar en este navegador', message);
      break;
  }
  if (state !== 'connected') sync.stop(); // al reconectar, onOpen la vuelve a arrancar desde cero
  document.body.classList.toggle('offline', state !== 'connected');
}

function handleMessage(msg, tRecv) {
  switch (msg.t) {
    case MSG.SYNC_REPLY:
      sync.handleReply(msg, tRecv);
      break;
    case MSG.WELCOME: {
      const firstTime = !me;
      me = msg.you;
      // Guardar lo que asignó el presentador (color/icono); el nombre se guarda tal como lo escribió la persona.
      profile.color = me.color;
      profile.icon = me.icon;
      if (me.teamId) profile.teamId = me.teamId;
      teamRequested = false;
      saveProfile();
      const notes = [];
      if (msg.adjusted?.renamed) notes.push(`Ya había alguien con ese nombre: aparecerás como «${me.name}».`);
      if (msg.adjusted?.appearanceChanged) notes.push('Ese icono ya estaba cogido: te hemos puesto otro.');
      if (notes.length) toast(notes.join(' ') + ' Puedes cambiarlo en «Cambiar».');
      if (firstTime) show('screen-game');
      renderMe();
      break;
    }
    case MSG.STATE: {
      me = msg.you;
      lastState = msg;
      stateReceivedAt = performance.now();
      editPicker.setTaken(msg.taken ?? []);
      const team = msg.teams?.find((t) => t.id === me.teamId);
      const teamPlace = team ? (msg.standings?.teams.findIndex((t) => t.id === team.id) ?? -1) + 1 : 0;
      const teamText = team ? `${team.name}${teamPlace ? ` · ${teamPlace}º` : ''}` : null;
      $('#room-line').textContent = [teamText, `Sala ${msg.room}`, `${msg.playerCount} ${msg.playerCount === 1 ? 'jugador' : 'jugadores'}`]
        .filter(Boolean)
        .join(' · ');
      renderMe();
      renderSectionBar(msg);
      // El fondo del móvil lleva los colores del entorno de la sección (el mismo que la tele).
      document.body.style.setProperty('--env-bg', envGradient(msg.section?.env ?? HOME_ENV));
      if (standingsDialog.open) renderStandings();
      if (msg.answer) {
        $('#buzzer').hidden = true;
        pad.show();
        if (msg.answer.result?.points && !lastResultRound.has(msg.answer.roundId)) {
          lastResultRound.add(msg.answer.roundId);
          vibrate([80, 60, 80]);
        }
        pad.render(msg.answer, { stateReceivedAt });
      } else {
        pad.hide();
        $('#buzzer').hidden = false;
        renderBuzzer();
      }
      // Con equipos, quien aún no tiene uno tiene que elegirlo antes de nada.
      if (msg.teams?.length && !me.teamId && !teamRequested) showTeamPicker(msg.teams);
      else if ($('#screen-game').hidden) show('screen-game');
      break;
    }
    case MSG.ANSWER_ACK: {
      const kind = ackKinds.get(msg.seq);
      ackKinds.delete(msg.seq);
      if (msg.result === 'ok') break;
      // En Reflejos, pulsar en rojo queda registrado: lo cuenta el estado ("¡Demasiado pronto!").
      if (msg.result === 'early' && lastState?.answer?.kind === 'reflejos') break;
      if (kind === 'answer') {
        pad.rejectPending();
        toast(ANSWER_REJECTED[msg.result] ?? 'No se ha podido enviar la respuesta.');
      } else if (msg.message) {
        toast(msg.message);
      }
      break;
    }
    case MSG.ERROR:
      handleError(msg);
      break;
  }
}

function handleError(msg) {
  sync.stop();
  connection?.stop();
  connection = null;
  me = null;
  lastState = null;
  writeSession(null);
  if (msg.code === ERROR_CODE.ROOM_FULL) showMessage('Sala llena', msg.message);
  else if (msg.code === ERROR_CODE.REMOVED) showMessage('Fuera de la sala', msg.message, 'Volver a entrar', () => join(roomCode));
  else if (msg.code === ERROR_CODE.REPLACED) showMessage('Abierto en otra pestaña', msg.message, 'Jugar aquí', () => join(roomCode));
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

/**
 * Instante local en que empieza el turno. Sincronizado: el `tOpen` del presentador traducido a este reloj
 * (todos los móviles cambian a la vez). Sin sincronizar: cuenta atrás desde que llegó el estado.
 */
function localOpenTime(g) {
  return sync.toLocal(g.tOpen) ?? stateReceivedAt + (g.opensInMs ?? 0);
}

/** Estado que se ve ahora: el del presentador, más "preparados" (apertura programada) y "pulsado" local. */
function displayedStatus() {
  const g = lastState?.game;
  if (!g) return 'wait';
  if (g.status === 'go') {
    if (pressedEpoch === g.epoch) return 'pressed'; // optimista: no esperar al presentador
    if (localOpenTime(g) > performance.now()) return 'ready';
  }
  return g.status;
}

/** Fuera de una pregunta de pulsador el botón solo informa de lo que pasa en la tele. */
function renderInfo(state) {
  const section = state.section;
  const free = state.free; // sección Libre: lo arbitra el presentador; aquí solo se informa
  const freeText = free && [
    free.won ? '¡Has ganado!' : free.out ? '¡Eliminado!' : free.participating ? '¡Te toca!' : free.title,
    free.won ? `+${free.points} ${free.byTeams ? 'para tu equipo' : ''}`.trim() : free.participating ? free.title : 'Mira la tele',
  ];
  const [label, sub] = freeText ?? {
    setup: ['Espera', state.playerCount < state.minPlayers ? `Esperando jugadores (mínimo ${state.minPlayers})` : 'Enseguida empezamos'],
    cover: ['¡Empezamos!', 'Mira la tele'],
    intro: [section?.name ?? 'Nueva sección', section?.label ?? ''],
    play: [section?.name ?? 'Espera', 'Mira la tele'],
    scoreboard: ['Marcador', 'Mira la tele'],
    final: ['¡Fin del concurso!', `Has hecho ${me?.score ?? 0} ${me?.score === 1 ? 'punto' : 'puntos'}`],
  }[state.screen] ?? ['Espera', ''];
  const buzzer = $('#buzzer');
  buzzer.dataset.state = 'info';
  $('#buzzer-label').textContent = label;
  $('#buzzer-sub').textContent = sub;
  lastShownStatus = 'info';
}

function renderBuzzer() {
  const state = lastState;
  const g = state?.game;
  clearTimeout(goTimer);
  if (!state) return;
  if (!g) return renderInfo(state);
  const status = displayedStatus();
  if (status === 'ready') {
    // Cambiar a "¡PULSA!" justo cuando empieza el turno.
    goTimer = setTimeout(renderBuzzer, localOpenTime(g) - performance.now());
  }
  if (status === 'first' && lastShownStatus !== 'first') vibrate([80, 60, 80]);
  lastShownStatus = status;

  const winnerName = state.winner?.name ?? '';
  const [label, sub] = {
    wait: ['Espera', state.playerCount < state.minPlayers ? `Esperando jugadores (mínimo ${state.minPlayers})` : 'Pregunta en el aire'],
    ready: ['Espera', 'Preparados…'],
    go: ['¡PULSA!', ''],
    pressed: ['¡Pulsado!', 'Esperando resultado…'],
    first: g.judged === 'correct' ? ['¡Has acertado!', '¡Bien hecho!'] : ['¡Has sido el primero!', formatSeconds(g.reactionMs ?? 0)],
    placed: [`Llegaste ${g.place}º`, `(${formatDeltaSeconds(g.deltaMs ?? 0)})${g.nearTie ? ' · ¡casi empate!' : ''}`],
    missed: g.judged === 'correct' ? [`${winnerName} ha acertado`, ''] : ['Espera', `Ha pulsado antes ${winnerName}`],
    blocked: ['Bloqueado', g.reason === 'early' ? 'Pulsaste antes de tiempo' : 'Fallaste: espera a la siguiente pregunta'],
    closed: ['Nadie acertó', 'Espera a la siguiente pregunta'],
  }[status] ?? ['Espera', ''];

  const buzzer = $('#buzzer');
  buzzer.dataset.state = status;
  $('#buzzer-label').textContent = label;
  $('#buzzer-sub').textContent = sub;
}

// El pulsador responde a pointerdown (no a click): se dispara al tocar, sin esperar a levantar el dedo.
const buzzer = $('#buzzer');
buzzer.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  buzzer.classList.add('pressed');
  setTimeout(() => buzzer.classList.remove('pressed'), 140);

  const g = lastState?.game;
  const status = displayedStatus();
  // Se envía también en "Espera"/"Preparados": quien decide si es antes de tiempo es el presentador.
  if (!g || !connection?.connected || !['wait', 'ready', 'go'].includes(status)) return;
  if (pressedEpoch === g.epoch) return; // una pulsación por ronda
  pressedEpoch = g.epoch;
  // event.timeStamp = cuándo tocó el dedo la pantalla (no cuándo se ejecuta este código), en el reloj de
  // performance.now(). Si un navegador antiguo usara otra base, se nota porque cae lejos de ahora.
  const now = performance.now();
  const tLocal = Math.abs(now - e.timeStamp) < 1000 ? e.timeStamp : now;
  const clock = sync.estimate();
  connection.send({ t: MSG.BUZZ, seq: ++buzzSeq, epoch: g.epoch, tLocal, offset: clock?.offset, err: clock?.err });
  vibrate(30);
  renderBuzzer();
});

function vibrate(pattern) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // iPhone y escritorio: sin vibración
  }
}
buzzer.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('contextmenu', (e) => {
  if (!$('#screen-game').hidden) e.preventDefault();
});

// ---------- Cambiar perfil ----------

const dialog = $('#profile-dialog');
const teamSelect = $('#team-select');

$('#edit-profile').addEventListener('click', () => {
  const teams = lastState?.teams ?? [];
  const locked = !!lastState?.teamsLocked;
  $('#team-field').hidden = !teams.length || locked;
  $('#team-locked').hidden = !(teams.length && locked);
  fill(
    teamSelect,
    teams.map((t) => h('option', { value: t.id, selected: t.id === me?.teamId }, t.name)),
  );
  editPicker.setFixedColor(teams.length ? (teams.find((t) => t.id === me?.teamId)?.color ?? null) : null);
  editPicker.value = { ...profile, color: me?.color ?? profile.color, icon: me?.icon ?? profile.icon };
  dialog.showModal();
});

// Al cambiar de equipo en el diálogo, los iconos ocupados se calculan con el color del nuevo equipo.
teamSelect.addEventListener('change', () => {
  const team = lastState?.teams?.find((t) => t.id === teamSelect.value);
  if (team) editPicker.setFixedColor(team.color);
});

// 'submit' y no 'close': Chrome no dispara 'close' mientras la página no se pinta.
$('#profile-form').addEventListener('submit', (e) => {
  e.preventDefault();
  dialog.close();
  if (e.submitter?.value !== 'save') return;
  const value = editPicker.value;
  const teamId = $('#team-field').hidden ? (me?.teamId ?? null) : teamSelect.value || null;
  Object.assign(profile, value, { teamId });
  saveProfile();
  connection?.send({ t: MSG.PROFILE, name: value.name, color: value.color, icon: value.icon, teamId });
});

// ---------- Sección y marcador ----------

/** Barra bajo la cabecera: en qué sección estamos, qué pregunta va y cuántos puntos hay en juego. */
function renderSectionBar(state) {
  const bar = $('#section-bar');
  const s = state.section;
  bar.hidden = !s;
  if (!s) return;
  const unit = { contador: 'Ronda', reflejos: 'Ronda', libre: 'Prueba' }[state.answer?.kind ?? (state.free ? 'libre' : '')] ?? 'Pregunta';
  const item = s.itemIndex == null ? '' : s.itemCount ? `${unit} ${s.itemIndex + 1} de ${s.itemCount}` : `${unit} ${s.itemIndex + 1}`;
  const pts = s.points?.length > 1 ? `${s.points.join('·')} pts` : `${s.points?.[0] ?? 1} ${s.points?.[0] === 1 ? 'pt' : 'pts'}`;
  $('#section-top').textContent = [`Sección ${s.index + 1} de ${s.count}`, s.label, item].filter(Boolean).join(' · ');
  $('#section-name').textContent = `${s.name} · ${pts}`;
  $('#section-desc').textContent = s.description ?? '';
  $('#section-desc').hidden = !s.description;
}

const standingsDialog = $('#standings-dialog');
$('#open-standings').addEventListener('click', () => {
  renderStandings();
  standingsDialog.showModal();
});
// 'submit' y no 'close': Chrome no dispara 'close' mientras la página no se pinta.
$('#standings-form').addEventListener('submit', (e) => {
  e.preventDefault();
  standingsDialog.close();
});

/** Marcador en directo: equipos (si hay) y jugadores, con el tuyo resaltado. */
function renderStandings() {
  const st = lastState?.standings;
  if (!st) return;
  const row = (place, name, score, { color, icon, mine }) =>
    h(
      'li',
      { class: mine ? 'mine' : '', style: { '--pc': getColor(color).bg } },
      h('span', { class: 'st-place' }, `${place}º`),
      icon ? h('span', { class: 'emoji' }, getIcon(icon).glyph) : null,
      h('span', { class: 'st-name' }, name),
      h('strong', {}, String(score)),
    );
  fill(
    $('#standings-body'),
    st.teams.length
      ? [
          h('h3', {}, 'Equipos'),
          h(
            'ol',
            { class: 'st-list' },
            st.teams.map((t, i) => row(i + 1, t.name, t.score, { color: t.color, mine: t.id === me?.teamId })),
          ),
        ]
      : null,
    h('h3', {}, st.teams.length ? 'Concursantes' : 'Clasificación'),
    h(
      'ol',
      { class: 'st-list' },
      st.players.map((p, i) => row(i + 1, p.name, p.score, { color: p.color, icon: p.icon, mine: p.id === me?.id })),
    ),
  );
}

// ---------- Elegir equipo ----------

function showTeamPicker(teams) {
  fill(
    $('#team-list'),
    teams.map((t) => {
      const color = getColor(t.color);
      return h(
        'button',
        {
          type: 'button',
          class: 'team-button',
          style: { background: color.bg, color: color.fg },
          onclick: () => {
            profile.teamId = t.id;
            teamRequested = true; // hasta que conteste, no volver a enseñar la lista
            saveProfile();
            connection?.send({ t: MSG.PROFILE, name: profile.name, color: t.color, icon: profile.icon, teamId: t.id });
            show('screen-game');
          },
        },
        t.name,
      );
    }),
  );
  show('screen-team');
}

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

keepScreenAwake();
init();
