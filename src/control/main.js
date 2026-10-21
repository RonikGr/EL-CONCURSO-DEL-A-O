// Mando del presentador (en su móvil): ve preguntas y respuestas en privado y controla el concurso.
// Se conecta como un móvil más, con rol "control" y la clave secreta que enseña el QR de mando de la tele.
import './control.css';
import { $, fill, h } from '../shared/dom.js';
import { getColor, getIcon } from '../shared/appearance.js';
import { formatDeltaMs, formatSeconds } from '../shared/format.js';
import { isValidRoomCode, normalizeRoomCode } from '../shared/roomCode.js';
import { loadJSON, newId, saveJSON } from '../shared/storage.js';
import { ERROR_CODE, MSG, PROTOCOL_VERSION, ROLE } from '../shared/protocol.js';
import { PlayerConnection as Connection } from '../player/network.js'; // la conexión con reconexión sirve igual

const STORE_KEY = 'concurso.control.v1';
const SCREEN_LABEL = { setup: 'Preparación', cover: 'Portada', intro: 'Presentación', play: 'Jugando', scoreboard: 'Marcador', final: 'Final' };

const app = $('#app');
const store = loadJSON(STORE_KEY, {}) ?? {};
store.controlId ??= newId();
store.keys ??= {}; // código de sala → clave
saveJSON(STORE_KEY, store);

let connection = null;
let view = null;
let tab = 'game';
let cmdSeq = 0;
let lastSignature = null;
let status = 'connecting'; // connecting | pending | ready | reconnecting

// ------------------------------------------------------------------ Arranque

function init() {
  const params = new URLSearchParams(location.search);
  const code = normalizeRoomCode(params.get('sala'));
  const key = new URLSearchParams(location.hash.slice(1)).get('k');
  if (isValidRoomCode(code) && key) {
    store.keys[code] = key;
    saveJSON(STORE_KEY, store);
    history.replaceState(null, '', `?sala=${code}`); // que la clave no se quede a la vista en la barra
  }
  if (!isValidRoomCode(code) || !store.keys[code]) {
    return message('Escanea el QR de mando', 'Abre esta página escaneando el QR «Mando del presentador» que aparece en la tele, en la pantalla de preparación.');
  }
  connect(code, store.keys[code]);
}

function connect(code, key) {
  status = 'connecting';
  message('Conectando…', `Buscando la sala ${code}.`);
  connection = new Connection({
    roomCode: code,
    onOpen: () =>
      connection.send({ t: MSG.HELLO, v: PROTOCOL_VERSION, role: ROLE.CONTROL, controlId: store.controlId, token: key, deviceName: deviceName() }),
    onMessage: handleMessage,
    onStatus: ({ state, message: text }) => {
      if (state === 'connected') return;
      if (state === 'not-found') return message('No encuentro la sala', `¿Está abierta la sala ${code} en el portátil?`, 'Reintentar', () => location.reload());
      if (state === 'fatal') return message('No se puede usar este navegador', text);
      if (state === 'reconnecting' || state === 'server-down') {
        status = 'reconnecting';
        document.body.classList.add('offline');
        renderBanner(text || 'Reconectando…');
      }
    },
  });
  connection.start();
}

function handleMessage(msg) {
  switch (msg.t) {
    case MSG.CONTROL_STATUS:
      status = msg.status === 'approved' ? 'ready' : 'pending';
      if (status === 'pending') message('Confirma en el portátil', 'En la tele aparece «¿Permitir este mando?». Pulsa Enter en el portátil (o «Permitir»).');
      break;
    case MSG.CONTROL_STATE:
      status = 'ready';
      document.body.classList.remove('offline');
      view = msg.view;
      render();
      break;
    case MSG.CMD_RESULT:
      if (!msg.ok && msg.error) toast(msg.error);
      break;
    case MSG.ERROR:
      connection?.stop();
      if (msg.code === ERROR_CODE.REPLACED) message('Mando abierto en otro sitio', msg.message, 'Usar aquí', () => location.reload());
      else if (msg.code === ERROR_CODE.VERSION) message('Versión distinta', msg.message, 'Recargar', () => location.reload());
      else message('Mando no permitido', msg.message);
      break;
  }
}

