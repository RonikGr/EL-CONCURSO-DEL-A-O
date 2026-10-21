// Pantallas de la tele (salvo el juego del Pulsador, en stage.js). Cada función devuelve el contenido de la
// pantalla a partir de `room.view()`; main.js decide cuándo repintar.
import { h } from '../shared/dom.js';
import { getColor, getIcon } from '../shared/appearance.js';
import { MAX_PLAYERS, MIN_PLAYERS } from '../core/players.js';

const kbd = (key) => h('kbd', {}, key);
const avatar = (p, cls = 'avatar') =>
  h('span', { class: `${cls} emoji`, style: { '--pc': getColor(p.color).bg, '--pc-fg': getColor(p.color).fg }, 'aria-hidden': 'true' }, getIcon(p.icon).glyph);

function pointsText(points, ranked) {
  if (!points?.length) return '';
  if (points.length > 1) return `${points.join(' · ')} puntos para los ${points.length} primeros`;
  const n = points[0];
  return `${n} ${Math.abs(n) === 1 ? 'punto' : 'puntos'}${ranked ? '' : ' por acierto'}`;
}

// ---------------------------------------------------------------------------------------- Preparación

/**
 * @param ctx {joinQr, controlQr, joinUrlText, onFile, onStart, onLockTeams, onMoveTeam}
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

export function coverScreen(view) {
  return h(
    'div',
    { class: 'cover anim-in' },
    h('p', { class: 'cover-kicker' }, '¡Bienvenidos a…'),
    h('h1', { class: 'cover-title' }, view.title),
    h('p', { class: 'cover-sub' }, `${view.sectionCount} ${view.sectionCount === 1 ? 'sección' : 'secciones'} · ${view.players.length} concursantes`),
  );
}

export function introScreen(view) {
  const s = view.section;
  return h(
    'div',
    { class: 'intro anim-in' },
    h('p', { class: 'intro-kicker' }, `Sección ${view.sectionIndex + 1} de ${view.sectionCount}`),
    h('h1', { class: 'intro-title' }, s.name),
    h('p', { class: 'intro-type' }, view.sectionLabel),
    s.description ? h('p', { class: 'intro-desc' }, s.description) : null,
    h('p', { class: 'intro-points' }, pointsText(s.points, s.points.length > 1)),
    view.playable ? null : h('p', { class: 'intro-soon' }, 'Esta sección llegará en una próxima versión: se saltará.'),
  );
}

// ---------------------------------------------------------------------------------------- Marcador y final

export function scoreboardScreen(view, { title = 'Marcador' } = {}) {
  const players = [...view.players].sort((a, b) => b.score - a.score);
  const max = Math.max(1, ...view.standings.map((s) => s.score), ...players.map((p) => p.score));
  return h(
    'div',
    { class: 'scoreboard anim-in' },
    h('h1', { class: 'sb-title' }, title),
    view.standings.length
      ? h(
          'ol',
          { class: 'sb-teams' },
          view.standings.map((s, i) =>
            h(
              'li',
              { style: { '--tc': getColor(s.team.color).bg, '--tc-fg': getColor(s.team.color).fg, '--w': `${Math.max(4, (Math.max(0, s.score) / max) * 100)}%` } },
              h('span', { class: 'sb-place' }, `${i + 1}º`),
              h('span', { class: 'sb-team-name' }, s.team.name),
              h('span', { class: 'sb-bar' }, h('span', { class: 'sb-fill' })),
              h('span', { class: 'sb-score' }, String(s.score)),
            ),
          ),
        )
      : null,
    h(
      'ol',
      { class: `sb-players ${view.standings.length ? 'compact' : ''}` },
      players.map((p, i) =>
        h(
          'li',
          { style: { '--pc': getColor(p.color).bg } },
          h('span', { class: 'sb-place' }, `${i + 1}º`),
          avatar(p, 'mini-avatar'),
          h('span', { class: 'member-name' }, p.name),
          h('span', { class: 'sb-score' }, String(p.score)),
        ),
      ),
    ),
  );
}

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
          { class: `podium-step p${i + 1}`, style: { '--pc': getColor(e.color).bg, '--pc-fg': getColor(e.color).fg } },
          e.icon ? h('span', { class: 'podium-icon emoji' }, getIcon(e.icon).glyph) : null,
          h('span', { class: 'podium-name' }, e.name),
          h('span', { class: 'podium-score' }, `${e.score} pts`),
          h('span', { class: 'podium-block' }, `${i + 1}º`),
        );
      }),
    );
  const teamEntries = view.standings.map((s) => ({ name: s.team.name, color: s.team.color, score: s.score }));
  const playerEntries = [...view.players].sort((a, b) => b.score - a.score);
  return h(
    'div',
    { class: 'final anim-in' },
    h('h1', { class: 'final-title' }, '¡Enhorabuena!'),
    teamEntries.length ? [h('h2', {}, 'Equipos'), podium(teamEntries)] : null,
    h('h2', {}, teamEntries.length ? 'Concursantes' : 'Podio'),
    podium(playerEntries),
  );
}
