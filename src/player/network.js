// Conexión del móvil con el presentador, con reconexión automática.
// Responde al latido aquí mismo (camino corto) y vigila que el presentador siga vivo.
import Peer from 'peerjs';
import { CONNECTION_OPTIONS, PEER_OPTIONS, describePeerError, hostPeerId } from '../shared/peerConfig.js';
import { MSG, parseHostMessage } from '../shared/protocol.js';

const BACKOFF_MS = [500, 1000, 2000, 3000, 5000];
const CONNECT_TIMEOUT_MS = 8000;
const HOST_SILENCE_MS = 6000; // el presentador manda latido cada 2 s
const NOT_FOUND_ATTEMPTS = 3;
const HIDDEN_RESET_MS = 4000; // tras más tiempo en segundo plano, se rehace la conexión entera (ver #onWake)
const WAKE_PROBE_MS = 3500; // al volver: si en este tiempo no llega el latido de la tele, también
const FAILS_BEFORE_RESET = 2; // intentos fallidos seguidos antes de empezar con un Peer nuevo

/**
 * Estados en `onStatus({state, message})`:
 * - connecting: primer intento (y los siguientes si aún no ha entrado nunca)
 * - connected: canal abierto (el `hello` lo manda quien escucha `onOpen`)
 * - reconnecting: se perdió y se reintenta solo
 * - not-found: la sala no existe (solo si nunca llegamos a entrar); se deja de reintentar
 * - server-down: sin servidor de enlace; se sigue reintentando
 * - fatal: no se puede seguir (navegador incompatible)
 * - stopped: parado a propósito
 * Además `detail` = {attempts, reason}: intentos fallidos seguidos y por qué ('ice' = el servidor de enlace responde
 * pero la wifi no deja la conexión directa con la tele; 'timeout' = no contesta), para explicarlo en pantalla.
 */
/** Si cuesta entrar, por qué (con el `detail` de onStatus), para explicarlo en el móvil y en el mando. */
export function connectionHelp(detail) {
  if (!detail || detail.attempts < 2) return null;
  if (detail.reason === 'ice')
    return `El móvil llega al servidor, pero la wifi no le deja hablar con la tele (intento ${detail.attempts}). Comprobad que estáis en la misma wifi que el portátil (no la de invitados) y sin datos móviles ni VPN.`;
  return `La tele no contesta (intento ${detail.attempts}). ¿Está abierta en el portátil? Comprobad que estáis en la misma wifi y sin VPN.`;
}

export class PlayerConnection {
  #peer = null;
  #conn = null;
  #timer = null;
  #connectTimer = null;
  #watchdog = null;
  #attempt = 0;
  #notFound = 0;
  #everConnected = false;
  #stopped = false;
  #lastSeen = 0;
  #hiddenAt = null;
  #wakeProbe = null;
  #fails = 0; // intentos fallidos seguidos (se reinicia al conectar)
  #failReason = null;

  constructor({ roomCode, onOpen, onMessage, onStatus }) {
    this.roomCode = roomCode;
    this.onOpen = onOpen;
    this.onMessage = onMessage;
    this.onStatus = onStatus;
    this.state = 'idle';
  }

  #wake = () => this.#onWake();

