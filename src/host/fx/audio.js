// Sonido del espectáculo, generado al momento con Web Audio (sin archivos: nada que descargar ni licencias).
//  - Música ambiental distinta por entorno: un colchón grave que cambia de acorde, una caja de música que improvisa
//    sobre una escala menor, bajo, y ambiente (viento, lluvia, fuego, burbujas, búhos).
//  - Efectos: entrada de pantalla, gong, ¡pulsad!, pulsación, acierto, fallo, tictac, campana, trueno, redoble…
//  - Tensión: con el turno abierto, la música baja y suena un latido.
// El navegador no deja sonar nada hasta que alguien toca la página: se activa con la primera tecla o clic.

const MOODS = {
  luna: { root: 45, scale: [0, 2, 3, 5, 7, 8, 10], bpm: 64, bells: 0.5, wave: 'sawtooth', cutoff: 700, amb: ['wind'] },
  cementerio: { root: 38, scale: [0, 1, 3, 5, 7, 8, 10], bpm: 56, bells: 0.35, wave: 'sawtooth', cutoff: 520, amb: ['wind', 'owl'] },
  bosque: { root: 40, scale: [0, 2, 3, 5, 7, 9, 10], bpm: 60, bells: 0.45, wave: 'triangle', cutoff: 900, amb: ['wind', 'owl'] },
  calabazas: { root: 43, scale: [0, 2, 3, 5, 7, 8, 11], bpm: 84, bells: 0.6, wave: 'sawtooth', cutoff: 800, amb: ['fire'] },
  laboratorio: { root: 36, scale: [0, 2, 4, 6, 8, 10], bpm: 72, bells: 0.5, wave: 'square', cutoff: 600, amb: ['bubbles'] },
  mansion: { root: 35, scale: [0, 2, 3, 5, 7, 8, 11], bpm: 58, bells: 0.4, wave: 'square', cutoff: 650, amb: ['rain'] },
  telarana: { root: 42, scale: [0, 1, 3, 6, 7, 9], bpm: 66, bells: 0.55, wave: 'triangle', cutoff: 750, amb: ['wind'] },
  aquelarre: { root: 38, scale: [0, 1, 4, 5, 7, 8, 10], bpm: 92, bells: 0.45, wave: 'sawtooth', cutoff: 900, amb: ['fire'], drums: true },
  cripta: { root: 37, scale: [0, 2, 3, 5, 7, 8, 10], bpm: 50, bells: 0.3, wave: 'sine', cutoff: 1200, amb: ['wind'] },
  tormenta: { root: 33, scale: [0, 1, 3, 5, 7, 8, 10], bpm: 54, bells: 0.3, wave: 'sawtooth', cutoff: 480, amb: ['rain', 'wind'] },
};
// Acordes del colchón (desplazamiento sobre la tónica): i · VI · VII · v
const PROGRESSION = [0, -4, -2, -5];

const mtof = (m) => 440 * 2 ** ((m - 69) / 12);

class SoundEngine extends EventTarget {
  ctx = null;
  settings = { musicOn: true, sfxOn: true, volume: 70 };
  mood = null;
  #moodId = null;
  #tension = false;
  #timers = new Set();
  #noise = null;
  #schedule = 0;
  #beat = 0;
  #nextBeat = 0;
  #melody = 0;

  constructor() {
    super();
    const unlock = () => this.unlock();
    addEventListener('pointerdown', unlock, true);
    addEventListener('keydown', unlock, true);
  }

  get unlocked() {
    return this.ctx?.state === 'running';
  }

  /** Crea el contexto de audio (tiene que ser dentro de un gesto del usuario). */
  unlock() {
    if (this.unlocked) return;
    if (!this.ctx) {
      const Ctx = window.AudioContext ?? window.webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx({ latencyHint: 'interactive' });
      this.#build();
    }
    this.ctx.resume().then(() => {
      this.#startMusic();
      this.dispatchEvent(new Event('unlock'));
    });
  }

