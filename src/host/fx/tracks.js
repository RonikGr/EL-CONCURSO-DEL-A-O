// Tus canciones (.mp3) para cada momento del concurso. Se guardan en el propio portátil (IndexedDB): no se suben a
// ningún sitio, así que no hace falta meterlas en el repositorio (que es público) y siguen ahí al volver a abrir la tele.
// Un momento sin canciones usa la música generada (music.js).

/** Momentos del concurso → estilos de music.js (mismas claves). */
export const MUSIC_SLOTS = [
  { id: 'lobby', label: 'Preparación', help: 'Mientras se conecta la gente' },
  { id: 'organ', label: 'Presentación', help: 'Portada e introducción de cada sección' },
  { id: 'explore', label: 'Jugando', help: 'Entre preguntas' },
  { id: 'tension', label: 'Pregunta abierta', help: 'Mientras se puede pulsar o responder' },
  { id: 'suspense', label: 'Suspense', help: 'Esperando el resultado' },
  { id: 'reveal', label: 'Revelado', help: 'Tras desvelar la respuesta' },
  { id: 'march', label: 'Marcador', help: 'Al final de cada sección' },
  { id: 'waltz', label: 'Final', help: 'Podio y despedida' },
];

const DB = 'concurso-musica';
const STORE = 'tracks';

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const result = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(result?.result ?? result);
    t.onerror = () => reject(t.error);
  });
}

export class TrackStore extends EventTarget {
  /** slot → [{id, name, url}] */
  tracks = new Map();

  async load() {
    try {
      const all = await tx('readonly', (s) => s.getAll());
      for (const t of this.tracks.values()) t.forEach((x) => URL.revokeObjectURL(x.url));
      this.tracks.clear();
      for (const rec of all.sort((a, b) => a.added - b.added)) {
        if (!this.tracks.has(rec.slot)) this.tracks.set(rec.slot, []);
        this.tracks.get(rec.slot).push({ id: rec.id, name: rec.name, url: URL.createObjectURL(rec.blob) });
      }
    } catch (e) {
      console.warn('[música] no se pudieron leer las canciones guardadas', e);
    }
    this.dispatchEvent(new Event('change'));
  }

  async add(slot, files) {
    const audio = [...files].filter((f) => f.type.startsWith('audio/') || /\.(mp3|m4a|ogg|wav)$/i.test(f.name));
    if (!audio.length) return 0;
    await tx('readwrite', (s) => {
      for (const f of audio) s.put({ id: crypto.randomUUID(), slot, name: f.name.replace(/\.[^.]+$/, ''), blob: f, added: Date.now() });
    });
    await this.load();
    return audio.length;
  }

  async remove(id) {
    await tx('readwrite', (s) => s.delete(id));
    await this.load();
  }

  /** Resumen para pintar: slot → nombres */
  summary() {
    return Object.fromEntries([...this.tracks].map(([slot, list]) => [slot, list.map((t) => ({ id: t.id, name: t.name }))]));
  }
}