  start() {
    this.#stopped = false;
    this.#setStatus('connecting');
    document.addEventListener('visibilitychange', this.#wake);
    addEventListener('online', this.#wake);
    addEventListener('pageshow', this.#wake);
    this.#watchdog = setInterval(() => this.#checkHost(), 1000);
    this.#retryNow();
  }

  stop() {
    this.#stopped = true;
    clearTimeout(this.#timer);
    clearTimeout(this.#connectTimer);
    clearTimeout(this.#wakeProbe);
    clearInterval(this.#watchdog);
    document.removeEventListener('visibilitychange', this.#wake);
    removeEventListener('online', this.#wake);
    removeEventListener('pageshow', this.#wake);
    this.#closeConn();
    const peer = this.#peer;
    this.#peer = null;
    peer?.destroy();
    this.#setStatus('stopped');
  }

  get connected() {
    return this.state === 'connected';
  }

  send(msg) {
    if (!this.#conn?.open) return false;
    try {
      this.#conn.send(msg);
      return true;
    } catch {
      return false;
    }
  }

  #setStatus(state, message = '') {
    this.state = state;
    this.onStatus?.({ state, message, detail: { attempts: this.#fails, reason: this.#failReason } });
  }

  // Al volver a primer plano o recuperar la red, no esperar al siguiente reintento.
  // Tras un rato en segundo plano (móvil bloqueado, otra app), el navegador puede haber cortado el enlace con el
  // servidor y con la tele sin avisar: entonces se empieza de cero con un Peer nuevo.
  #onWake() {
    if (this.#stopped) return;
    if (document.visibilityState === 'hidden') {
      this.#hiddenAt ??= performance.now();
      return;
    }
    const away = this.#hiddenAt == null ? 0 : performance.now() - this.#hiddenAt;
    this.#hiddenAt = null;
    if (!this.connected) {
      this.#attempt = 0;
      if (away > HIDDEN_RESET_MS) this.#hardReset();
      else this.#retryNow();
      return;
    }
    // Parece conectado: la tele manda latido cada 2 s; si no llega nada enseguida, la conexión estaba muerta.
    const since = performance.now();
    clearTimeout(this.#wakeProbe);
    this.#wakeProbe = setTimeout(() => {
      if (this.#stopped || !this.connected || this.#lastSeen >= since) return;
      this.#closeConn();
      this.#setStatus('reconnecting', 'Reconectando…');
      this.#hardReset();
    }, WAKE_PROBE_MS);
  }

  /** Empezar de cero: Peer nuevo (enlace nuevo con el servidor) y conexión nueva con la tele. */
  #hardReset() {
    if (this.#stopped) return;
    clearTimeout(this.#timer);
    clearTimeout(this.#connectTimer);
    this.#closeConn();
    const peer = this.#peer;
    this.#peer = null;
    peer?.destroy();
    this.#createPeer();
  }

  #retryNow() {
    clearTimeout(this.#timer);
    if (this.#stopped) return;
    const peer = this.#peer;
    if (!peer || peer.destroyed) this.#createPeer();
    else if (peer.disconnected) peer.reconnect(); // 'open' volverá a llamar a #connect
    else if (peer.open) this.#connect();
  }

  #scheduleRetry() {
    if (this.#stopped) return;
    clearTimeout(this.#timer);
    const delay = BACKOFF_MS[Math.min(this.#attempt++, BACKOFF_MS.length - 1)];
    this.#timer = setTimeout(() => this.#retryNow(), delay);
  }

  #createPeer() {
    const peer = new Peer(PEER_OPTIONS);
    this.#peer = peer;
    const current = () => !this.#stopped && this.#peer === peer;

    peer.on('open', () => {
      if (current()) this.#connect();
    });
    peer.on('disconnected', () => {
      // Solo el canal con el servidor de enlace; si el canal con el presentador sigue abierto, no pasa nada.
      if (current() && !this.connected) this.#scheduleRetry();
    });
    peer.on('error', (err) => {
      if (!current()) return;
      switch (err.type) {
        case 'peer-unavailable':
          // La sala no está registrada: código erróneo o el presentador está recargando.
          clearTimeout(this.#connectTimer);
          this.#closeConn();
          if (!this.#everConnected && ++this.#notFound >= NOT_FOUND_ATTEMPTS) {
            this.stop();
            this.#setStatus('not-found', describePeerError(err));
            return;
          }
          this.#setStatus(this.#everConnected ? 'reconnecting' : 'connecting', this.#everConnected ? 'Buscando la sala…' : '');
          this.#scheduleRetry();
          break;
        case 'network':
        case 'server-error':
        case 'socket-error':
        case 'socket-closed':
          if (!this.connected) this.#setStatus('server-down', describePeerError(err));
          this.#scheduleRetry();
          break;
        case 'browser-incompatible':
          this.stop();
          this.#setStatus('fatal', describePeerError(err));
          break;
        case 'unavailable-id':
        case 'invalid-id':
          // Choque improbable del ID aleatorio: empezar con otro.
          this.#peer = null;
          peer.destroy();
          this.#scheduleRetry();
          break;
        default:
          console.warn('[player] PeerJS', err.type, err);
          if (!this.connected) this.#scheduleRetry();
      }
    });
  }

  #connect() {
    if (this.#stopped || this.#conn) return;
    const conn = this.#peer.connect(hostPeerId(this.roomCode), CONNECTION_OPTIONS);
    this.#conn = conn;
    const current = () => this.#conn === conn;

    // PeerJS no siempre avisa si el presentador no responde: plazo propio.
    clearTimeout(this.#connectTimer);
    this.#connectTimer = setTimeout(() => {
      if (current() && !conn.open) this.#lost('timeout');
    }, CONNECT_TIMEOUT_MS);
    // Si la conexión directa falla (la wifi no la deja), no esperar al plazo: se sabe ya y se puede explicar
    const pc = conn.peerConnection;
    pc?.addEventListener('iceconnectionstatechange', () => {
      if (current() && !conn.open && pc.iceConnectionState === 'failed') this.#lost('ice');
    });

    conn.on('open', () => {
      if (!current()) return;
      clearTimeout(this.#connectTimer);
      this.#attempt = 0;
      this.#notFound = 0;
      this.#fails = 0;
      this.#failReason = null;
      this.#everConnected = true;
      this.#lastSeen = performance.now();
      this.#setStatus('connected');
      this.onOpen?.();
    });
    conn.on('data', (data) => {
      if (!current()) return;
      const tRecv = performance.now(); // lo primero: es t3 de la sincronización
      this.#lastSeen = tRecv;
      const msg = parseHostMessage(data);
      if (!msg) return;
      if (msg.t === MSG.HB) {
        this.send({ t: MSG.HB_ACK, h0: msg.h0 });
        return;
      }
      this.onMessage?.(msg, tRecv);
    });
    conn.on('close', () => current() && this.#lost());
    conn.on('error', () => current() && this.#lost());
  }

  #checkHost() {
    if (this.connected && performance.now() - this.#lastSeen > HOST_SILENCE_MS) this.#lost();
  }

  /** @param reason 'timeout' | 'ice' si no llegó a abrirse; si no, se perdió una conexión que iba bien */
  #lost(reason = null) {
    if (this.#stopped) return;
    clearTimeout(this.#connectTimer);
    this.#closeConn();
    if (reason) {
      this.#fails++;
      this.#failReason = reason;
    }
    this.#setStatus(this.#everConnected ? 'reconnecting' : 'connecting', this.#everConnected ? 'Reconectando…' : '');
    // Varios fallos seguidos: puede que el enlace con el servidor esté muerto sin saberlo; Peer nuevo
    if (reason && this.#fails % FAILS_BEFORE_RESET === 0) {
      clearTimeout(this.#timer);
      this.#timer = setTimeout(() => this.#hardReset(), 300);
      return;
    }
    this.#scheduleRetry();
  }

  #closeConn() {
    const conn = this.#conn;
    this.#conn = null;
    conn?.close();
  }
}
