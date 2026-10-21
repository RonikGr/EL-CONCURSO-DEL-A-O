// Pantallas de la tele (salvo el juego del Pulsador, en stage.js). Cada función devuelve el contenido de la
// pantalla a partir de `room.view()`; main.js decide cuándo repintar.
import { h } from '../shared/dom.js';
import { avatarOf, getColor } from '../shared/appearance.js';
import { MAX_PLAYERS, MIN_PLAYERS } from '../core/players.js';
import { envGradient, getEnv, sectionEnv } from '../shared/environments.js';
import { flipReorder, kinetic, later, odometer } from './fx/motion.js';
import { celebrate } from './fx/confetti.js';
import { sound } from './fx/audio.js';

const kbd = (key) => h('kbd', {}, key);
const avatar = (p, cls = 'avatar') =>
  h('span', { class: `${cls} emoji`, style: { '--pc': getColor(p.color).bg, '--pc-fg': getColor(p.color).fg }, 'aria-hidden': 'true' }, avatarOf(p));

function pointsText(points, ranked) {
  if (!points?.length) return '';
  if (points.length > 1) return `${points.join(' · ')} puntos para los ${points.length} primeros`;
  const n = points[0];
  return `${n} ${Math.abs(n) === 1 ? 'punto' : 'puntos'}${ranked ? '' : ' por acierto'}`;
}

// ---------------------------------------------------------------------------------------- Preparación

/**
 * @param ctx {joinQr, controlQr, joinUrlText, onFile, onStart, onLockTeams, onMoveTeam, facesCount, tracksCount, onOpenFaces, onOpenMusic}
 */
export function setupScreen(view, ctx) {
  const connected = view.players.filter((p) => p.connected).length;
  const missing = MIN_PLAYERS - connected;
  const imp = view.lastImport;

  const fileInput = h('input', { type: 'file', accept: '.xlsx', hidden: true, onchange: (e) => e.target.files[0] && ctx.onFile(e.target.files[0]) });

  const importBox = h(
    'div',
    { class: 'import-box' },
    h('h3', {}, view.title),
    h(
      'p',
      { class: 'muted' },
      `${view.sectionCount} ${view.sectionCount === 1 ? 'sección' : 'secciones'}`,
      view.teams.length ? ` · ${view.teams.length} equipos` : ' · sin equipos',
    ),
    h(
      'div',
      { class: 'import-actions' },
      h('button', { class: 'btn', onclick: () => fileInput.click() }, 'Cargar concurso (.xlsx)'),
      h('a', { class: 'btn', href: './plantilla-concurso.xlsx', download: 'plantilla-concurso.xlsx' }, 'Descargar plantilla'),
      fileInput,
    ),
    h('p', { class: 'muted small' }, 'También puedes arrastrar el archivo a esta pantalla.'),
    imp ? importReport(imp) : null,
  );

  const teamsBoard = view.teams.length ? teamsBoardView(view, ctx) : playersBoardView(view);

  return h(
    'div',
    { class: 'setup' },
    h(
      'section',
      { class: 'setup-join' },
      h('p', { class: 'join-label' }, 'Únete con el móvil'),
      ctx.joinQr,
      h('p', { class: 'join-url' }, ctx.joinUrlText),
      h('p', { class: 'join-code' }, view.code),
    ),
    h(
      'section',
      { class: 'setup-main' },
      importBox,
      extrasBox(ctx),
      h(
        'div',
        { class: 'setup-players' },
        h(
          'div',
          { class: 'players-head' },
          h('h2', {}, view.teams.length ? 'Equipos' : 'Jugadores', ' ', h('span', { class: 'players-count' }, `${connected} conectados · ${view.players.length}/${MAX_PLAYERS}`)),
          view.teams.length
            ? h(
                'button',
                { class: `btn small ${view.teamsLocked ? 'locked' : ''}`, onclick: () => ctx.onLockTeams(!view.teamsLocked) },
                view.teamsLocked ? '🔒 Equipos cerrados' : '🔓 Equipos abiertos',
              )
            : null,
        ),
        teamsBoard,
      ),
      h(
        'div',
        { class: 'setup-start' },
        missing > 0
          ? h('p', { class: 'stage-hint' }, `Falta${missing > 1 ? 'n' : ''} ${missing} para empezar (mínimo ${MIN_PLAYERS}).`)
          : h('p', { class: 'muted' }, view.teams.length ? 'Comprobad que cada uno está en su equipo: al empezar, los equipos se cierran.' : '¡Todo listo!'),
        h('button', { class: 'btn primary huge', disabled: missing > 0, onclick: ctx.onStart }, 'Empezar concurso ', kbd('Espacio')),
      ),
    ),
    h(
      'aside',
      { class: 'setup-control' },
      h('p', { class: 'join-label' }, 'Mando del presentador'),
      view.controlsConnected
        ? h('p', { class: 'control-ok' }, `✓ ${view.controlsConnected === 1 ? 'Mando conectado' : `${view.controlsConnected} mandos conectados`}`)
        : h('p', { class: 'muted small' }, 'Escanéalo con tu móvil (no lo enseñes a los jugadores).'),
      view.controlsConnected ? null : ctx.controlQr,
    ),
  );
}

