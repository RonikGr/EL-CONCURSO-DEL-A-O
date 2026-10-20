// Código de sala corto y legible desde el sofá.
// De cada pareja que se confunde en la tele o al teclear queda como mucho uno:
// fuera O/0/Q, I/1/L, S/5, B/8, 6 (por G) y Z (por 2). 24⁴ ≈ 330 000 códigos.
export const ROOM_ALPHABET = 'ACDEFGHJKMNPRTUVWXY23479';
export const ROOM_CODE_LENGTH = 4;

/** `randomInt(n)` devuelve un entero en [0, n). Inyectable para tests. */
export function generateRoomCode(randomInt = cryptoRandomInt) {
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    code += ROOM_ALPHABET[randomInt(ROOM_ALPHABET.length)];
  }
  return code;
}

/** Mayúsculas y sin espacios ni guiones. No corrige letras: si no es válido, se rechaza. */
export function normalizeRoomCode(input) {
  return String(input ?? '')
    .toUpperCase()
    .replace(/[\s-]/g, '');
}

export function isValidRoomCode(code) {
  if (typeof code !== 'string' || code.length !== ROOM_CODE_LENGTH) return false;
  for (const ch of code) {
    if (!ROOM_ALPHABET.includes(ch)) return false;
  }
  return true;
}

function cryptoRandomInt(n) {
  // Rechazo para evitar sesgo de módulo.
  const limit = Math.floor(0x100000000 / n) * n;
  const buf = new Uint32Array(1);
  do {
    crypto.getRandomValues(buf);
  } while (buf[0] >= limit);
  return buf[0] % n;
}