  configure(settings) {
    this.settings = { ...this.settings, ...settings };
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime((this.settings.volume / 100) * 0.9, t, 0.1);
    this.sfxBus.gain.setTargetAtTime(this.settings.sfxOn ? 1 : 0, t, 0.05);
    this.#applyMusicLevel();
  }

  /** Entorno actual: cambia la música con un fundido. */
  setMood(id) {
    if (this.#moodId === id) return;
    this.#moodId = id;
    if (this.unlocked) this.#switchMood();
  }

  /** Turno abierto: la música baja y suena un latido. */
  setTension(on) {
    if (this.#tension === on) return;
    this.#tension = on;
    this.#applyMusicLevel();
  }

  /** Efecto de sonido, opcionalmente con retraso (ms). */
  play(name, delayMs = 0) {
    if (!this.unlocked || !this.settings.sfxOn) return;
    const fn = SFX[name];
    if (!fn) return;
    if (delayMs <= 0) return fn(this, this.ctx.currentTime + 0.01);
    const id = setTimeout(() => {
      this.#timers.delete(id);
      if (this.unlocked) fn(this, this.ctx.currentTime + 0.01);
    }, delayMs);
    this.#timers.add(id);
  }

  /** Anula los efectos programados (al cambiar de pantalla). */
  cancel() {
    for (const id of this.#timers) clearTimeout(id);
    this.#timers.clear();
  }

  // ------------------------------------------------------------------------------------------ montaje

  #build() {
    const c = this.ctx;
    this.master = c.createGain();
    this.master.gain.value = (this.settings.volume / 100) * 0.9;
    // Compresor final: que los golpes fuertes no saturen los altavoces de la tele.
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(c.destination);

    this.reverb = c.createConvolver();
    this.reverb.buffer = this.#impulse(3.2);
    const wet = c.createGain();
    wet.gain.value = 0.55;
    this.reverb.connect(wet).connect(this.master);

    this.musicBus = c.createGain();
    this.musicBus.gain.value = 0;
    this.musicBus.connect(this.master);
    this.musicSend = c.createGain();
    this.musicSend.gain.value = 0.8;
    this.musicBus.connect(this.musicSend).connect(this.reverb);

    this.sfxBus = c.createGain();
    this.sfxBus.gain.value = this.settings.sfxOn ? 1 : 0;
    this.sfxBus.connect(this.master);
    this.sfxSend = c.createGain();
    this.sfxSend.gain.value = 0.35;
    this.sfxBus.connect(this.sfxSend).connect(this.reverb);
  }

  #impulse(seconds) {
    const c = this.ctx;
    const len = Math.round(c.sampleRate * seconds);
    const buf = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3.2;
    }
    return buf;
  }

