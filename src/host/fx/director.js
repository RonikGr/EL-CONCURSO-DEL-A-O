// "Realizador": compara cada vista de la sala con la anterior y lanza lo que no es pantalla en sí: el entorno del
// fondo, la música de cada sección y los efectos de sonido y confeti de cada momento (abrir turno, pulsar, acertar…).
// Los revelados con suspense programan sus propios sonidos (answerStage, screens).
import { sound } from './audio.js';
import { burst, celebrate } from './confetti.js';
import { HOME_ENV, sectionEnv } from '../../shared/environments.js';
import { SCREEN } from '../../core/runner.js';
import { PHASE } from '../../core/game.js';
import { APHASE, isChoice } from '../../core/answers.js';
import { FPHASE } from '../../core/free.js';

/** Entorno de una vista: el de la sección en juego; preparación, portada y final, la noche de luna. */
export function envFor(view) {
  if (!view.section || view.screen === SCREEN.SETUP || view.screen === SCREEN.COVER || view.screen === SCREEN.FINAL) return HOME_ENV;
  return sectionEnv(view.section, view.sectionIndex);
}

/** Clave de "pantalla": si cambia, la pantalla entra con transición. */
export function screenKey(view) {
  return [view.peekScoreboard ? 'peek' : view.screen, view.sectionIndex, view.screen === SCREEN.PLAY ? view.itemIndex : ''].join('|');
}

function snapshot(view) {
  const t = performance.now();
  const g = view.game;
  const a = view.answer;
  const f = view.free;
  return {
    key: screenKey(view),
    screen: view.peekScoreboard ? 'peek' : view.screen,
    item: `${view.sectionIndex}|${view.itemIndex}`,
    game: g && { phase: g.phase, started: g.phase === PHASE.OPEN && t >= g.tOpen, judged: g.judged, winner: g.winner?.id ?? null },
    answer: a && {
      round: a.roundId,
      kind: a.kind,
      phase: a.phase,
      started: a.phase === APHASE.OPEN && a.tOpen != null && t >= a.tOpen,
      green: a.tGreen != null && t >= a.tGreen,
      answered: a.answeredIds?.length ?? 0,
    },
    free: f && {
      round: f.roundId,
      phase: f.phase,
      out: f.participants?.filter((p) => p.out != null).length ?? 0,
      count: f.participants?.reduce((s, p) => s + (p.count ?? 0), 0) ?? 0,
    },
  };
}

export function createDirector({ backdrop }) {
  let prev = null;

  return function direct(view) {
    const env = envFor(view);
    backdrop?.setEnv(env);
    sound.setMood(env);

    const n = snapshot(view);
    const p = prev;
    prev = n;

    // Tensión (música baja y latido): mientras se puede pulsar o responder.
    const tense =
      (n.game?.phase === PHASE.OPEN && n.game.started) ||
      (n.answer?.phase === APHASE.OPEN && n.answer.started && !(n.answer.kind === 'reflejos' && n.answer.green)) ||
      n.free?.phase === FPHASE.RUNNING;
    sound.setTension(!!tense && !n.screen.startsWith('peek'));

    if (!p) return;
    if (n.key !== p.key) {
      if (n.screen === SCREEN.INTRO) {
        sound.play('whoosh');
        sound.play('gong', 250);
        backdrop?.flash(0.35);
      } else if (n.screen === SCREEN.COVER) {
        sound.play('hit');
        sound.play('fanfare', 200);
      } else if (n.screen === SCREEN.SCOREBOARD || n.screen === 'peek') {
        sound.play('whoosh');
        sound.play('roll', 300);
      } else if (n.screen !== SCREEN.FINAL) {
        sound.play('whoosh');
      }
    }

    // Pulsador
    const g = n.game;
    const pg = p.item === n.item ? p.game : null;
    if (g) {
      if (g.started && !pg?.started) sound.play('go');
      if (g.phase === PHASE.RESULT && pg?.phase !== PHASE.RESULT) {
        sound.play('buzz');
        backdrop?.flash(0.4);
      }
      if (g.judged === 'correct' && pg?.judged !== 'correct') {
        sound.play('correct');
        burst({ y: 0.45, count: 70 });
      }
      // Fallo: vuelve a abrirse para el resto, o se cierra si no queda nadie.
      if (pg?.phase === PHASE.RESULT && (g.phase === PHASE.OPEN || g.phase === PHASE.CLOSED) && !g.judged) sound.play('wrong');
    }

    // Respuestas (Test, Verdad o mentira, Votación, Estimación, Contador, Reflejos)
    const a = n.answer;
    const pa = p.answer?.round === a?.round ? p.answer : null;
    if (a) {
      if (a.started && !pa?.started) sound.play(a.kind === 'reflejos' ? 'count' : 'go');
      if (a.kind === 'reflejos' && a.started && a.green && !pa?.green && a.phase === APHASE.OPEN) {
        sound.play('go');
        backdrop?.flash(0.5);
      }
      if (pa && a.answered > pa.answered && a.phase === APHASE.OPEN) sound.play('blip');
      if (a.phase === APHASE.CLOSED && pa?.phase === APHASE.OPEN) sound.play('bell');
      if (a.phase === APHASE.REVEALED && pa && pa.phase !== APHASE.REVEALED) {
        if (isChoice(a.kind)) {
          sound.play('hit');
          sound.play('correct', 250);
          backdrop?.flash(0.3);
        } else {
          sound.play('riser');
        }
      }
    }

    // Libre
    const f = n.free;
    const pf = p.free?.round === f?.round ? p.free : null;
    if (f && pf) {
      if (f.phase === FPHASE.RUNNING && pf.phase !== FPHASE.RUNNING) sound.play('go');
      if (f.out > pf.out) sound.play('out');
      if (f.count !== pf.count) sound.play(f.count > pf.count ? 'blip' : 'pop');
      if (f.phase === FPHASE.STOPPED && pf.phase === FPHASE.RUNNING) sound.play('bell');
      if (f.phase === FPHASE.AWARDED && pf.phase !== FPHASE.AWARDED) {
        sound.play('fanfare');
        celebrate(2200);
      }
    }
  };
}