// Caras y música: dos botones que abren sus ventanas (main.js), con un resumen de lo que hay.
function extrasBox(ctx) {
  const n = ctx.tracksCount;
  return h(
    'div',
    { class: 'import-box extras-box' },
    h(
      'div',
      { class: 'import-actions' },
      h('button', { class: 'btn', type: 'button', onclick: ctx.onOpenFaces }, `🙂 Caras · ${ctx.facesCount}`),
      h('button', { class: 'btn', type: 'button', onclick: ctx.onOpenMusic }, `🎵 Música · ${n ? `${n} ${n === 1 ? 'canción' : 'canciones'}` : 'generada'}`),
    ),
    h('p', { class: 'muted small' }, 'Fotos de los jugadores (se reconocen por su nombre) y tus canciones para cada momento. Se guardan en este portátil.'),
  );
}

function importReport(imp) {
  const lines = [...imp.errors.map((e) => ({ ...e, kind: 'error' })), ...imp.warnings.map((w) => ({ ...w, kind: 'warn' }))];
  return h(
    'div',
    { class: `import-report ${imp.failed ? 'failed' : 'ok'}` },
    h(
      'p',
      { class: 'import-title' },
      imp.failed
        ? `✗ "${imp.fileName}" tiene ${imp.errors.length} ${imp.errors.length === 1 ? 'error' : 'errores'}: no se ha cargado.`
        : `✓ "${imp.fileName}" cargado: ${imp.sections} secciones${imp.teams ? `, ${imp.teams} equipos` : ''}.`,
    ),
    lines.length
      ? h(
          'ul',
          {},
          lines.slice(0, 12).map((l) => h('li', { class: l.kind }, `${l.sheet}${l.row ? `, fila ${l.row}` : ''}: ${l.message}`)),
          lines.length > 12 ? h('li', {}, `… y ${lines.length - 12} más.`) : null,
        )
      : null,
  );
}

