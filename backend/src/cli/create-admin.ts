// Crée un compte pour l'équipe back-office.
// Usage : npm run admin:create -- prenom@entreprise.com [owner|compliance|finance|support]
import { randomBytes } from 'node:crypto';
import { requireDatabaseUrl } from '../config.js';
import { createDb } from '../db/client.js';
import { ROLE_LABELS, ROLES, type Role } from '../modules/admin/permissions.js';
import { createAdmin } from '../modules/auth/service.js';

const [email, roleArg = 'owner'] = process.argv.slice(2);
if (!email || !email.includes('@') || !ROLES.includes(roleArg as Role)) {
  console.error(`Usage : npm run admin:create -- prenom@entreprise.com [${ROLES.join('|')}]`);
  process.exit(1);
}
const role = roleArg as Role;

const { db, close } = createDb(requireDatabaseUrl());
const password = randomBytes(12).toString('base64url'); // mot de passe fort, affiché une seule fois
try {
  await createAdmin(db, email, password, role);
  console.log(`Compte back-office créé.
  E-mail       : ${email.toLowerCase()}
  Rôle         : ${ROLE_LABELS[role]}
  Mot de passe : ${password}
(à noter maintenant, il ne sera plus affiché)`);
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  await close();
}
