// Mensajes JSON entre jugador y presentador. Campo `t` = tipo. Ver CLAUDE.md.
export const PROTOCOL_VERSION = 1;

export const MSG = {
  // jugador → presentador
  HELLO: 'hello',
  PROFILE: 'profile',
  HB_ACK: 'hbAck',
  BUZZ: 'buzz',
  SYNC: 'sync',
  SYNC_REPORT: 'syncReport',
  // presentador → jugador
  WELCOME: 'welcome',
  STATE: 'state',
  HB: 'hb',
  BUZZ_ACK: 'buzzAck',
  SYNC_REPLY: 'syncReply',
  ERROR: 'error',
};

export const ERROR_CODE = {
  ROOM_FULL: 'room-full',
  VERSION: 'version',
  REMOVED: 'removed',
  REPLACED: 'replaced',
};

const isStr = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * Valida un mensaje recibido por el presentador. Devuelve el mensaje (solo con los campos conocidos)
 * o `null` si no es válido. El juego es entre amigos, pero un móvil con una versión vieja no debe romper nada.
 */
export function parsePlayerMessage(msg) {
  if (!msg || typeof msg !== 'object') return null;
  switch (msg.t) {
    case MSG.HELLO:
      if (!isNum(msg.v) || !isStr(msg.playerId, 64)) return null;
      return {
        t: msg.t,
        v: msg.v,
        playerId: msg.playerId,
        name: typeof msg.name === 'string' ? msg.name.slice(0, 64) : '',
        color: typeof msg.color === 'string' ? msg.color.slice(0, 32) : '',
        icon: typeof msg.icon === 'string' ? msg.icon.slice(0, 32) : '',
      };
    case MSG.PROFILE:
      return {
        t: msg.t,
        name: typeof msg.name === 'string' ? msg.name.slice(0, 64) : '',
        color: typeof msg.color === 'string' ? msg.color.slice(0, 32) : '',
        icon: typeof msg.icon === 'string' ? msg.icon.slice(0, 32) : '',
      };
    case MSG.HB_ACK:
      return isNum(msg.h0) ? { t: msg.t, h0: msg.h0 } : null;
    case MSG.BUZZ:
      if (!isNum(msg.seq) || !isNum(msg.epoch)) return null;
      return {
        t: msg.t,
        seq: msg.seq,
        epoch: msg.epoch,
        // Sin sincronizar aún: el presentador usará la hora de llegada.
        tLocal: isNum(msg.tLocal) ? msg.tLocal : undefined,
        offset: isNum(msg.offset) ? msg.offset : undefined,
        err: isNum(msg.err) ? msg.err : undefined,
      };
    case MSG.SYNC:
      return isNum(msg.id) && isNum(msg.t0) ? { t: msg.t, id: msg.id, t0: msg.t0 } : null;
    case MSG.SYNC_REPORT:
      if (!isNum(msg.offset) || !isNum(msg.err)) return null;
      return { t: msg.t, offset: msg.offset, err: msg.err, rtt: isNum(msg.rtt) ? msg.rtt : msg.err * 2, samples: isNum(msg.samples) ? msg.samples : 0 };
    default:
      return null;
  }
}

/** Valida un mensaje recibido por el jugador. */
export function parseHostMessage(msg) {
  if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return null;
  switch (msg.t) {
    case MSG.HB:
      return isNum(msg.h0) ? msg : null;
    case MSG.WELCOME:
    case MSG.STATE:
      return msg.you && typeof msg.you === 'object' ? msg : null;
    case MSG.ERROR:
      return typeof msg.code === 'string' ? msg : null;
    case MSG.BUZZ_ACK:
      return isNum(msg.seq) && typeof msg.result === 'string' ? msg : null;
    case MSG.SYNC_REPLY:
      return isNum(msg.id) && isNum(msg.t0) && isNum(msg.t1) && isNum(msg.t2) ? msg : null;
    default:
      return null;
  }
}
