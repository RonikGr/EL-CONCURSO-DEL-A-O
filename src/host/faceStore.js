// Caras de los jugadores, guardadas en este portátil (IndexedDB): no se suben a ningún sitio (el repositorio es
// público). Cada foto se recorta en cuadrado y se reduce a 240 px: así pesa poco al mandarla a los móviles.
import { namesFromFileName } from '../core/faces.js';

const DB = 'concurso-caras';
const STORE = 'faces';
const SIZE = 240;

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
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error);
  });
}

/** Recorte cuadrado (un poco hacia arriba, donde suele estar la cara) a JPEG pequeño. */
async function thumbnail(file) {
  const bmp = await createImageBitmap(file);
  const side = Math.min(bmp.width, bmp.height);
  const sx = (bmp.width - side) / 2;
  const sy = (bmp.height - side) / 3;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  canvas.getContext('2d').drawImage(bmp, sx, sy, side, side, 0, 0, SIZE, SIZE);
  bmp.close();
  return canvas.toDataURL('image/jpeg', 0.85);
}

export class FaceStore extends EventTarget {
  /** [{id, names, img}] en el orden en que se añadieron */
  faces = [];

  async load() {
    try {
      const all = await tx('readonly', (s) => s.getAll());
      this.faces = all.sort((a, b) => a.added - b.added).map(({ id, names, img, source }) => ({ id, names, img, source: source ?? null }));
    } catch (e) {
      console.warn('[caras] no se pudieron leer', e);
    }
    this.dispatchEvent(new Event('change'));
  }

  /**
   * Añade fotos; los nombres salen del nombre del archivo («Rodri, Rodrigo.jpg»). @returns cuántas
   * @param source 'carpeta' si vienen de la carpeta del concurso (al volver a leerla se sustituyen)
   */
  async add(files, { source = null } = {}) {
    const images = [...files].filter((f) => f.type.startsWith('image/') || /\.(jpe?g|png|webp|gif|avif)$/i.test(f.name));
    const records = [];
    for (const f of images) {
      try {
        records.push({ id: crypto.randomUUID(), names: namesFromFileName(f.name), img: await thumbnail(f), source, added: Date.now() + records.length });
      } catch (e) {
        console.warn('[caras] no se pudo leer', f.name, e);
      }
    }
    if (records.length) await tx('readwrite', (s) => records.forEach((r) => s.put(r)));
    await this.load();
    return records.length;
  }

  async rename(id, names) {
    const rec = await tx('readonly', (s) => s.get(id));
    if (!rec) return;
    rec.names = names;
    await tx('readwrite', (s) => s.put(rec));
    await this.load();
  }

  /** Quita las fotos que vinieron de un sitio (la carpeta, antes de volver a leerla). */
  async removeSource(source) {
    const ids = this.faces.filter((f) => f.source === source).map((f) => f.id);
    if (ids.length) await tx('readwrite', (s) => ids.forEach((id) => s.delete(id)));
  }

  async remove(id) {
    await tx('readwrite', (s) => s.delete(id));
    await this.load();
  }

  /** id → imagen, para pintar los avatares */
  images() {
    return Object.fromEntries(this.faces.map((f) => [f.id, f.img]));
  }
}
