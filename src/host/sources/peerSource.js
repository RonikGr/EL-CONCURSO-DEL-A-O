// Conexiones por WebRTC: móviles de jugadores y mandos del presentador. Asocia cada conexión a un
// playerId / controlId, mide la latencia con un latido y detecta caídas.
// La futura fuente de mandos físicos (Gamepad API) expondrá los mismos eventos de jugador.
import { HostNetwork } from '../network.js';
import { RttTracker } from '../../core/latency.js';
import { resolvePressTime } from '../../core/plausibility.js';
import { ERROR_CODE, MSG, PROTOCOL_VERSION, ROLE, parsePlayerMessage } from '../../shared/protocol.js';

const HB_INTERVAL_MS = 2000;
const HB_TIMEOUT_MS = 6000;
const HELLO_TIMEOUT_MS = 10000;
const CLOSE_AFTER_ERROR_MS = 500;

const keyOf = (role, id) => `${role}:${id}`;

export class PeerSource {
  #network;
  #timer = null;
  /** connId → { role, id, lastSeen, openedAt, rtt } */
  #conns = new Map();
  /** `${role}:${id}` → connId */
  #connOf = new Map();

  /**
   * Jugadores:
   * @param handlers.onHello(playerId, msg) → {ok: true} | {ok: false, error: {code, message}}
   * @param handlers.onProfile(playerId, msg)
   * @param handlers.onBuzz(playerId, {seq, epoch, tPress, tArrival, meta}) — tiempos en el reloj del presentador
   * @param handlers.onAnswer(playerId, {seq, roundId, value, tPress, tArrival})
   * @param handlers.onJoker(playerId, {seq, roundId, kind})
   * @param handlers.onFreeCount(playerId, {seq, roundId, delta})
   * @param handlers.onSyncReport(playerId, {offset, err, rtt, samples})
   * @param handlers.onLeave(playerId)
   * @param handlers.onRtt(playerId, ms)
   * Mandos:
   * @param handlers.onControlHello(controlId, msg) → {ok: true} | {ok: false, error} | {pending: true}
   * @param handlers.onCommand(controlId, msg) → {ok, error?}
   * @param handlers.onControlLeave(controlId)
   * General:
   * @param handlers.onStatus({state, message})
   */
  constructor({ roomCode, handlers }) {
    this.handlers = handlers;
    this.#network = new HostNetwork({
      roomCode,
      onStatus: (s) => handlers.onStatus?.(s),
      onConnection: (connId) => this.#conns.set(connId, { role: null, id: null, lastSeen: now(), openedAt: now(), rtt: new RttTracker() }),
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
    return this.#send(ROLE.PLAYER, playerId, msg);
  }

  sendToControl(controlId, msg) {
    return this.#send(ROLE.CONTROL, controlId, msg);
  }

  isOnline(playerId) {
    return this.#connOf.has(keyOf(ROLE.PLAYER, playerId));
  }

  /** Echa a un jugador avisándole antes (para que el móvil no intente reconectar). */
  kick(playerId, error) {
    this.#kick(ROLE.PLAYER, playerId, error);
  }

  kickControl(controlId, error) {
    this.#kick(ROLE.CONTROL, controlId, error);
  }

