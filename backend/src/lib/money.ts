// Arithmétique décimale exacte en bigint (18 décimales), pour ne jamais utiliser de float.
const SCALE = 18;
const FACTOR = 10n ** BigInt(SCALE);

export function toUnits(value: string | number): bigint {
  let s = typeof value === 'number' ? numberToString(value) : value.trim();
  const negative = s.startsWith('-');
  if (negative) s = s.slice(1);
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error(`Montant invalide : ${value}`);
  const [int = '0', frac = ''] = s.split('.');
  if (frac.length > SCALE) throw new Error(`Trop de décimales : ${value}`);
  const units = BigInt(int) * FACTOR + BigInt(frac.padEnd(SCALE, '0'));
  return negative ? -units : units;
}

export function fromUnits(units: bigint): string {
  const negative = units < 0n;
  const abs = negative ? -units : units;
  const int = abs / FACTOR;
  const frac = (abs % FACTOR).toString().padStart(SCALE, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}${int}${frac ? `.${frac}` : ''}`;
}

/** Calcule un pourcentage, arrondi vers le bas (en faveur du marchand). */
export function percentOf(units: bigint, percent: number): bigint {
  const basisPoints = BigInt(Math.round(percent * 100));
  return (units * basisPoints) / 10_000n;
}

// NOWPayments renvoie des nombres JSON : on les convertit sans notation exponentielle.
function numberToString(n: number): string {
  if (!Number.isFinite(n)) throw new Error(`Montant invalide : ${n}`);
  const s = String(n);
  if (!/e/i.test(s)) return s;
  return n.toFixed(SCALE).replace(/\.?0+$/, '');
}

/** Multiplie deux décimaux exprimés en chaînes (ex. montant × taux de change), résultat exact à 18 décimales. */
export function mulDecimal(a: string | number, b: string | number): string {
  return fromUnits((toUnits(a) * toUnits(b)) / FACTOR);
}

export const sumDecimals = (values: (string | null | undefined)[]) =>
  fromUnits(values.reduce((acc, v) => acc + (v ? toUnits(v) : 0n), 0n));
