// Usage : npm run merchant:create -- "Nom de la boutique" [https://boutique.com/webhooks/agcrypto]
import { randomBytes } from 'node:crypto';
import { createDb } from '../db/client.js';
import { apiKeys, merchants } from '../db/schema.js';
import { generateApiKey, newId } from '../lib/security.js';

const [name, webhookUrl] = process.argv.slice(2);
if (!name) {
  console.error('Usage : npm run merchant:create -- "Nom" [webhook_url]');
  process.exit(1);
}
if (webhookUrl && !webhookUrl.startsWith('https://')) {
  console.error('L\'URL de webhook doit être en https://');
  process.exit(1);
}

const { db, close } = createDb(process.env.DATABASE_URL!);
const merchantId = newId('mch');
const webhookSecret = `whsec_${randomBytes(24).toString('base64url')}`;
const apiKey = generateApiKey();

await db.transaction(async (tx) => {
  await tx.insert(merchants).values({ id: merchantId, name, webhookUrl, webhookSecret });
  await tx.insert(apiKeys).values({ id: newId('key'), merchantId, keyHash: apiKey.hash, prefix: apiKey.prefix });
});
await close();

console.log(`Marchand créé : ${merchantId}
Clé API (affichée une seule fois, à transmettre au marchand) : ${apiKey.key}
Secret webhook : ${webhookSecret}`);