  #send(role, id, msg) {
    const connId = this.#connOf.get(keyOf(role, id));
    return connId ? this.#network.send(connId, msg) : false;
  }

  #kick(role, id, error) {
    const connId = this.#connOf.get(keyOf(role, id));
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
    if (!entry.id) return; // nada antes del hello

    if (msg.t === MSG.HB_ACK) {
      entry.rtt.add(tArrival - msg.h0);
      if (entry.role === ROLE.PLAYER) this.handlers.onRtt?.(entry.id, entry.rtt.median());
      return;
    }

    if (entry.role === ROLE.CONTROL) {
      if (msg.t === MSG.CMD) {
        const result = this.handlers.onCommand?.(entry.id, msg) ?? { ok: false, error: 'Sin respuesta' };
        this.#network.send(connId, { t: MSG.CMD_RESULT, id: msg.id, ok: !!result.ok, error: result.error ?? null });
      }
      return;
    }

    switch (msg.t) {
      case MSG.SYNC:
        // Contestar ya: t1 = llegada, t2 = salida. Cuanto menos tiempo pase aquí, mejor.
        this.#network.send(connId, { t: MSG.SYNC_REPLY, id: msg.id, t0: msg.t0, t1: tArrival, t2: now() });
        break;
      case MSG.BUZZ: {
        const rtt = entry.rtt.median();
        const press = resolvePressTime({ tLocal: msg.tLocal, offset: msg.offset, err: msg.err, tArrival, rtt });
        this.handlers.onBuzz?.(entry.id, {
          seq: msg.seq,
          epoch: msg.epoch,
          tPress: press.tPress,
          tArrival,
          meta: { source: press.source, claimed: press.claimed, tLocal: msg.tLocal, offset: msg.offset, err: msg.err, rtt },
        });
        break;
      }
      case MSG.ANSWER: {
        // Mismo cálculo que la pulsación: vale si se respondió (reloj sincronizado) antes del final.
        const press = resolvePressTime({ tLocal: msg.tLocal, offset: msg.offset, err: msg.err, tArrival, rtt: entry.rtt.median() });
        this.handlers.onAnswer?.(entry.id, { seq: msg.seq, roundId: msg.roundId, value: msg.value, tPress: press.tPress, tArrival });
        break;
      }
      case MSG.JOKER:
        this.handlers.onJoker?.(entry.id, msg);
        break;
      case MSG.FREE_COUNT:
        this.handlers.onFreeCount?.(entry.id, msg);
        break;
      case MSG.AWAY:
        this.handlers.onAway?.(entry.id, msg);
        break;
      case MSG.TURN_ORDER:
        this.handlers.onTurnOrder?.(entry.id, msg);
        break;
      case MSG.SYNC_REPORT:
        this.handlers.onSyncReport?.(entry.id, msg);
        break;
      case MSG.PROFILE:
        this.handlers.onProfile?.(entry.id, msg);
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
    const role = msg.role;
    const id = role === ROLE.CONTROL ? msg.controlId : msg.playerId;
    const key = keyOf(role, id);

    // Mismo jugador/mando por una conexión nueva: o el móvil reconectó antes de que caducara la vieja, o abrió
    // otra pestaña. Se avisa a la vieja para que no intente reconectar (si no, se echarían mutuamente sin fin).
    const previous = this.#connOf.get(key);
    if (previous && previous !== connId) {
      this.#unbind(previous);
      this.#sendErrorAndClose(previous, {
        code: ERROR_CODE.REPLACED,
        message: 'Has entrado desde otra pestaña o ventana. Solo una puede estar conectada a la vez.',
      });
    }
    entry.role = role;
    entry.id = id;
    this.#connOf.set(key, connId);

    const result = role === ROLE.CONTROL ? this.handlers.onControlHello(id, msg) : this.handlers.onHello(id, msg);
    if (result.ok === false) {
      this.#unbind(connId);
      this.#sendErrorAndClose(connId, result.error);
    }
  }

  #tick() {
    const t = now();
    for (const [connId, entry] of this.#conns) {
      const dead = entry.id ? t - entry.lastSeen > HB_TIMEOUT_MS : t - entry.openedAt > HELLO_TIMEOUT_MS;
      if (dead) {
        this.#network.close(connId);
        this.#drop(connId);
      } else if (entry.id) {
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
    if (entry?.id) {
      const key = keyOf(entry.role, entry.id);
      if (this.#connOf.get(key) === connId) this.#connOf.delete(key);
    }
    if (entry) entry.id = null;
  }

  #drop(connId) {
    const entry = this.#conns.get(connId);
    if (!entry) return;
    this.#conns.delete(connId);
    if (!entry.id) return;
    const key = keyOf(entry.role, entry.id);
    if (this.#connOf.get(key) !== connId) return;
    this.#connOf.delete(key);
    if (entry.role === ROLE.CONTROL) this.handlers.onControlLeave?.(entry.id);
    else this.handlers.onLeave?.(entry.id);
  }
}

const now = () => performance.now();