function teamsBoardView(view, ctx) {
  const columns = view.teams.map((team) => ({ team, members: view.players.filter((p) => p.teamId === team.id) }));
  const teamless = view.players.filter((p) => !p.teamId);
  if (teamless.length) columns.push({ team: { id: null, name: 'Sin equipo', color: 'gris' }, members: teamless });
  return h(
    'div',
    { class: 'teams-board' },
    columns.map(({ team, members }) =>
      h(
        'div',
        { class: `team-col ${team.id ? '' : 'no-team'}`, style: { '--tc': getColor(team.color).bg, '--tc-fg': getColor(team.color).fg } },
        h('h3', { class: 'team-name' }, team.name, h('span', { class: 'team-count' }, String(members.length))),
        members.length
          ? h(
              'ul',
              {},
              members.map((p) =>
                h(
                  'li',
                  { class: p.connected ? '' : 'offline' },
                  avatar(p, 'mini-avatar'),
                  h('span', { class: 'member-name' }, p.name),
                  team.id
                    ? h(
                        'button',
                        {
                          type: 'button',
                          class: `spokes-btn ${view.spokespeople?.[team.id] === p.id ? 'on' : ''}`,
                          title: view.spokespeople?.[team.id] === p.id ? 'Portavoz del equipo' : `Hacer portavoz a ${p.name}`,
                          'aria-label': view.spokespeople?.[team.id] === p.id ? `${p.name} es el portavoz` : `Hacer portavoz a ${p.name}`,
                          onclick: () => ctx.onSpokesperson(team.id, p.id),
                        },
                        '📣',
                      )
                    : null,
                  h(
                    'select',
                    {
                      class: 'move-team',
                      title: `Mover a ${p.name} de equipo`,
                      'aria-label': `Equipo de ${p.name}`,
                      onchange: (e) => ctx.onMoveTeam(p.id, e.target.value),
                    },
                    team.id ? null : h('option', { value: '', selected: true }, '—'),
                    view.teams.map((t) => h('option', { value: t.id, selected: t.id === p.teamId }, t.name)),
                  ),
                ),
              ),
            )
          : h('p', { class: 'muted small' }, team.id ? 'Nadie todavía' : ''),
      ),
    ),
  );
}

function playersBoardView(view) {
  if (!view.players.length) return h('div', { class: 'empty' }, 'Todavía no hay nadie. ¡Escanead el QR!');
  return h(
    'ul',
    { class: 'chips' },
    view.players.map((p) => h('li', { class: p.connected ? '' : 'offline' }, avatar(p, 'mini-avatar'), h('span', { class: 'member-name' }, p.name))),
  );
}

// ---------------------------------------------------------------------------------------- Portada e intro

// Introducción del concurso: título, qué secciones habrá esta noche, equipos y cómo se juega.
export function coverScreen(view) {
  const teams = view.standings.map((s) => s.team);
  return h(
    'div',
    { class: 'cover' },
    h('p', { class: 'cover-kicker' }, '¡Bienvenidos a…'),
    kinetic('h1', 'cover-title display', view.title),
    h(
      'div',
      { class: 'cover-body' },
      h(
        'section',
        { class: 'cover-block' },
        h('h2', {}, `Esta noche · ${view.sectionCount} ${view.sectionCount === 1 ? 'sección' : 'secciones'}`),
        h(
          'ol',
          { class: `cover-sections ${view.sections.length > 5 ? 'many' : ''}` },
          view.sections.map((s, i) =>
            h(
              'li',
              { style: { '--d': `${900 + i * 140}ms`, '--env': envGradient(s.env) } },
              h('span', { class: 'cs-num' }, String(i + 1)),
              h('span', { class: 'cs-name' }, s.name),
              h('span', { class: 'cs-type' }, s.label),
            ),
          ),
        ),
      ),
      h(
        'section',
        { class: 'cover-block' },
        h('h2', {}, 'Cómo se juega'),
        h(
          'ul',
          { class: 'cover-rules' },
          [
            ['📱', 'Tu móvil es tu pulsador: respondes desde él.'],
            ['⏱️', 'Antes de cada pregunta, una cuenta atrás. ¡No pulses antes de tiempo!'],
            ['🔒', 'La primera respuesta es la que vale: tócala dos veces para confirmar.'],
            ['🚨', 'Si sales de la app con una pregunta abierta, ¡te pillamos! Y tu respuesta no cuenta.'],
            teams.length ? ['🏆', `Juegan ${teams.length} equipos: cada punto tuyo suma para el tuyo.`] : ['🏆', 'Gana quien más puntos tenga al final.'],
          ].map(([icon, text], i) => h('li', { style: { '--d': `${1300 + i * 220}ms` } }, h('span', { class: 'emoji' }, icon), h('span', {}, text))),
        ),
        teams.length
          ? h(
              'ul',
              { class: 'cover-teams' },
              teams.map((t) => h('li', { style: { '--tc': getColor(t.color).bg, '--tc-fg': getColor(t.color).fg } }, t.name)),
            )
          : h('p', { class: 'cover-sub' }, `${view.players.length} concursantes`),
      ),
    ),
  );
}

