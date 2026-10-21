// Conexión del móvil con el presentador, con reconexión automática.
// Responde al latido aquí mismo (camino corto) y vigila que el presentador siga vivo.
import Peer from 'peerjs';
import { CONNECTION_OPTIONS, PEER_OPTIONS, describePeerError, hostPeerId } from '../shared/peerConfig.js';
import { MSG, parseHostMessage } from '../shared/protocol.js';

const BACKOFF_MS = [500, 1000, 2000, 3000, 5000];
const CONNECT_TIMEOUT_MS = 8000;
const HOST_SILENCE_MS = 6000; // el presentador manda latido cada 2 s
const NOT_FOUND_ATTEMPTS = 3;

/**
 * Estados en `onStatus({state, message})`:
 * - connecting: primer intento
 * - connected: canal abierto (el `hello` lo manda quien escucha `onOpen`)
 * - reconnecting: se perdió y se reintenta solo
 * - not-found: la sala no existe (solo si nunca llegamos a entrar); se deja de reintentar
 * - server-down: sin servidor de enlace; se sigue reintentando
 * - fatal: no se puede seguir (navegador incompatible)
 * - stopped: parado a propósito
 */
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
    this.onStatus?.({ state, message });
  }

  // Al volver a primer plano o recuperar la red, no esperar al siguiente reintento.
  #onWake() {
    if (this.#stopped || document.visibilityState === 'hidden') return;
    if (!this.connected) {
      this.#attempt = 0;
      this.#retryNow();
    } else {
      this.#checkHost();
    }
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
      if (current() && !conn.open) this.#lost();
    }, CONNECT_TIMEOUT_MS);

    conn.on('open', () => {
      if (!current()) return;
      clearTimeout(this.#connectTimer);
      this.#attempt = 0;
      this.#notFound = 0;
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

  #lost() {
    if (this.#stopped) return;
    clearTimeout(this.#connectTimer);
    this.#closeConn();
    if (this.#everConnected) this.#setStatus('reconnecting', 'Reconectando…');
    this.#scheduleRetry();
  }

  #closeConn() {
    const conn = this.#conn;
    this.#conn = null;
    conn?.close();
  }
}
