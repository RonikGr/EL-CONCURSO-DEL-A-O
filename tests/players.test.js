import { describe, expect, it } from 'vitest';
import { COLORS, ICONS, appearanceKey } from '../src/shared/appearance.js';
import { MAX_PLAYERS, Roster, pickFreeAppearance, sanitizeName, uniqueName } from '../src/core/players.js';

const [C1, C2] = COLORS.map((c) => c.id);
const [I1, I2] = ICONS.map((i) => i.id);

function joinMany(roster, n) {
  for (let i = 0; i < n; i++) {
    roster.join({ playerId: `p${i}`, name: `J${i}`, color: C1, icon: I1 });
  }
}

describe('nombres', () => {
  it('limpia espacios, caracteres de control y longitud', () => {
    expect(sanitizeName('  Ana   María  ')).toBe('Ana María');
    expect(sanitizeName('a\u0000b')).toBe('ab');
    expect(sanitizeName('')).toBe('Jugador');
    expect(sanitizeName('x'.repeat(40))).toHaveLength(16);
  });

  it('no parte un emoji al recortar', () => {
    const name = sanitizeName('a'.repeat(15) + '🦊🦊');
    expect([...name]).toHaveLength(16);
    expect(name.endsWith('🦊')).toBe(true);
  });

  it('añade sufijo a nombres repetidos sin distinguir mayúsculas', () => {
    expect(uniqueName('Ana', [])).toBe('Ana');
    expect(uniqueName('Ana', ['ana'])).toBe('Ana (2)');
    expect(uniqueName('Ana', ['Ana', 'Ana (2)'])).toBe('Ana (3)');
  });
});

describe('apariencia color + icono', () => {
  it('respeta la pareja pedida si está libre', () => {
    expect(pickFreeAppearance(C1, I1, [])).toEqual({ color: C1, icon: I1 });
  });

  it('si está cogida, mantiene el color y cambia el icono', () => {
    expect(pickFreeAppearance(C1, I1, [appearanceKey(C1, I1)])).toEqual({ color: C1, icon: I2 });
  });

  it('si el color está agotado, mantiene el icono y cambia el color', () => {
    const taken = ICONS.map((i) => appearanceKey(C1, i.id));
    expect(pickFreeAppearance(C1, I1, taken)).toEqual({ color: C2, icon: I1 });
  });

  it('sustituye valores desconocidos por unos válidos', () => {
    expect(pickFreeAppearance('xx', 'yy', [])).toEqual({ color: C1, icon: I1 });
  });
});

describe('Roster', () => {
  it('da de alta jugadores y resuelve choques de nombre y apariencia', () => {
    const r = new Roster();
    const a = r.join({ playerId: 'a', name: 'Ana', color: C1, icon: I1 });
    const b = r.join({ playerId: 'b', name: 'ana', color: C1, icon: I1 });
    expect(a).toMatchObject({ ok: true, isNew: true, renamed: false, appearanceChanged: false });
    expect(b).toMatchObject({ ok: true, isNew: true, renamed: true, appearanceChanged: true });
    expect(b.player.name).toBe('ana (2)');
    expect(appearanceKey(b.player.color, b.player.icon)).not.toBe(appearanceKey(C1, I1));
  });

  it('al reconectar conserva puntos y no se renombra contra sí mismo', () => {
    const r = new Roster();
    r.join({ playerId: 'a', name: 'Ana', color: C1, icon: I1 });
    r.adjustScore('a', 3);
    r.setConnected('a', false);
    const again = r.join({ playerId: 'a', name: 'Ana', color: C1, icon: I1 });
    expect(again).toMatchObject({ ok: true, isNew: false, renamed: false, appearanceChanged: false });
    expect(again.player).toMatchObject({ score: 3, connected: true, name: 'Ana' });
    expect(r.size).toBe(1);
  });

  it(`admite como máximo ${MAX_PLAYERS} jugadores, pero deja reconectar a los que ya están`, () => {
    const r = new Roster();
    joinMany(r, MAX_PLAYERS);
    expect(r.size).toBe(MAX_PLAYERS);
    expect(r.join({ playerId: 'nuevo', name: 'X', color: C1, icon: I1 })).toEqual({ ok: false, reason: 'full' });
    r.setConnected('p0', false);
    expect(r.join({ playerId: 'p0', name: 'J0', color: C1, icon: I1 }).ok).toBe(true);
  });

  it('todas las parejas color+icono son distintas aunque todos pidan la misma', () => {
    const r = new Roster();
    joinMany(r, MAX_PLAYERS);
    const keys = r.list().map((p) => appearanceKey(p.color, p.icon));
    expect(new Set(keys).size).toBe(MAX_PLAYERS);
  });

  it('cambia el perfil respetando a los demás', () => {
    const r = new Roster();
    r.join({ playerId: 'a', name: 'Ana', color: C1, icon: I1 });
    r.join({ playerId: 'b', name: 'Bea', color: C2, icon: I1 });
    const res = r.updateProfile('b', { name: 'Ana', color: C1, icon: I1 });
    expect(res.player.name).toBe('Ana (2)');
    expect(res.appearanceChanged).toBe(true);
    expect(r.updateProfile('nadie', { name: 'x' })).toBeNull();
  });

  it('se guarda y se recupera (recarga del presentador) con todos desconectados', () => {
    const r = new Roster();
    r.join({ playerId: 'a', name: 'Ana', color: C1, icon: I1 });
    r.join({ playerId: 'b', name: 'Bea', color: C2, icon: I2 });
    r.adjustScore('b', 2);
    const restored = new Roster(JSON.parse(JSON.stringify(r.toJSON())));
    expect(restored.list().map((p) => [p.id, p.score, p.connected])).toEqual([
      ['a', 0, false],
      ['b', 2, false],
    ]);
    const c = restored.join({ playerId: 'c', name: 'Cris', color: C1, icon: I2 });
    expect(c.player.joinSeq).toBeGreaterThan(restored.get('b').joinSeq);
  });

  it('borra jugadores y reinicia marcadores', () => {
    const r = new Roster();
    r.join({ playerId: 'a', name: 'Ana', color: C1, icon: I1 });
    r.adjustScore('a', 5);
    r.resetScores();
    expect(r.get('a').score).toBe(0);
    expect(r.remove('a')).toBe(true);
    expect(r.size).toBe(0);
  });
});