export function introScreen(view) {
  const s = view.section;
  return h(
    'div',
    { class: 'intro anim-in' },
    h('p', { class: 'intro-kicker' }, `Sección ${view.sectionIndex + 1} de ${view.sectionCount} · ${getEnv(sectionEnv(s, view.sectionIndex)).name}`),
    kinetic('h1', 'intro-title display', s.name),
    h('p', { class: 'intro-type' }, view.sectionLabel),
    s.description ? h('p', { class: 'intro-desc' }, s.description) : null,
    h('p', { class: 'intro-points' }, pointsText(s.points, s.points.length > 1)),
    view.playable ? null : h('p', { class: 'intro-soon' }, 'Esta sección llegará en una próxima versión: se saltará.'),
    view.turns ? turnsIntro(view.turns) : null,
  );
}

/** Por turnos: cada uno responde una pregunta; el portavoz de cada equipo elige el orden en su móvil. */
function turnsIntro(turns) {
  return h(
    'div',
    { class: 'turns-intro' },
    h('p', { class: 'how' }, 'Por turnos: cada uno responde una pregunta. ¡Portavoces, ordenad a vuestro equipo de la más fácil a la más difícil!'),
    h(
      'ul',
      { class: 'turns-teams' },
      turns.teams.map((t) =>
        h(
          'li',
          { class: t.ready ? 'ready' : '', style: { '--tc': getColor(t.team.color).bg } },
          h('strong', {}, t.team.name),
          h('span', { class: 'muted' }, t.ready ? '✓ Orden listo' : `📣 ${t.spokesperson?.name ?? '¿?'} está ordenando…`),
          t.ready
            ? h(
                'ol',
                {},
                t.order.filter(Boolean).map((p) => h('li', {}, h('span', { class: 'emoji' }, avatarOf(p)), p.name)),
              )
            : null,
        ),
      ),
    ),
  );
}

// ---------------------------------------------------------------------------------------- Marcador y final

// Puntos de la última vez que se enseñó el marcador: el siguiente empieza ahí, en el orden de entonces, y luego
// los puntos ruedan hasta los de ahora y las filas se reordenan. La primera vez, todos parten de 0.
const shownScores = new Map(); // 't:id' / 'p:id' → puntos
const ROLL_AT = 700; // ms: empiezan a rodar los puntos
const REORDER_AT = 2000; // ms: se reordenan las filas

