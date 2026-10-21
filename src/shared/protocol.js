// Mensajes JSON entre los móviles (jugadores y mando del presentador) y el portátil. Campo `t` = tipo.
// Ver CLAUDE.md.
export const PROTOCOL_VERSION = 2;

export const ROLE = { PLAYER: 'player', CONTROL: 'control' };

export const MSG = {
  // móvil → portátil
  HELLO: 'hello',
  PROFILE: 'profile',
  HB_ACK: 'hbAck',
  BUZZ: 'buzz',
  SYNC: 'sync',
  SYNC_REPORT: 'syncReport',
  ANSWER: 'answer', // respuesta en secciones de respuestas
  JOKER: 'joker', // usar un comodín
  CMD: 'cmd', // solo el mando
  // portátil → móvil
  WELCOME: 'welcome',
  STATE: 'state',
  HB: 'hb',
  BUZZ_ACK: 'buzzAck',
  ANSWER_ACK: 'answerAck', // también para comodines: {seq, result, message?}
  SYNC_REPLY: 'syncReply',
  ERROR: 'error',
  CONTROL_STATUS: 'controlStatus', // pending | approved
  CONTROL_STATE: 'controlState',
  CMD_RESULT: 'cmdResult',
};

export const ERROR_CODE = {
  ROOM_FULL: 'room-full',
  VERSION: 'version',
  REMOVED: 'removed',
  REPLACED: 'replaced',
  CONTROL_DENIED: 'control-denied',
};

const isStr = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
const optStr = (v, max) => (isStr(v, max) ? v : null);

/** Argumentos de una orden del mando: objeto plano con textos, números o booleanos. */
function parseArgs(args) {
  if (args == null) return {};
  if (typeof args !== 'object' || Array.isArray(args)) return null;
  const out = {};
  for (const [k, v] of Object.entries(args).slice(0, 16)) {
    if (typeof v === 'string') out[k] = v.slice(0, 200);
    else if (isNum(v) || typeof v === 'boolean' || v === null) out[k] = v;
    else return null;
  }
  return out;
}

/**
 * Valida un mensaje recibido por el portátil. Devuelve el mensaje (solo con los campos conocidos)
 * o `null` si no es válido. El juego es entre amigos, pero un móvil con una versión vieja no debe romper nada.
 */
export function parsePlayerMessage(msg) {
  if (!msg || typeof msg !== 'object') return null;
  switch (msg.t) {
    case MSG.HELLO:
      if (!isNum(msg.v)) return null;
      if (msg.role === ROLE.CONTROL) {
        if (!isStr(msg.controlId, 64)) return null;
        return { t: msg.t, v: msg.v, role: ROLE.CONTROL, controlId: msg.controlId, token: str(msg.token, 128), deviceName: str(msg.deviceName, 40) };
      }
      if (!isStr(msg.playerId, 64)) return null;
      return {
        t: msg.t,
        v: msg.v,
        role: ROLE.PLAYER,
        playerId: msg.playerId,
        name: str(msg.name, 64),
        color: str(msg.color, 32),
        icon: str(msg.icon, 32),
        teamId: optStr(msg.teamId, 64),
      };
    case MSG.PROFILE:
      return {
        t: msg.t,
        name: str(msg.name, 64),
        color: str(msg.color, 32),
        icon: str(msg.icon, 32),
        teamId: optStr(msg.teamId, 64),
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
    case MSG.ANSWER: {
      if (!isNum(msg.seq) || !isStr(msg.roundId, 80)) return null;
      const value = isNum(msg.value) ? msg.value : isStr(msg.value, 64) ? msg.value : null;
      if (value == null) return null;
      return {
        t: msg.t,
        seq: msg.seq,
        roundId: msg.roundId,
        value,
        tLocal: isNum(msg.tLocal) ? msg.tLocal : undefined,
        offset: isNum(msg.offset) ? msg.offset : undefined,
        err: isNum(msg.err) ? msg.err : undefined,
      };
    }
    case MSG.JOKER:
      return isNum(msg.seq) && isStr(msg.roundId, 80) && isStr(msg.kind, 20) ? { t: msg.t, seq: msg.seq, roundId: msg.roundId, kind: msg.kind } : null;
    case MSG.SYNC:
      return isNum(msg.id) && isNum(msg.t0) ? { t: msg.t, id: msg.id, t0: msg.t0 } : null;
    case MSG.SYNC_REPORT:
      if (!isNum(msg.offset) || !isNum(msg.err)) return null;
      return { t: msg.t, offset: msg.offset, err: msg.err, rtt: isNum(msg.rtt) ? msg.rtt : msg.err * 2, samples: isNum(msg.samples) ? msg.samples : 0 };
    case MSG.CMD: {
      if (!isNum(msg.id) || !isStr(msg.action, 40)) return null;
      const args = parseArgs(msg.args);
      return args ? { t: msg.t, id: msg.id, action: msg.action, args } : null;
    }
    default:
      return null;
  }
}

/** Valida un mensaje recibido por un móvil (jugador o mando). */
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
    case MSG.ANSWER_ACK:
      return isNum(msg.seq) && typeof msg.result === 'string' ? msg : null;
    case MSG.SYNC_REPLY:
      return isNum(msg.id) && isNum(msg.t0) && isNum(msg.t1) && isNum(msg.t2) ? msg : null;
    case MSG.CONTROL_STATUS:
      return typeof msg.status === 'string' ? msg : null;
    case MSG.CONTROL_STATE:
      return msg.view && typeof msg.view === 'object' ? msg : null;
    case MSG.CMD_RESULT:
      return isNum(msg.id) && typeof msg.ok === 'boolean' ? msg : null;
    default:
      return null;
  }
}