/** Manda una orden al portátil. */
function cmd(action, args = {}) {
  if (!connection?.send({ t: MSG.CMD, id: ++cmdSeq, action, args })) toast('Sin conexión con el portátil.');
}

// ------------------------------------------------------------------ Pintado

function message(title, text, actionLabel, action) {
  lastSignature = null;
  fill(
    app,
    h(
      'main',
      { class: 'c-message' },
      h('div', { class: 'spinner', hidden: !!actionLabel || title.startsWith('Escanea') || title.startsWith('Mando') }),
      h('h1', {}, title),
      h('p', {}, text),
      actionLabel ? h('button', { class: 'btn primary big', onclick: action }, actionLabel) : null,
    ),
  );
}

function render() {
  if (!view) return;
  // Repintar solo si cambió algo visible (no con cada latencia), para no "robar" toques a medio pulsar.
  const signature = JSON.stringify([tab, { ...view, players: view.players.map(({ rtt, ...p }) => p), network: null }]);
  if (signature === lastSignature) return;
  lastSignature = signature;

  fill(
    app,
    h(
      'header',
      { class: 'c-top' },
      h('div', {}, h('strong', {}, view.title), h('span', {}, `Sala ${view.code} · ${view.peekScoreboard ? 'Marcador' : SCREEN_LABEL[view.screen]}`)),
      h('span', { class: 'c-net', title: 'Conexión' }),
    ),
    h('div', { id: 'c-banner', class: 'c-banner', hidden: true }),
    h('main', { class: 'c-main' }, tab === 'game' ? gameTab() : tab === 'players' ? playersTab() : sectionsTab()),
    h(
      'nav',
      { class: 'c-tabs' },
      [
        ['game', 'Juego'],
        ['players', 'Jugadores'],
        ['sections', 'Secciones'],
      ].map(([id, label]) =>
        h(
          'button',
          {
            class: tab === id ? 'active' : '',
            onclick: () => {
              tab = id;
              render();
            },
          },
          label,
        ),
      ),
    ),
    h('div', { id: 'c-toast', class: 'c-toast', hidden: true }),
  );
}

function renderBanner(text) {
  const el = document.getElementById('c-banner');
  if (!el) return;
  el.hidden = !text;
  el.textContent = text ?? '';
}

const btn = (label, onclick, cls = '') => h('button', { class: `btn ${cls}`, onclick }, label);
const avatar = (p) =>
  h('span', { class: 'c-avatar emoji', style: { background: getColor(p.color).bg, color: getColor(p.color).fg } }, getIcon(p.icon).glyph);
const teamOf = (id) => view.teams.find((t) => t.id === id);

function navRow() {
  return h(
    'div',
    { class: 'c-nav' },
    btn('← Atrás', () => cmd('prev')),
    view.screen !== 'setup' ? btn(view.peekScoreboard ? 'Quitar marcador' : 'Marcador', () => cmd('scoreboard')) : null,
    view.screen !== 'final' ? btn('Siguiente →', () => cmd('next')) : null,
  );
}

// ---------- Pestaña Juego

function gameTab() {
  switch (view.screen) {
    case 'setup':
      return setupPanel();
    case 'cover':
      return [h('section', { class: 'c-card center' }, h('p', { class: 'c-kicker' }, 'En la tele: portada'), h('h2', {}, view.title)), bigNext('Presentar la primera sección →'), navRow()];
    case 'intro':
      return [sectionCard(), bigNext(view.playable ? 'Empezar sección →' : 'Saltar esta sección →'), navRow()];
    case 'play':
      return view.section?.type === 'pulsador' ? buzzerPanel() : [sectionCard(), bigNext('Siguiente →'), navRow()];
    case 'scoreboard':
      return [standingsCard('Marcador'), bigNext('Siguiente sección →'), navRow()];
    case 'final':
      return [standingsCard('Clasificación final'), navRow()];
    default:
      return null;
  }
}

function bigNext(label) {
  return h('button', { class: 'btn primary big', onclick: () => cmd('next') }, label);
}