export function scoreboardScreen(view, { title = 'Marcador' } = {}) {
  const max = Math.max(1, ...view.standings.map((s) => s.score), ...view.players.map((p) => p.score));
  const width = (score) => `${Math.max(3, (Math.max(0, score) / max) * 100)}%`;

  const teams = view.standings.map((s) => ({ key: `t:${s.team.id}`, s, score: s.score }));
  const players = [...view.players].sort((a, b) => b.score - a.score).map((p) => ({ key: `p:${p.id}`, p, score: p.score }));
  for (const list of [teams, players]) for (const r of list) r.old = shownScores.get(r.key) ?? 0;
  const byOld = (list) => [...list].sort((a, b) => b.old - a.old || list.indexOf(a) - list.indexOf(b));

  const teamList = teams.length
    ? h(
        'ol',
        { class: 'sb-teams' },
        byOld(teams).map((r) =>
          h(
            'li',
            { 'data-key': r.key, style: { '--tc': getColor(r.s.team.color).bg, '--tc-fg': getColor(r.s.team.color).fg, '--w': width(r.old) } },
            h('span', { class: 'sb-place' }),
            h('span', { class: 'sb-team-name' }, r.s.team.name),
            h('span', { class: 'sb-bar' }, h('span', { class: 'sb-fill' })),
            h('span', { class: 'sb-score' }, odometer(r.score, r.old, { delay: ROLL_AT })),
          ),
        ),
      )
    : null;
  const playerList = h(
    'ol',
    { class: `sb-players ${teams.length ? 'compact' : ''} ${players.length > 12 ? 'many' : ''}` },
    byOld(players).map((r) =>
      h(
        'li',
        { 'data-key': r.key, style: { '--pc': getColor(r.p.color).bg } },
        h('span', { class: 'sb-place' }),
        avatar(r.p, 'mini-avatar'),
        h('span', { class: 'member-name' }, r.p.name),
        h('span', { class: 'sb-score' }, odometer(r.score, r.old, { delay: ROLL_AT })),
      ),
    ),
  );
  const root = h('div', { class: 'scoreboard anim-in' }, kinetic('h1', 'sb-title display', title), teamList, playerList);

  const places = (list) => [...list.children].forEach((li, i) => (li.querySelector('.sb-place').textContent = `${i + 1}º`));
  for (const list of [teamList, playerList]) if (list) places(list);
  later(root, ROLL_AT, () =>
    teamList?.querySelectorAll('li').forEach((li) => li.style.setProperty('--w', width(teams.find((r) => r.key === li.dataset.key).score))),
  );
  later(root, REORDER_AT, () => {
    for (const [list, rows] of [
      [teamList, teams],
      [playerList, players],
    ]) {
      if (!list) continue;
      const before = [...list.children].map((li) => li.dataset.key).join();
      flipReorder(list, rows.map((r) => r.key));
      places(list);
      if (before !== rows.map((r) => r.key).join()) sound.play('pop');
    }
  });
  for (const r of [...teams, ...players]) shownScores.set(r.key, r.score);
  return root;
}

// Podio: aparece el 3º, luego el 2º y, tras un redoble, el 1º con confeti y fanfarria.
const PODIUM_AT = { 3: 800, 2: 2300, 1: 4300 };

export function finalScreen(view) {
  const podium = (entries) =>
    h(
      'div',
      { class: 'podium' },
      // Orden visual 2º · 1º · 3º
      [1, 0, 2].map((i) => {
        const e = entries[i];
        if (!e) return h('div', { class: 'podium-step empty' });
        return h(
          'div',
          { class: `podium-step p${i + 1}`, style: { '--pc': getColor(e.color).bg, '--pc-fg': getColor(e.color).fg, '--d': `${PODIUM_AT[i + 1]}ms` } },
          e.icon || e.face ? h('span', { class: 'podium-icon emoji' }, avatarOf(e)) : null,
          h('span', { class: 'podium-name' }, e.name),
          h('span', { class: 'podium-score' }, `${e.score} pts`),
          h('span', { class: 'podium-block' }, `${i + 1}º`),
        );
      }),
    );
  const teamEntries = view.standings.map((s) => ({ name: s.team.name, color: s.team.color, score: s.score }));
  const playerEntries = [...view.players].sort((a, b) => b.score - a.score);
  const root = h(
    'div',
    { class: 'final' },
    kinetic('h1', 'final-title display', '¡Enhorabuena!'),
    h(
      'div',
      { class: `final-podiums ${teamEntries.length ? 'two' : ''}` },
      teamEntries.length ? h('div', {}, h('h2', {}, 'Equipos'), podium(teamEntries)) : null,
      h('div', {}, h('h2', {}, teamEntries.length ? 'Concursantes' : 'Podio'), podium(playerEntries)),
    ),
  );
  sound.play('pop', PODIUM_AT[3]);
  sound.play('pop', PODIUM_AT[2]);
  sound.play('roll', PODIUM_AT[1] - 900);
  sound.play('fanfare', PODIUM_AT[1]);
  later(root, PODIUM_AT[1], () => celebrate(4500));
  return root;
}