  noise() {
    if (this.#noise) return this.#noise;
    const c = this.ctx;
    const buf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return (this.#noise = buf);
  }

  #applyMusicLevel() {
    if (!this.ctx) return;
    const level = this.settings.musicOn ? (this.#tension ? 0.22 : 0.6) : 0;
    this.musicBus.gain.setTargetAtTime(level, this.ctx.currentTime, 0.6);
  }

  // ------------------------------------------------------------------------------------------ música

  #startMusic() {
    this.#applyMusicLevel();
    this.#switchMood();
    if (this.#schedule) return;
    this.#nextBeat = this.ctx.currentTime + 0.2;
    // Planificador con margen: se programan las notas un poco antes de que toquen.
    this.#schedule = setInterval(() => this.#tick(), 90);
  }

  #switchMood() {
    const c = this.ctx;
    const t = c.currentTime;
    if (this.mood) {
      const old = this.mood;
      old.out.gain.setTargetAtTime(0, t, 0.8);
      setTimeout(() => old.nodes.forEach((n) => n.stop?.()), 5000);
    }
    const m = MOODS[this.#moodId] ?? MOODS.luna;
    const out = c.createGain();
    out.gain.value = 0;
    out.gain.setTargetAtTime(1, t + 0.4, 1.2);
    out.connect(this.musicBus);
    const nodes = [];

    // Colchón: tónica, quinta y octava, cada una con dos osciladores desafinados, por un filtro que respira.
    const filter = c.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = m.cutoff;
    filter.Q.value = 2;
    const lfo = c.createOscillator();
    const lfoGain = c.createGain();
    lfo.frequency.value = 0.06;
    lfoGain.gain.value = m.cutoff * 0.45;
    lfo.connect(lfoGain).connect(filter.frequency);
    lfo.start();
    nodes.push(lfo);
    const padGain = c.createGain();
    padGain.gain.value = m.wave === 'square' ? 0.028 : m.wave === 'sine' ? 0.09 : 0.045;
    filter.connect(padGain).connect(out);
    const voices = [];
    for (const interval of [0, 7, 12, -12]) {
      for (const detune of interval === -12 ? [0] : [-8, 8]) {
        const o = c.createOscillator();
        o.type = interval === -12 ? 'sine' : m.wave;
        o.frequency.value = mtof(m.root + interval);
        o.detune.value = detune;
        const g = c.createGain();
        g.gain.value = interval === -12 ? 2.2 : 1;
        o.connect(g).connect(filter);
        o.start();
        nodes.push(o);
        voices.push({ o, interval });
      }
    }

    // Ambiente continuo
    if (m.amb.includes('wind') || m.amb.includes('rain')) {
      const src = c.createBufferSource();
      src.buffer = this.noise();
      src.loop = true;
      const bp = c.createBiquadFilter();
      const g = c.createGain();
      if (m.amb.includes('rain')) {
        bp.type = 'highpass';
        bp.frequency.value = 2500;
        g.gain.value = 0.05;
      } else {
        bp.type = 'bandpass';
        bp.frequency.value = 500;
        bp.Q.value = 3;
        g.gain.value = 0.07;
        // Ráfagas de viento: el filtro y el volumen suben y bajan despacio.
        const wl = c.createOscillator();
        const wg = c.createGain();
        wl.frequency.value = 0.09;
        wg.gain.value = 300;
        wl.connect(wg).connect(bp.frequency);
        wl.start();
        nodes.push(wl);
      }
      src.connect(bp).connect(g).connect(out);
      src.start();
      nodes.push(src);
      if (m.amb.includes('rain') && m.amb.includes('wind')) {
        // tormenta: además, viento grave
        const src2 = c.createBufferSource();
        src2.buffer = this.noise();
        src2.loop = true;
        const lp = c.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 350;
        const g2 = c.createGain();
        g2.gain.value = 0.12;
        src2.connect(lp).connect(g2).connect(out);
        src2.start(0, 0.7);
        nodes.push(src2);
      }
    }

    this.mood = { m, out, nodes, voices };
    this.#beat = 0;
  }

  #tick() {
    const c = this.ctx;
    if (!this.mood || c.state !== 'running') return;
    const { m } = this.mood;
    const spb = 60 / m.bpm;
    while (this.#nextBeat < c.currentTime + 0.35) {
      this.#playBeat(this.#nextBeat, this.#beat, spb);
      this.#nextBeat += spb;
      this.#beat++;
    }
  }

  #playBeat(t, beat, spb) {
    const { m, out, voices } = this.mood;
    const bar = Math.floor(beat / 4);
    const inBar = beat % 4;
    // Cambio de acorde cada 2 compases
    if (inBar === 0 && bar % 2 === 0) {
      const shift = PROGRESSION[(bar / 2) % PROGRESSION.length];
      for (const v of voices) v.o.frequency.setTargetAtTime(mtof(m.root + shift + v.interval), t, 0.5);
      // bajo pulsado
      pluck(this, out, mtof(m.root + shift), t, { type: 'triangle', gain: 0.16, decay: 2.2 });
    }
    // Caja de música: paseo aleatorio por la escala
    if (Math.random() < m.bells) {
      this.#melody = Math.max(-3, Math.min(9, this.#melody + [-2, -1, -1, 1, 1, 2, 3][(Math.random() * 7) | 0]));
      const n = m.scale.length;
      const deg = ((this.#melody % n) + n) % n;
      const oct = Math.floor(this.#melody / n);
      const midi = m.root + 24 + 12 * oct + m.scale[deg];
      bell(this, out, mtof(midi), t, { gain: 0.07 });
      if (Math.random() < 0.3) bell(this, out, mtof(midi + 12), t + spb / 2, { gain: 0.04 });
    }
    if (m.drums && (inBar === 0 || inBar === 2)) tom(this, out, t, inBar === 0 ? 0.22 : 0.14);
    if (m.drums && inBar === 3 && Math.random() < 0.5) tom(this, out, t + spb / 2, 0.1, 120);
    // Ambiente
    if (m.amb.includes('fire')) for (let i = 0; i < 3; i++) if (Math.random() < 0.6) crackle(this, out, t + Math.random() * spb);
    if (m.amb.includes('bubbles') && Math.random() < 0.7) bubble(this, out, t + Math.random() * spb);
    if (m.amb.includes('owl') && beat % 24 === 11 && Math.random() < 0.6) owl(this, out, t);
    // Latido mientras hay tensión (va por el bus de efectos: suena aunque la música esté apagada)
    if (this.#tension && this.settings.sfxOn) {
      thump(this, this.sfxBus, t, 0.5);
      thump(this, this.sfxBus, t + 0.22, 0.32);
    }
  }
}

// ------------------------------------------------------------------------------------------ instrumentos

function tone(s, dest, { type = 'sine', freq, t, attack = 0.005, peak = 0.2, decay = 0.5, slideTo = null, slideTime = 0.2, detune = 0 }) {
  const c = s.ctx;
  const o = c.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + slideTime);
  o.detune.value = detune;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  o.connect(g).connect(dest);
  o.start(t);
  o.stop(t + attack + decay + 0.05);
  return o;
}

function noiseHit(s, dest, t, { type = 'bandpass', freq = 1000, q = 1, peak = 0.3, attack = 0.005, decay = 0.3, sweepTo = null }) {
  const c = s.ctx;
  const src = c.createBufferSource();
  src.buffer = s.noise();
  const f = c.createBiquadFilter();
  f.type = type;
  f.frequency.setValueAtTime(freq, t);
  if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + attack + decay);
  f.Q.value = q;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  src.connect(f).connect(g).connect(dest);
  src.start(t, Math.random());
  src.stop(t + attack + decay + 0.05);
}

const bell = (s, dest, f, t, { gain = 0.1, decay = 1.8 } = {}) => {
  tone(s, dest, { freq: f, t, peak: gain, decay });
  tone(s, dest, { freq: f * 2.01, t, peak: gain * 0.35, decay: decay * 0.5 });
  tone(s, dest, { freq: f * 3.98, t, peak: gain * 0.12, decay: decay * 0.25 });
};
const pluck = (s, dest, f, t, { type = 'triangle', gain = 0.15, decay = 0.6 } = {}) => tone(s, dest, { type, freq: f, t, peak: gain, decay });
const thump = (s, dest, t, gain = 0.4) => tone(s, dest, { freq: 90, slideTo: 40, slideTime: 0.12, t, peak: gain, decay: 0.18 });
const tom = (s, dest, t, gain, f = 95) => {
  tone(s, dest, { freq: f, slideTo: f * 0.55, slideTime: 0.25, t, peak: gain, decay: 0.35 });
  noiseHit(s, dest, t, { type: 'lowpass', freq: 600, peak: gain * 0.25, decay: 0.08 });
};
const crackle = (s, dest, t) => noiseHit(s, dest, t, { freq: 1800 + Math.random() * 3000, q: 4, peak: 0.04 + Math.random() * 0.05, decay: 0.015 });
const bubble = (s, dest, t) =>
  tone(s, dest, { freq: 250 + Math.random() * 300, slideTo: 900 + Math.random() * 600, slideTime: 0.07, t, peak: 0.05, decay: 0.08 });
function owl(s, dest, t) {
  for (const [dt, f] of [
    [0, 440],
    [0.45, 415],
    [0.75, 415],
  ]) {
    tone(s, dest, { freq: f, slideTo: f * 0.92, slideTime: 0.35, t: t + dt, attack: 0.08, peak: 0.035, decay: 0.32 });
  }
}

// ------------------------------------------------------------------------------------------ efectos

const SFX = {
  /** Cambio de pantalla: ráfaga de aire. */
  whoosh(s, t) {
    noiseHit(s, s.sfxBus, t, { freq: 300, sweepTo: 2600, q: 1.2, peak: 0.25, attack: 0.25, decay: 0.45 });
  },
  /** Intro de sección: gong grave. */
  gong(s, t) {
    for (const [r, g, d] of [
      [1, 0.25, 4],
      [2.76, 0.12, 2.6],
      [5.4, 0.06, 1.6],
      [8.93, 0.03, 0.9],
    ])
      tone(s, s.sfxBus, { freq: 82 * r, t, attack: 0.01, peak: g, decay: d });
    tone(s, s.sfxBus, { freq: 60, slideTo: 38, slideTime: 0.5, t, peak: 0.4, decay: 1.2 });
    noiseHit(s, s.sfxBus, t, { type: 'lowpass', freq: 900, peak: 0.12, decay: 0.4 });
  },
  /** Se abre el turno: acorde que sube. */
  go(s, t) {
    [69, 73, 76, 81].forEach((m, i) => tone(s, s.sfxBus, { type: 'triangle', freq: mtof(m), t: t + i * 0.035, peak: 0.12, decay: 0.5 }));
    noiseHit(s, s.sfxBus, t, { type: 'highpass', freq: 4000, peak: 0.1, decay: 0.15 });
  },
  /** Alguien ha pulsado. */
  buzz(s, t) {
    tone(s, s.sfxBus, { type: 'square', freq: 880, slideTo: 440, slideTime: 0.12, t, peak: 0.12, decay: 0.25 });
    tone(s, s.sfxBus, { freq: 110, slideTo: 45, slideTime: 0.2, t, peak: 0.5, decay: 0.35 });
    noiseHit(s, s.sfxBus, t, { freq: 2500, q: 0.8, peak: 0.2, decay: 0.12 });
  },
  /** ¡Correcto! Arpegio mayor brillante. */
  correct(s, t) {
    [72, 76, 79, 84, 88].forEach((m, i) => bell(s, s.sfxBus, mtof(m), t + i * 0.07, { gain: 0.14, decay: 1.4 }));
    noiseHit(s, s.sfxBus, t + 0.3, { type: 'highpass', freq: 6000, peak: 0.06, attack: 0.2, decay: 1 });
  },
  /** Fallo: lamento que baja, desafinado. */
  wrong(s, t) {
    for (const det of [-25, 25]) {
      tone(s, s.sfxBus, { type: 'sawtooth', freq: 311, slideTo: 233, slideTime: 0.35, t, peak: 0.07, decay: 0.4, detune: det });
      tone(s, s.sfxBus, { type: 'sawtooth', freq: 233, slideTo: 147, slideTime: 0.7, t: t + 0.4, peak: 0.07, decay: 0.8, detune: det });
    }
  },
  /** Tictac de los últimos segundos. */
  tick(s, t) {
    tone(s, s.sfxBus, { freq: 1500, t, peak: 0.15, decay: 0.04 });
    noiseHit(s, s.sfxBus, t, { freq: 3000, q: 5, peak: 0.08, decay: 0.02 });
  },
  /** Cuenta atrás de salida (3, 2, 1). */
  count(s, t) {
    tone(s, s.sfxBus, { type: 'triangle', freq: 660, t, peak: 0.16, decay: 0.25 });
  },
  /** Se acaba el tiempo / ronda cerrada. */
  bell(s, t) {
    bell(s, s.sfxBus, 523, t, { gain: 0.22, decay: 2.5 });
    bell(s, s.sfxBus, 784, t + 0.01, { gain: 0.1, decay: 2 });
  },
  /** Llega una respuesta. */
  blip(s, t) {
    tone(s, s.sfxBus, { type: 'triangle', freq: 1100 + Math.random() * 300, t, peak: 0.06, decay: 0.09 });
  },
  /** Aparece una fila en un revelado con suspense. */
  pop(s, t) {
    tone(s, s.sfxBus, { type: 'triangle', freq: 520, slideTo: 780, slideTime: 0.06, t, peak: 0.13, decay: 0.14 });
    thump(s, s.sfxBus, t, 0.25);
  },
  /** Subida de tensión antes de revelar. */
  riser(s, t) {
    noiseHit(s, s.sfxBus, t, { freq: 400, sweepTo: 5000, q: 2, peak: 0.12, attack: 1.2, decay: 0.15 });
    tone(s, s.sfxBus, { type: 'sawtooth', freq: 110, slideTo: 440, slideTime: 1.3, t, attack: 1.2, peak: 0.05, decay: 0.12 });
  },
  /** Golpe del revelado. */
  hit(s, t) {
    tone(s, s.sfxBus, { freq: 70, slideTo: 32, slideTime: 0.4, t, peak: 0.6, decay: 0.8 });
    noiseHit(s, s.sfxBus, t, { type: 'highpass', freq: 3000, peak: 0.18, decay: 1.2 });
  },
  /** Eliminado (Reflejos en rojo, Libre). */
  out(s, t) {
    tone(s, s.sfxBus, { type: 'square', freq: 196, slideTo: 98, slideTime: 0.3, t, peak: 0.08, decay: 0.35 });
    thump(s, s.sfxBus, t, 0.45);
  },
  /** Relámpago: trueno grave que retumba. */
  thunder(s, t) {
    noiseHit(s, s.sfxBus, t, { type: 'lowpass', freq: 1400, sweepTo: 120, peak: 0.35, attack: 0.02, decay: 2.8 });
    noiseHit(s, s.sfxBus, t + 0.25, { type: 'lowpass', freq: 300, peak: 0.25, attack: 0.1, decay: 2.2 });
  },
  /** Marcador: redoble corto. */
  roll(s, t) {
    for (let i = 0; i < 14; i++) noiseHit(s, s.sfxBus, t + i * 0.055, { freq: 1800, q: 1.5, peak: 0.05 + i * 0.008, decay: 0.05 });
    tone(s, s.sfxBus, { freq: 80, slideTo: 40, slideTime: 0.3, t: t + 0.8, peak: 0.4, decay: 0.5 });
  },
  /** Final y grandes victorias: fanfarria (menor → mayor). */
  fanfare(s, t) {
    const chords = [
      [57, 60, 64],
      [53, 57, 60],
      [55, 59, 62],
      [57, 61, 64, 69],
    ];
    chords.forEach((ch, i) => {
      const at = t + i * 0.32;
      const dur = i === chords.length - 1 ? 2.2 : 0.3;
      for (const m of ch) {
        for (const det of [-6, 6]) tone(s, s.sfxBus, { type: 'sawtooth', freq: mtof(m), t: at, attack: 0.03, peak: 0.035, decay: dur, detune: det });
      }
      tone(s, s.sfxBus, { freq: mtof(ch[0] - 24), slideTo: mtof(ch[0] - 24) * 0.7, slideTime: 0.2, t: at, peak: 0.35, decay: 0.4 });
    });
    noiseHit(s, s.sfxBus, t + 0.96, { type: 'highpass', freq: 5000, peak: 0.12, decay: 2 });
  },
};

export const sound = new SoundEngine();
