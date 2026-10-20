// Fuente de jugadores por WebRTC (móviles). Asocia cada conexión a un playerId, mide la latencia
// con un latido y detecta caídas. La futura fuente de mandos (Gamepad API) expondrá los mismos eventos.
import { HostNetwork } from '../network.js';
import { RttTracker } from '../../core/latency.js';
import { ERROR_CODE, MSG, PROTOCOL_VERSION, parsePlayerMessage } from '../../shared/protocol.js';

const HB_INTERVAL_MS = 2000;
const HB_TIMEOUT_MS = 6000;
const HELLO_TIMEOUT_MS = 10000;
const CLOSE_AFTER_ERROR_MS = 500;

export class PeerSource {
  #network;
  #timer = null;
  /** connId → { playerId, lastSeen, openedAt, rtt } */
  #conns = new Map();
  /** playerId → connId */
  #connOf = new Map();

  /**
   * @param handlers.onHello(playerId, msg) → {ok: true} | {ok: false, error: {code, message}}
   * @param handlers.onProfile(playerId, msg)
   * @param handlers.onBuzz(playerId, {seq, epoch, tPress, tArrival}) — tiempos en el reloj del presentador
   * @param handlers.onLeave(playerId)
   * @param handlers.onRtt(playerId, ms)
   * @param handlers.onStatus({state, message})
   */
  constructor({ roomCode, handlers }) {
    this.handlers = handlers;
    this.#network = new HostNetwork({
      roomCode,
      onStatus: (s) => handlers.onStatus?.(s),
      onConnection: (connId) => this.#conns.set(connId, { playerId: null, lastSeen: now(), openedAt: now(), rtt: new RttTracker() }),
      onData: (connId, data) => this.#onData(connId, data),
      onClose: (connId) => this.#drop(connId),
    });
  }

  start() {
    this.#network.start();
    this.#timer = setInterval(() => this.#tick(), HB_INTERVAL_MS);
  }

  destroy() {
    clearInterval(this.#timer);
    this.#network.destroy();
  }

  sendTo(playerId, msg) {
    const connId = this.#connOf.get(playerId);
    return connId ? this.#network.send(connId, msg) : false;
  }

  isOnline(playerId) {
    return this.#connOf.has(playerId);
  }

  /** Echa a un jugador avisándole antes (para que el móvil no intente reconectar). */
  kick(playerId, error) {
    const connId = this.#connOf.get(playerId);
    if (!connId) return;
    this.#unbind(connId);
    this.#sendErrorAndClose(connId, error);
  }

  #onData(connId, data) {
    const tArrival = now(); // lo primero: es la hora de llegada de una posible pulsación
    const entry = this.#conns.get(connId);
    if (!entry) return;
    entry.lastSeen = tArrival;
    const msg = parsePlayerMessage(data);
    if (!msg) return;

    if (msg.t === MSG.HELLO) return this.#onHello(connId, entry, msg);
    if (!entry.playerId) return; // nada antes del hello

    switch (msg.t) {
      case MSG.BUZZ:
        // Fase 2: sin sincronización de relojes, la pulsación cuenta en el instante en que llega.
        this.handlers.onBuzz?.(entry.playerId, { ...msg, tPress: tArrival, tArrival });
        break;
      case MSG.HB_ACK:
        entry.rtt.add(tArrival - msg.h0);
        this.handlers.onRtt?.(entry.playerId, entry.rtt.median());
        break;
      case MSG.PROFILE:
        this.handlers.onProfile?.(entry.playerId, msg);
        break;
    }
  }

  #onHello(connId, entry, msg) {
    if (msg.v !== PROTOCOL_VERSION) {
      return this.#sendErrorAndClose(connId, {
        code: ERROR_CODE.VERSION,
        message: 'La versión de la página no coincide con la del presentador. Recarga la página.',
      });
    }
    // Mismo jugador por una conexión nueva: o el móvil reconectó antes de que caducara la vieja, o abrió
    // otra pestaña. Se avisa a la vieja para que no intente reconectar (si no, se echarían mutuamente sin fin).
    const previous = this.#connOf.get(msg.playerId);
    if (previous && previous !== connId) {
      this.#unbind(previous);
      this.#sendErrorAndClose(previous, {
        code: ERROR_CODE.REPLACED,
        message: 'Has entrado desde otra pestaña o ventana. Solo una puede jugar a la vez.',
      });
    }
    entry.playerId = msg.playerId;
    this.#connOf.set(msg.playerId, connId);

    const result = this.handlers.onHello(msg.playerId, msg);
    if (!result.ok) {
      this.#unbind(connId);
      this.#sendErrorAndClose(connId, result.error);
    }
  }

  #tick() {
    const t = now();
    for (const [connId, entry] of this.#conns) {
      const dead = entry.playerId ? t - entry.lastSeen > HB_TIMEOUT_MS : t - entry.openedAt > HELLO_TIMEOUT_MS;
      if (dead) {
        this.#network.close(connId);
        this.#drop(connId);
      } else if (entry.playerId) {
        this.#network.send(connId, { t: MSG.HB, h0: t });
      }
    }
  }

  #sendErrorAndClose(connId, error) {
    this.#network.send(connId, { t: MSG.ERROR, ...error });
    setTimeout(() => {
      this.#network.close(connId);
      this.#conns.delete(connId);
    }, CLOSE_AFTER_ERROR_MS);
  }

  #unbind(connId) {
    const entry = this.#conns.get(connId);
    if (entry?.playerId && this.#connOf.get(entry.playerId) === connId) this.#connOf.delete(entry.playerId);
    if (entry) entry.playerId = null;
  }

  #drop(connId) {
    const entry = this.#conns.get(connId);
    if (!entry) return;
    this.#conns.delete(connId);
    const playerId = entry.playerId;
    if (playerId && this.#connOf.get(playerId) === connId) {
      this.#connOf.delete(playerId);
      this.handlers.onLeave?.(playerId);
    }
  }
}

const now = () => performance.now();