function setupPanel() {
  const connected = view.players.filter((p) => p.connected).length;
  const imp = view.lastImport;
  return [
    h(
      'section',
      { class: 'c-card' },
      h('p', { class: 'c-kicker' }, 'Concurso cargado'),
      h('h2', {}, view.title),
      h('p', { class: 'muted' }, `${view.sections.length} secciones · ${view.teams.length ? `${view.teams.length} equipos` : 'sin equipos'}`),
      imp?.failed ? h('p', { class: 'warn' }, `El último archivo («${imp.fileName}») tenía ${imp.errors.length} errores: revísalos en la tele.`) : null,
      h('p', { class: 'muted small' }, 'Para cargar otro concurso, arrástralo a la tele (pantalla de preparación).'),
    ),
    h(
      'section',
      { class: 'c-card' },
      h('p', { class: 'c-kicker' }, `${connected} conectados (mínimo ${view.minPlayers})`),
      view.teams.length ? teamsSummary() : h('p', {}, view.players.map((p) => p.name).join(', ') || 'Nadie todavía.'),
      view.teams.length
        ? btn(view.teamsLocked ? '🔒 Equipos cerrados (abrir)' : '🔓 Equipos abiertos (cerrar)', () => cmd('lockTeams', { locked: !view.teamsLocked }))
        : null,
    ),
    h('button', { class: 'btn primary big', disabled: !view.canStart, onclick: () => cmd('next') }, 'Empezar concurso →'),
    view.canStart ? h('p', { class: 'muted small center' }, view.teams.length ? 'Al empezar, los equipos se cierran.' : '') : null,
  ];
}

function teamsSummary() {
  const groups = view.teams.map((t) => ({ team: t, members: view.players.filter((p) => p.teamId === t.id) }));
  const teamless = view.players.filter((p) => !p.teamId);
  return h(
    'div',
    { class: 'c-teams' },
    groups.map(({ team, members }) =>
      h(
        'div',
        { class: 'c-team', style: { '--tc': getColor(team.color).bg } },
        h('strong', {}, `${team.name} (${members.length})`),
        h('span', {}, members.map((m) => m.name).join(', ') || '—'),
      ),
    ),
    teamless.length ? h('div', { class: 'c-team no-team' }, h('strong', {}, `Sin equipo (${teamless.length})`), h('span', {}, teamless.map((m) => m.name).join(', '))) : null,
  );
}

function sectionCard() {
  const s = view.section;
  if (!s) return null;
  return h(
    'section',
    { class: 'c-card' },
    h('p', { class: 'c-kicker' }, `Sección ${view.sectionIndex + 1} de ${view.sections.length} · ${view.sectionLabel}`),
    h('h2', {}, s.name),
    s.description ? h('p', {}, s.description) : null,
    h('p', { class: 'muted' }, `Puntos: ${s.points.join(' · ')}`),
    view.playable ? null : h('p', { class: 'warn' }, 'Este tipo de sección aún no se puede jugar: se saltará.'),
  );
}

