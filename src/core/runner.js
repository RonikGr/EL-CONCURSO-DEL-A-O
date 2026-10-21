// Por dónde va el concurso: qué pantalla se ve en la tele y qué sección / pregunta toca. Lógica pura.
//
//   setup ─▶ cover ─▶ [ intro ─▶ play (pregunta 1…N) ─▶ scoreboard ] × secciones ─▶ final
//
// Una sección sin lista de preguntas (pulsador improvisado) sigue en "play" hasta que el presentador la termina.
// Las secciones de tipos aún no disponibles (o sin filas) muestran su intro y se saltan al avanzar.
import { PLAYABLE_TYPES, SECTION_TYPES } from './show.js';

export const SCREEN = {
  SETUP: 'setup',
  COVER: 'cover',
  INTRO: 'intro',
  PLAY: 'play',
  SCOREBOARD: 'scoreboard',
  FINAL: 'final',
};

export function isPlayable(section) {
  if (!section || !PLAYABLE_TYPES.has(section.type)) return false;
  return !SECTION_TYPES[section.type].needsItems || section.items.length > 0;
}

export class ShowRunner {
  constructor(show, saved = null) {
    this.show = show;
    this.screen = SCREEN.SETUP;
    this.sectionIndex = 0;
    this.itemIndex = 0;
    this.shown = { question: false, answer: false }; // qué se ha enseñado en la tele de la pregunta actual
    this.peekScoreboard = false; // marcador "por encima" sin perder el sitio (tecla M)
    if (saved && Object.values(SCREEN).includes(saved.screen)) {
      this.screen = saved.screen;
      this.sectionIndex = Math.min(Math.max(0, saved.sectionIndex | 0), Math.max(0, show.sections.length - 1));
      this.itemIndex = Math.max(0, saved.itemIndex | 0);
      this.shown = { question: !!saved.shown?.question, answer: !!saved.shown?.answer };
      if (this.itemCount && this.itemIndex >= this.itemCount) this.itemIndex = this.itemCount - 1;
      if (!show.sections.length && this.screen !== SCREEN.SETUP && this.screen !== SCREEN.COVER) this.screen = SCREEN.FINAL;
    }
  }

  get section() {
    return this.show.sections[this.sectionIndex] ?? null;
  }

  /** 0 = sección sin lista (preguntas improvisadas). */
  get itemCount() {
    return this.section?.items.length ?? 0;
  }

  get item() {
    return this.section?.items[this.itemIndex] ?? null;
  }

  /** Clave de "qué pregunta se está jugando": si cambia, el motor de la pregunta empieza de cero. */
  get playKey() {
    return this.screen === SCREEN.PLAY ? `${this.sectionIndex}:${this.itemIndex}` : null;
  }

  next() {
    this.peekScoreboard = false;
    switch (this.screen) {
      case SCREEN.SETUP:
        return this.#go(SCREEN.COVER);
      case SCREEN.COVER:
        return this.show.sections.length ? this.#go(SCREEN.INTRO, 0) : this.#go(SCREEN.FINAL);
      case SCREEN.INTRO:
        return isPlayable(this.section) ? this.#go(SCREEN.PLAY, this.sectionIndex, 0) : this.#afterSection();
      case SCREEN.PLAY:
        return this.nextItem();
      case SCREEN.SCOREBOARD:
        return this.#afterSection();
      default:
        return false;
    }
  }

  /** Siguiente pregunta; tras la última, el marcador. */
  nextItem() {
    if (this.screen !== SCREEN.PLAY) return false;
    this.peekScoreboard = false;
    if (this.itemCount && this.itemIndex + 1 >= this.itemCount) return this.#go(SCREEN.SCOREBOARD);
    return this.#go(SCREEN.PLAY, this.sectionIndex, this.itemIndex + 1);
  }

  prev() {
    this.peekScoreboard = false;
    switch (this.screen) {
      case SCREEN.COVER:
        return this.#go(SCREEN.SETUP);
      case SCREEN.INTRO:
        return this.sectionIndex > 0 ? this.#go(SCREEN.SCOREBOARD, this.sectionIndex - 1) : this.#go(SCREEN.COVER);
      case SCREEN.PLAY:
        return this.itemIndex > 0 ? this.#go(SCREEN.PLAY, this.sectionIndex, this.itemIndex - 1) : this.#go(SCREEN.INTRO);
      case SCREEN.SCOREBOARD:
        if (!isPlayable(this.section)) return this.#go(SCREEN.INTRO);
        return this.#go(SCREEN.PLAY, this.sectionIndex, this.itemCount ? this.itemCount - 1 : this.itemIndex);
      case SCREEN.FINAL:
        return this.show.sections.length ? this.#go(SCREEN.SCOREBOARD, this.show.sections.length - 1) : this.#go(SCREEN.COVER);
      default:
        return false;
    }
  }

  goToSection(index) {
    if (!(index >= 0 && index < this.show.sections.length)) return false;
    this.peekScoreboard = false;
    return this.#go(SCREEN.INTRO, index, 0);
  }

  /** "Terminar sección": al marcador (útil en secciones sin lista de preguntas). */
  endSection() {
    if (this.screen !== SCREEN.PLAY) return false;
    return this.#go(SCREEN.SCOREBOARD);
  }

  /** Volver a preparación (p. ej. para cargar otro concurso). */
  toSetup() {
    this.peekScoreboard = false;
    return this.#go(SCREEN.SETUP, 0, 0);
  }

  toggleScoreboard() {
    if (this.screen === SCREEN.SETUP) return false;
    this.peekScoreboard = !this.peekScoreboard;
    return true;
  }

  showQuestion() {
    if (this.screen !== SCREEN.PLAY || this.shown.question) return false;
    this.shown.question = true;
    return true;
  }

  showAnswer() {
    if (this.screen !== SCREEN.PLAY || this.shown.answer) return false;
    this.shown = { question: true, answer: true };
    return true;
  }

  toJSON() {
    return { screen: this.screen, sectionIndex: this.sectionIndex, itemIndex: this.itemIndex, shown: { ...this.shown } };
  }

  #afterSection() {
    const nextIndex = this.sectionIndex + 1;
    return nextIndex < this.show.sections.length ? this.#go(SCREEN.INTRO, nextIndex, 0) : this.#go(SCREEN.FINAL);
  }

  #go(screen, sectionIndex = this.sectionIndex, itemIndex = screen === SCREEN.PLAY ? this.itemIndex : 0) {
    const itemChanged = sectionIndex !== this.sectionIndex || itemIndex !== this.itemIndex || screen !== this.screen;
    this.screen = screen;
    this.sectionIndex = sectionIndex;
    this.itemIndex = itemIndex;
    if (itemChanged) this.shown = { question: false, answer: false };
    return true;
  }
}
