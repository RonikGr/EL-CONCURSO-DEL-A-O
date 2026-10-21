import { describe, expect, it } from 'vitest';
import { MSG, PROTOCOL_VERSION, parseHostMessage, parsePlayerMessage } from '../src/shared/protocol.js';

describe('protocolo', () => {
  it('acepta un hello válido y descarta campos desconocidos', () => {
    const msg = parsePlayerMessage({ t: MSG.HELLO, v: PROTOCOL_VERSION, playerId: 'abc', name: 'Ana', color: 'rojo', icon: 'zorro', extra: 1 });
    expect(msg).toEqual({ t: 'hello', v: 1, playerId: 'abc', name: 'Ana', color: 'rojo', icon: 'zorro' });
  });

  it('rechaza mensajes mal formados', () => {
    expect(parsePlayerMessage(null)).toBeNull();
    expect(parsePlayerMessage('hola')).toBeNull();
    expect(parsePlayerMessage({ t: MSG.HELLO, v: 1 })).toBeNull();
    expect(parsePlayerMessage({ t: MSG.HELLO, v: 1, playerId: 'x'.repeat(65) })).toBeNull();
    expect(parsePlayerMessage({ t: MSG.HB_ACK, h0: 'ayer' })).toBeNull();
    expect(parsePlayerMessage({ t: 'desconocido' })).toBeNull();
  });

  it('recorta textos demasiado largos', () => {
    const msg = parsePlayerMessage({ t: MSG.PROFILE, name: 'x'.repeat(500), color: 1 });
    expect(msg.name).toHaveLength(64);
    expect(msg.color).toBe('');
  });

  it('valida pulsaciones', () => {
    expect(parsePlayerMessage({ t: MSG.BUZZ, seq: 1, epoch: 4, x: 1 })).toEqual({
      t: 'buzz',
      seq: 1,
      epoch: 4,
      tLocal: undefined,
      offset: undefined,
      err: undefined,
    });
    expect(parsePlayerMessage({ t: MSG.BUZZ, seq: 1, epoch: 4, tLocal: 10.5, offset: -3, err: 'x' })).toMatchObject({
      tLocal: 10.5,
      offset: -3,
      err: undefined,
    });
    expect(parsePlayerMessage({ t: MSG.BUZZ, seq: 1 })).toBeNull();
    expect(parseHostMessage({ t: MSG.BUZZ_ACK, seq: 1, result: 'ok' })).not.toBeNull();
    expect(parseHostMessage({ t: MSG.BUZZ_ACK, seq: 1 })).toBeNull();
  });

  it('valida la sincronización', () => {
    expect(parsePlayerMessage({ t: MSG.SYNC, id: 3, t0: 12.5 })).toEqual({ t: 'sync', id: 3, t0: 12.5 });
    expect(parsePlayerMessage({ t: MSG.SYNC, id: 3 })).toBeNull();
    expect(parsePlayerMessage({ t: MSG.SYNC_REPORT, offset: 100, err: 4 })).toEqual({ t: 'syncReport', offset: 100, err: 4, rtt: 8, samples: 0 });
    expect(parseHostMessage({ t: MSG.SYNC_REPLY, id: 1, t0: 1, t1: 2, t2: 3 })).not.toBeNull();
    expect(parseHostMessage({ t: MSG.SYNC_REPLY, id: 1, t0: 1, t1: 2 })).toBeNull();
  });

  it('valida mensajes del presentador', () => {
    expect(parseHostMessage({ t: MSG.HB, h0: 12.5 })).not.toBeNull();
    expect(parseHostMessage({ t: MSG.STATE })).toBeNull();
    expect(parseHostMessage({ t: MSG.STATE, you: {} })).not.toBeNull();
    expect(parseHostMessage({ t: MSG.ERROR, code: 'room-full' })).not.toBeNull();
  });
});
