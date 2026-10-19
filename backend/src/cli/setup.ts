// Prépare le fichier .env pour le local : le crée s'il n'existe pas, sinon complète les valeurs vides.
// Ne remplace jamais une valeur que tu as déjà renseignée (sauf l'ancienne adresse de base par défaut).
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const template = readFileSync('.env.example', 'utf8');
const current = existsSync('.env') ? readFileSync('.env', 'utf8') : '';
const values = new Map<string, string>();
for (const line of current.split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) values.set(m[1]!, m[2]!.trim());
}

const OLD_DB_DEFAULTS = [5432, 5433].map((p) => `postgres://agcrypto:agcrypto@localhost:${p}/agcrypto`);
const changes: string[] = [];

const out = template.split('\n').map((line) => {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (!m) return line;
  const [, key, def] = m as unknown as [string, string, string];
  let value = values.get(key) ?? '';
  if (key === 'DATABASE_URL' && OLD_DB_DEFAULTS.includes(value)) value = '';
  if (!value) {
    value = key === 'ADMIN_TOKEN' ? randomBytes(32).toString('hex') : def;
    if (value) changes.push(key);
  }
  return `${key}=${value}`;
});
// Conserve les variables ajoutées à la main qui ne sont pas dans le modèle
for (const [key, value] of values) if (!template.includes(`\n${key}=`) && !template.startsWith(`${key}=`)) out.push(`${key}=${value}`);

writeFileSync('.env', out.join('\n'));
console.log(changes.length ? `.env prêt (complété : ${changes.join(', ')})` : '.env déjà complet');
const env = out.find((l) => l.startsWith('NOWPAYMENTS_ENV='))?.split('=')[1];
if (env === 'demo') console.log('Mode démo : paiements fictifs. Pour NOWPayments, mets NOWPAYMENTS_ENV=sandbox et tes clés.');
