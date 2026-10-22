// El servidor público de PeerJS es compartido por todo el mundo: el prefijo evita choques de IDs.
export const PEER_ID_PREFIX = 'concurso-del-ano-v1-';

export function hostPeerId(roomCode) {
  return PEER_ID_PREFIX + roomCode;
}

/**
 * Servidores TURN (repetidores): solo hacen falta si la wifi no deja que el móvil y el portátil hablen directamente
 * (wifi de invitados, aislamiento entre dispositivos…). Los gratuitos de PeerJS y de Metered ya no existen (2026):
 * aquí van los de una cuenta propia, p. ej. [{urls: ['turn:…:3478', 'turns:…:443?transport=tcp'], username, credential}].
 */
export const TURN_SERVERS = [];

// Sin `host`/`port`: PeerJS usa su servidor de enlace público (0.peerjs.com). Los STUN dicen a cada uno su
// dirección pública; en la misma wifi casi siempre basta con la conexión directa.
export const PEER_OPTIONS = {
  debug: 1, // 0 nada, 1 errores, 2 avisos, 3 todo
  config: {
    iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }, { urls: 'stun:stun.cloudflare.com:3478' }, ...TURN_SERVERS],
  },
};

export const CONNECTION_OPTIONS = {
  reliable: true,
  serialization: 'json',
};

/** Traduce los errores de PeerJS a mensajes para personas. */
export function describePeerError(err) {
  switch (err?.type) {
    case 'network':
    case 'server-error':
    case 'socket-error':
    case 'socket-closed':
      return 'No se puede contactar con el servidor de enlace de PeerJS. Comprueba la conexión a internet; si está bien, puede que el servidor público esté caído: prueba de nuevo en unos minutos.';
    case 'browser-incompatible':
      return 'Este navegador no admite WebRTC. Prueba con Chrome, Safari o Firefox actualizados.';
    case 'peer-unavailable':
      return 'No se encuentra la sala. Comprueba el código.';
    case 'unavailable-id':
      return 'El código de sala está ocupado en el servidor.';
    case 'ssl-unavailable':
      return 'La página debe abrirse con HTTPS.';
    case 'webrtc':
      return 'Fallo de WebRTC al conectar. Asegúrate de estar en la misma wifi.';
    default:
      return 'Error de conexión: ' + (err?.message || err?.type || 'desconocido');
  }
}
