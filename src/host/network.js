// Ciclo de vida del Peer del presentador: registrar el ID de la sala, aceptar conexiones y recuperarse
// de caídas del servidor de enlace. No sabe nada del juego: entrega conexiones y mensajes en crudo.
import Peer from 'peerjs';
import { PEER_OPTIONS, describePeerError, hostPeerId } from '../shared/peerConfig.js';

const ID_BUSY_RETRY_MS = 2000;
const ID_BUSY_MAX_TRIES = 30; // ~60 s: lo que tarda el servidor en soltar el ID tras recargar
const SERVER_RETRY_MS = [1000, 2000, 4000, 8000, 15000];
const OPEN_TIMEOUT_MS = 15000; // un móvil que llama y no llega a abrir la conexión en este tiempo: la wifi no le deja

/**
 * Estados que se notifican en `onStatus({state, message})`:
 * - connecting: registrando la sala en el servidor de enlace
 * - ready: sala abierta
 * - id-busy: el servidor aún tiene el código ocupado (recarga reciente); se reintenta solo
 * - signaling-lost: sin servidor de enlace; los ya conectados siguen jugando, los nuevos no pueden entrar
 * - fatal: no se puede seguir (navegador incompatible, código ocupado demasiado tiempo)
 */
export class HostNetwork {
  #peer = null;
  #conns = new Map();
  #idBusyTries = 0;
  #serverTries = 0;
  #retryTimer = null;
  #destroyed = false;

  constructor({ roomCode, onStatus, onConnection, onData, onClose, onFailed }) {
    this.roomCode = roomCode;
    this.onStatus = onStatus;
    this.onConnection = onConnection;
    this.onData = onData;
    this.onClose = onClose;
    this.onFailed = onFailed;
  }

  start() {
    this.#createPeer();
    // Con la ventana oculta el navegador frena los temporizadores y el servidor de enlace puede soltarnos:
    // al volver (o al recuperar la red), reintentar ya en vez de esperar al siguiente intento.
    this.#wake = () => {
      if (this.#destroyed || document.visibilityState === 'hidden') return;
      const peer = this.#peer;
      if (!peer || peer.destroyed) this.#createPeer();
      else if (peer.disconnected) {
        this.#serverTries = 0;
        peer.reconnect();
      }
    };
    document.addEventListener('visibilitychange', this.#wake);
    addEventListener('online', this.#wake);
  }

  #wake = null;

  send(connId, msg) {
    const conn = this.#conns.get(connId);
    if (!conn?.open) return false;
    try {
      conn.send(msg);
      return true;
    } catch {
      return false;
    }
  }

  close(connId) {
    this.#conns.get(connId)?.close();
  }

  /** Libera el ID en el servidor cuanto antes (al cerrar o recargar la pestaña). */
  destroy() {
    this.#destroyed = true;
    clearTimeout(this.#retryTimer);
    document.removeEventListener('visibilitychange', this.#wake);
    removeEventListener('online', this.#wake);
    this.#discardPeer();
  }

  #status(state, message = '') {
    this.onStatus?.({ state, message });
  }

  #createPeer() {
    if (this.#destroyed) return;
    this.#status('connecting');
    const peer = new Peer(hostPeerId(this.roomCode), PEER_OPTIONS);
    this.#peer = peer;

    // Solo cuentan los eventos del Peer actual: PeerJS emite 'disconnected' incluso dentro de destroy().
    const current = () => !this.#destroyed && this.#peer === peer;

    peer.on('open', () => {
      if (!current()) return;
      this.#idBusyTries = 0;
      this.#serverTries = 0;
      this.#status('ready');
    });

    peer.on('connection', (conn) => this.#accept(conn));

    // Se perdió el websocket con el servidor de enlace (no las conexiones P2P ya abiertas).
    peer.on('disconnected', () => {
      if (!current()) return;
      this.#status('signaling-lost', 'Sin conexión con el servidor de enlace. Los jugadores conectados siguen jugando; los nuevos no pueden entrar. Reintentando…');
      this.#scheduleServerRetry();
    });

    peer.on('error', (err) => {
      if (current()) this.#handleError(err);
    });
  }

  #discardPeer() {
    const peer = this.#peer;
    this.#peer = null;
    peer?.destroy();
  }

  #handleError(err) {
    switch (err.type) {
      case 'unavailable-id':
        // Tras recargar, el servidor puede tardar en soltar el ID antiguo.
        this.#discardPeer();
        if (++this.#idBusyTries > ID_BUSY_MAX_TRIES) {
          this.#status('fatal', 'El código de sala sigue ocupado en el servidor. Crea una sala nueva.');
          return;
        }
        this.#status('id-busy', `Recuperando la sala ${this.roomCode}… (intento ${this.#idBusyTries})`);
        this.#retryTimer = setTimeout(() => this.#createPeer(), ID_BUSY_RETRY_MS);
        break;
      case 'network':
      case 'server-error':
      case 'socket-error':
      case 'socket-closed':
        this.#status('signaling-lost', describePeerError(err));
        this.#scheduleServerRetry();
        break;
      case 'browser-incompatible':
      case 'ssl-unavailable':
        this.#status('fatal', describePeerError(err));
        break;
      default:
        // Errores de una conexión concreta (webrtc, peer-unavailable…): no afectan a la sala.
        console.warn('[host] PeerJS', err.type, err);
    }
  }

  #scheduleServerRetry() {
    clearTimeout(this.#retryTimer);
    const delay = SERVER_RETRY_MS[Math.min(this.#serverTries++, SERVER_RETRY_MS.length - 1)];
    this.#retryTimer = setTimeout(() => {
      const peer = this.#peer;
      if (this.#destroyed) return;
      if (!peer || peer.destroyed) this.#createPeer();
      else if (peer.disconnected) peer.reconnect();
    }, delay);
  }

  #accept(conn) {
    const id = conn.connectionId;
    this.#conns.set(id, conn);
    // Llegó la llamada por el servidor de enlace, pero ¿se abre la conexión directa? Si no, la wifi no la deja.
    let failed = false;
    const fail = () => {
      if (failed || conn.open) return;
      failed = true;
      this.onFailed?.();
    };
    const timer = setTimeout(fail, OPEN_TIMEOUT_MS);
    conn.peerConnection?.addEventListener('iceconnectionstatechange', () => {
      if (conn.peerConnection.iceConnectionState === 'failed') fail();
    });
    conn.on('open', () => {
      clearTimeout(timer);
      this.onConnection?.(id, conn.peer);
    });
    conn.on('data', (data) => this.onData?.(id, data));
    const closed = () => {
      if (!this.#conns.has(id)) return;
      this.#conns.delete(id);
      this.onClose?.(id);
    };
    conn.on('close', closed);
    conn.on('error', closed);
  }
}