function buzzerPanel() {
  const item = view.item;
  const game = view.game;
  const progress = view.itemCount ? `Pregunta ${view.itemIndex + 1} de ${view.itemCount}` : `Pregunta ${view.itemIndex + 1} (improvisada)`;

  const question = h(
    'section',
    { class: 'c-card' },
    h('p', { class: 'c-kicker' }, `${view.section.name} · ${progress}`),
    item?.question ? h('p', { class: 'c-question' }, item.question) : h('p', { class: 'muted' }, item?.song ? '🎵 Pregunta con canción' : 'Sin pregunta escrita: improvisa.'),
    item?.answer ? h('p', { class: 'c-answer' }, h('small', {}, 'Respuesta'), item.answer) : null,
    item?.notes ? h('p', { class: 'c-notes' }, '📝 ', item.notes) : null,
    item?.song ? h('p', { class: 'muted small' }, '🎵 La canción sonará cuando esté Spotify (fase 8).') : null,
    item?.showOnTv && item.question
      ? h('p', { class: 'muted small' }, view.shown.question ? '✓ La pregunta se ve en la tele.' : 'La pregunta aún no se ve en la tele.')
      : item && !item.showOnTv
        ? h('p', { class: 'muted small' }, 'Esta pregunta no se muestra en la tele.')
        : null,
  );

  let turn;
  switch (game?.phase) {
    case 'idle':
      turn = [
        item?.showOnTv && item.question && !view.shown.question ? btn('Mostrar pregunta en la tele', () => cmd('showQuestion')) : null,
        h('button', { class: 'btn primary big', disabled: !view.canStart, onclick: () => cmd('open') }, 'Abrir turno'),
      ];
      break;
    case 'open':
      turn = [h('p', { class: 'c-live' }, '¡Turno abierto! Esperando pulsaciones…'), btn('Reiniciar pregunta', () => cmd('restart'))];
      break;
    case 'result':
      turn = [
        resultCard(game),
        game.judged
          ? null
          : h(
              'div',
              { class: 'c-row' },
              h('button', { class: 'btn ok big', onclick: () => cmd('correct') }, `Acierto +${view.pointsForCorrect}`),
              h('button', { class: 'btn bad big', onclick: () => cmd('wrong') }, 'Fallo: rebote'),
            ),
        item?.answer && !view.shown.answer ? btn('Mostrar respuesta en la tele', () => cmd('showAnswer')) : null,
        h('button', { class: `btn big ${game.judged ? 'primary' : ''}`, onclick: () => cmd('nextItem') }, 'Siguiente pregunta →'),
        btn('Reiniciar pregunta', () => cmd('restart')),
      ];
      break;
    case 'closed':
      turn = [
        h('p', { class: 'c-live' }, 'Nadie más puede responder.'),
        item?.answer && !view.shown.answer ? btn('Mostrar respuesta en la tele', () => cmd('showAnswer')) : null,
        h('button', { class: 'btn primary big', onclick: () => cmd('nextItem') }, 'Siguiente pregunta →'),
        btn('Reiniciar pregunta', () => cmd('restart')),
      ];
      break;
  }

  return [
    question,
    h('section', { class: 'c-turn' }, turn),
    h('div', { class: 'c-row secondary' }, btn('Saltar pregunta', () => cmd('nextItem')), btn('Terminar sección', () => cmd('endSection'))),
    navRow(),
  ];
}

function resultCard(game) {
  const w = game.winner;
  if (!w) return null;
  const team = teamOf(w.teamId);
  const first = game.ranking[0];
  return h(
    'div',
    { class: 'c-winner', style: { '--wc': getColor(w.color).bg, '--wc-fg': getColor(w.color).fg } },
    h('div', { class: 'c-winner-main' }, h('span', { class: 'emoji big-icon' }, getIcon(w.icon).glyph), h('div', {}, h('strong', {}, w.name), team ? h('small', {}, team.name) : null)),
    first ? h('span', { class: 'c-time' }, formatSeconds(first.reactionMs)) : null,
    game.judged === 'correct' ? h('p', { class: 'c-verdict' }, `¡Correcto! +${view.pointsForCorrect}`) : null,
    game.ranking.length > 1
      ? h(
          'ol',
          { class: 'c-followers' },
          game.ranking.slice(1).map((r) => h('li', {}, `${r.place}º ${r.player.name} ${formatDeltaMs(r.deltaMs)}${r.nearTie ? ' · casi empate' : ''}`)),
        )
      : null,
  );
}

function standingsCard(title) {
  const players = [...view.players].sort((a, b) => b.score - a.score);
  return h(
    'section',
    { class: 'c-card' },
    h('p', { class: 'c-kicker' }, title),
    view.standings.length
      ? h(
          'ol',
          { class: 'c-standings' },
          view.standings.map((s) => h('li', { style: { '--tc': getColor(s.team.color).bg } }, h('span', {}, s.team.name), h('strong', {}, String(s.score)))),
        )
      : null,
    h(
      'ol',
      { class: 'c-standings players' },
      players.map((p) => h('li', {}, h('span', {}, avatar(p), ' ', p.name), h('strong', {}, String(p.score)))),
    ),
  );
}

// ---------- Pestaña Jugadores

