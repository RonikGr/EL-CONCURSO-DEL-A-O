// Pantalla de la tele en la sección Libre ("Fit o Fat"): presentación de la prueba, cronómetro o contadores
// en grande y ganador. Solo espectáculo: lo arbitra el presentador desde el mando.
import { fill, h } from '../shared/dom.js';
import { getColor, getIcon } from '../shared/appearance.js';
import { FPHASE, TOOL } from '../core/free.js';

/** 83 456 ms → "1:23,4" */
export function formatClock(ms) {
  const total = Math.max(0, ms) / 1000;
  const minutes = Math.floor(total / 60);
  const seconds = total - minutes * 60;
  return `${minutes}:${seconds.toFixed(1).padStart(4, '0').replace('.', ',')}`;
}

export function createFreeStage() {
  const root = h('section', { class: 'free-stage' });
  let raf = 0;

  function render(view) {
    cancelAnimationFrame(raf);
    const f = view.free;
    if (!f) return;
    root.dataset.phase = f.phase;
    const progress = view.itemCount > 1 ? `Prueba ${view.itemIndex + 1} de ${view.itemCount}` : '';
    const header = h('p', { class: 'stage-q' }, [view.section.name, progress].filter(Boolean).join(' · '));
    const pointsText = `${f.points} ${f.points === 1 ? 'punto' : 'puntos'} para ${f.byTeams ? 'el equipo ganador' : 'quien gane'}`;

    if (f.phase === FPHASE.SETUP) {
      return fill(
        root,
        header,
        h('h2', { class: 'free-title big' }, f.title),
        f.description ? h('p', { class: 'free-desc' }, f.description) : null,
        f.participants.length
          ? h('ul', { class: 'free-chips' }, f.participants.map((p) => chip(p)))
          : h('p', { class: 'answer-prompt' }, `El presentador elige ${f.byTeams ? 'qué equipos participan' : 'quién participa'}`),
        h('p', { class: 'intro-points' }, pointsText),
      );
    }

    if (f.phase === FPHASE.AWARDED) {
      return fill(
        root,
        header,
        h('h2', { class: 'free-title' }, f.title),
        h('p', { class: 'free-winner' }, '🏆 ', f.winners.map((w) => w.name).join(' y ')),
        h('p', { class: 'result-verdict' }, `+${f.points} ${f.winners.length > 1 ? 'cada uno' : ''}`.trim()),
        f.tool === TOOL.NONE ? null : results(f),
      );
    }

    // En marcha o parada: reloj en grande y cada participante.
    const clock = h('p', { class: `big-clock free-clock ${f.phase === FPHASE.STOPPED ? 'stopped' : ''}` });
    fill(
      root,
      header,
      h('h2', { class: 'free-title' }, f.title),
      clock,
      h(
        'ul',
        { class: `free-cards ${f.tool}` },
        f.participants.map((p) =>
          h(
            'li',
            { class: p.out != null ? 'out' : '', style: { '--pc': getColor(p.color).bg, '--pc-fg': getColor(p.color).fg } },
            h('span', { class: 'free-name' }, p.icon ? h('span', { class: 'emoji' }, getIcon(p.icon).glyph) : null, ' ', p.name),
            f.tool === TOOL.COUNTER
              ? h('span', { class: 'free-count' }, String(p.count))
              : h('span', { class: 'free-status' }, p.out != null ? `Cayó a los ${formatClock(p.out)}` : f.phase === FPHASE.STOPPED ? '¡Aguantó!' : 'Aguanta…'),
          ),
        ),
      ),
    );
    const tick = () => {
      clock.textContent = formatClock((f.tStop ?? performance.now()) - f.tStart);
      if (f.phase === FPHASE.RUNNING) raf = requestAnimationFrame(tick);
    };
    tick();
  }

  return { root, render, stop: () => cancelAnimationFrame(raf) };
}

function chip(p) {
  return h(
    'li',
    { style: { '--pc': getColor(p.color).bg, '--pc-fg': getColor(p.color).fg } },
    p.icon ? h('span', { class: 'emoji' }, getIcon(p.icon).glyph) : null,
    h('span', {}, p.name),
  );
}

function results(f) {
  return h(
    'ol',
    { class: 'estimates' },
    f.ranking.map((r) =>
      h(
        'li',
        { class: r.place === 1 ? 'first' : '', style: { '--pc': getColor(r.who.color).bg } },
        h('span', { class: 'f-place' }, `${r.place}º`),
        h('span', {}, r.who.icon ? getIcon(r.who.icon).glyph : ''),
        h('span', { class: 'es-name' }, r.who.name),
        h('span', { class: 'es-value' }, f.tool === TOOL.STOPWATCH ? formatClock(r.value) : String(r.value)),
        h('span', {}),
        h('strong', { class: 'es-points' }, f.awarded[r.id] ? `+${f.awarded[r.id]}` : ''),
      ),
    ),
  );
}
