import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'node:crypto';

// Hachage des mots de passe avec scrypt (intégré à Node.js, résistant aux attaques par force brute).
const N = 16384, r = 8, p = 1, KEYLEN = 64;

const scrypt = (password: string, salt: Buffer, opts: ScryptOptions) =>
  new Promise<Buffer>((resolve, reject) =>
    scryptCb(password, salt, KEYLEN, opts, (err, key) => (err ? reject(err) : resolve(key))));

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, { N, r, p });
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, n, rr, pp, salt, hash] = stored.split('$');
  if (algo !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = await scrypt(password, Buffer.from(salt, 'base64'), { N: Number(n), r: Number(rr), p: Number(pp) });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// Empreinte factice : on vérifie quand même un mot de passe quand l'e-mail n'existe pas,
// pour que le temps de réponse ne révèle pas quels comptes existent.
export const DUMMY_HASH = await hashPassword(randomBytes(16).toString('hex'));