function playersTab() {
  const groups = view.teams.length
    ? [...view.teams.map((t) => ({ team: t, members: view.players.filter((p) => p.teamId === t.id) })), { team: null, members: view.players.filter((p) => !p.teamId) }]
    : [{ team: null, members: view.players }];
  return [
    view.teams.length
      ? h(
          'section',
          { class: 'c-card' },
          h('p', { class: 'c-kicker' }, 'Equipos'),
          view.standings.map((s) =>
            h(
              'div',
              { class: 'c-player', style: { '--tc': getColor(s.team.color).bg } },
              h('span', { class: 'c-team-dot' }),
              h('span', { class: 'c-pname' }, s.team.name),
              h('strong', { class: 'c-score' }, String(s.score)),
              btn('−', () => cmd('adjustTeamBonus', { teamId: s.team.id, delta: -1 }), 'round'),
              btn('+', () => cmd('adjustTeamBonus', { teamId: s.team.id, delta: 1 }), 'round'),
            ),
          ),
          h('p', { class: 'muted small' }, '± aquí da o quita puntos al equipo entero.'),
          btn(view.teamsLocked ? '🔒 Equipos cerrados (abrir)' : '🔓 Equipos abiertos (cerrar)', () => cmd('lockTeams', { locked: !view.teamsLocked })),
        )
      : null,
    ...groups
      .filter((g) => g.members.length)
      .map(({ team, members }) =>
        h(
          'section',
          { class: 'c-card' },
          h('p', { class: 'c-kicker' }, team ? team.name : view.teams.length ? 'Sin equipo' : 'Jugadores'),
          members.map((p) =>
            h(
              'div',
              { class: `c-player ${p.connected ? '' : 'offline'}` },
              avatar(p),
              h('span', { class: 'c-pname' }, p.name, p.lock ? h('small', {}, ' · bloqueado') : null),
              h('strong', { class: 'c-score' }, String(p.score)),
              btn('−', () => cmd('adjustScore', { playerId: p.id, delta: -1 }), 'round'),
              btn('+', () => cmd('adjustScore', { playerId: p.id, delta: 1 }), 'round'),
              view.teams.length
                ? h(
                    'select',
                    { class: 'c-select', 'aria-label': `Equipo de ${p.name}`, onchange: (e) => cmd('moveTeam', { playerId: p.id, teamId: e.target.value }) },
                    p.teamId ? null : h('option', { value: '', selected: true }, '—'),
                    view.teams.map((t) => h('option', { value: t.id, selected: t.id === p.teamId }, t.name)),
                  )
                : null,
              btn('✕', () => confirm(`¿Quitar a ${p.name} de la sala? Perderá sus puntos.`) && cmd('removePlayer', { playerId: p.id }), 'round ghost'),
            ),
          ),
        ),
      ),
    view.players.length ? null : h('p', { class: 'muted center' }, 'Todavía no hay jugadores.'),
    btn('Poner todos los marcadores a 0', () => confirm('¿Poner todos los marcadores a 0 (también los de equipo)?') && cmd('resetScores'), 'danger'),
  ];
}

// ---------- Pestaña Secciones

function sectionsTab() {
  return [
    h(
      'section',
      { class: 'c-card' },
      h('p', { class: 'c-kicker' }, 'Ir a una sección'),
      h(
        'ol',
        { class: 'c-sections' },
        view.sections.map((s) =>
          h(
            'li',
            { class: s.index === view.sectionIndex && view.screen !== 'setup' ? 'current' : '' },
            h(
              'button',
              {
                onclick: () => {
                  if (view.screen === 'play' && !confirm(`¿Saltar a «${s.name}»? Se deja la pregunta actual.`)) return;
                  cmd('gotoSection', { index: s.index });
                  tab = 'game';
                },
              },
              h('span', { class: 'c-sec-name' }, `${s.index + 1}. ${s.name}`),
              h('small', {}, `${s.label}${s.items ? ` · ${s.items}` : ''}${s.playable ? '' : ' · próximamente'}`),
            ),
          ),
        ),
      ),
    ),
    view.screen !== 'setup' ? btn('Volver a preparación', () => confirm('¿Volver a la pantalla de preparación?') && cmd('toSetup')) : null,
  ];
}

// ------------------------------------------------------------------ Utilidades

let toastTimer = null;
function toast(text) {
  const el = document.getElementById('c-toast');
  if (!el) return alert(text);
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 3500);
}

function deviceName() {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) return 'Móvil Android';
  return 'Ordenador';
}

init();
