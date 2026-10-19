import { and, desc, eq, gt, isNull, lt } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { adminUsers, authTokens, merchants, merchantUsers, sessions } from '../../db/schema.js';
import { HttpError } from '../../lib/errors.js';
import { DUMMY_HASH, hashPassword, verifyPassword } from '../../lib/password.js';
import { generateWebhookSecret, newId, randomCode, randomToken, sha256 } from '../../lib/security.js';
import type { Role } from '../admin/permissions.js';

export type SessionKind = 'merchant' | 'admin';
export type AccountType = 'personal' | 'business';

export const SESSION_TTL_HOURS = 12;
const EMAIL_CODE_TTL_MIN = 30;
const EMAIL_CODE_MAX_ATTEMPTS = 5;
const PASSWORD_RESET_TTL_MIN = 60;

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

// ---------------------------------------------------------------------
// Inscription et vérification de l'e-mail
// ---------------------------------------------------------------------

export async function signupMerchant(db: Db, p: { accountType: AccountType; name: string; email: string; password: string }) {
  const email = normalizeEmail(p.email);
  const passwordHash = await hashPassword(p.password);
  return db.transaction(async (tx) => {
    const [exists] = await tx.select({ id: merchantUsers.id }).from(merchantUsers).where(eq(merchantUsers.email, email));
    if (exists) throw new HttpError(409, 'email_taken', 'Un compte existe déjà avec cet e-mail');
    const merchantId = newId('mch');
    await tx.insert(merchants).values({
      id: merchantId, name: p.name.trim(), accountType: p.accountType, webhookSecret: generateWebhookSecret(),
    });
    const userId = newId('usr');
    await tx.insert(merchantUsers).values({ id: userId, merchantId, email, passwordHash });
    return { userId, merchantId, email };
  });
}

/** Génère un nouveau code à 6 chiffres (les codes précédents ne sont plus valables). */
export async function issueEmailCode(db: Db, userId: string): Promise<string> {
  const code = randomCode();
  await db.transaction(async (tx) => {
    await tx.update(authTokens).set({ usedAt: new Date() })
      .where(and(eq(authTokens.userId, userId), eq(authTokens.purpose, 'email_verification'), isNull(authTokens.usedAt)));
    await tx.insert(authTokens).values({
      id: newId('tok'), userId, purpose: 'email_verification', tokenHash: sha256(`${userId}:${code}`),
      expiresAt: new Date(Date.now() + EMAIL_CODE_TTL_MIN * 60_000),
    });
  });
  return code;
}

export async function verifyEmailCode(db: Db, userId: string, code: string) {
  const [token] = await db.select().from(authTokens)
    .where(and(eq(authTokens.userId, userId), eq(authTokens.purpose, 'email_verification'),
      isNull(authTokens.usedAt), gt(authTokens.expiresAt, new Date())))
    .orderBy(desc(authTokens.createdAt)).limit(1);
  if (!token) throw new HttpError(400, 'code_expired', 'Code expiré : demande un nouveau code');
  if (token.attempts >= EMAIL_CODE_MAX_ATTEMPTS) {
    throw new HttpError(429, 'too_many_attempts', 'Trop d\'essais : demande un nouveau code');
  }
  if (token.tokenHash !== sha256(`${userId}:${code}`)) {
    await db.update(authTokens).set({ attempts: token.attempts + 1 }).where(eq(authTokens.id, token.id));
    throw new HttpError(400, 'invalid_code', 'Code incorrect');
  }
  await db.transaction(async (tx) => {
    await tx.update(authTokens).set({ usedAt: new Date() }).where(eq(authTokens.id, token.id));
    await tx.update(merchantUsers).set({ emailVerifiedAt: new Date() }).where(eq(merchantUsers.id, userId));
  });
}

// ---------------------------------------------------------------------
// Connexion et mots de passe
// ---------------------------------------------------------------------

/** Vérifie e-mail + mot de passe. Même message d'erreur que le compte existe ou non. */
export async function checkCredentials(db: Db, kind: SessionKind, email: string, password: string): Promise<string> {
  const normalized = normalizeEmail(email);
  let user: { id: string; hash: string; disabled: boolean } | undefined;
  if (kind === 'merchant') {
    const [u] = await db.select().from(merchantUsers).where(eq(merchantUsers.email, normalized));
    user = u && { id: u.id, hash: u.passwordHash, disabled: false };
  } else {
    const [u] = await db.select().from(adminUsers).where(eq(adminUsers.email, normalized));
    user = u && { id: u.id, hash: u.passwordHash, disabled: u.disabledAt !== null };
  }
  // On vérifie toujours un mot de passe (même factice) : le temps de réponse ne révèle pas si le compte existe.
  const ok = await verifyPassword(password, user?.hash ?? DUMMY_HASH);
  if (!user || !ok || user.disabled) throw new HttpError(401, 'invalid_credentials', 'E-mail ou mot de passe incorrect');
  return user.id;
}

/** Crée un lien de réinitialisation. Renvoie null si l'e-mail est inconnu (sans le révéler à l'appelant). */
export async function issuePasswordReset(db: Db, email: string) {
  const [user] = await db.select({ id: merchantUsers.id, email: merchantUsers.email }).from(merchantUsers)
    .where(eq(merchantUsers.email, normalizeEmail(email)));
  if (!user) return null;
  const token = randomToken();
  await db.insert(authTokens).values({
    id: newId('tok'), userId: user.id, purpose: 'password_reset', tokenHash: sha256(token),
    expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MIN * 60_000),
  });
  return { email: user.email, token };
}

export async function resetPassword(db: Db, token: string, newPassword: string): Promise<string> {
  const passwordHash = await hashPassword(newPassword);
  return db.transaction(async (tx) => {
    const [t] = await tx.select().from(authTokens)
      .where(and(eq(authTokens.tokenHash, sha256(token)), eq(authTokens.purpose, 'password_reset'),
        isNull(authTokens.usedAt), gt(authTokens.expiresAt, new Date())))
      .for('update');
    if (!t) throw new HttpError(400, 'invalid_token', 'Lien invalide ou expiré : refais une demande');
    await tx.update(authTokens).set({ usedAt: new Date() }).where(eq(authTokens.id, t.id));
    const [user] = await tx.update(merchantUsers)
      // Le lien reçu par e-mail prouve aussi que l'adresse est valide
      .set({ passwordHash, emailVerifiedAt: new Date() })
      .where(eq(merchantUsers.id, t.userId)).returning();
    // Toutes les sessions existantes sont fermées (si quelqu'un d'autre était connecté)
    await tx.delete(sessions).where(eq(sessions.userId, t.userId));
    return user!.email;
  });
}

export async function changePassword(db: Db, userId: string, current: string, next: string) {
  const [user] = await db.select().from(merchantUsers).where(eq(merchantUsers.id, userId));
  if (!user || !(await verifyPassword(current, user.passwordHash))) {
    throw new HttpError(400, 'invalid_password', 'Mot de passe actuel incorrect');
  }
  await db.transaction(async (tx) => {
    await tx.update(merchantUsers).set({ passwordHash: await hashPassword(next) }).where(eq(merchantUsers.id, userId));
    await tx.delete(sessions).where(eq(sessions.userId, userId));
  });
  return user.email;
}

// ---------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------

export async function createSession(db: Db, kind: SessionKind, userId: string) {
  const token = randomToken();
  await db.insert(sessions).values({
    id: sha256(token), kind, userId, expiresAt: new Date(Date.now() + SESSION_TTL_HOURS * 3600_000),
  });
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date())); // nettoyage des sessions expirées
  return token;
}

export async function deleteSession(db: Db, token: string) {
  await db.delete(sessions).where(eq(sessions.id, sha256(token)));
}

export async function resolveSession(db: Db, kind: SessionKind, token: string | undefined) {
  if (!token) return null;
  const [s] = await db.select().from(sessions)
    .where(and(eq(sessions.id, sha256(token)), eq(sessions.kind, kind), gt(sessions.expiresAt, new Date())));
  return s ?? null;
}

// ---------------------------------------------------------------------
// Équipe back-office
// ---------------------------------------------------------------------

export async function createAdmin(db: Db, email: string, password: string, role: Role) {
  const normalized = normalizeEmail(email);
  const [exists] = await db.select({ id: adminUsers.id }).from(adminUsers).where(eq(adminUsers.email, normalized));
  if (exists) throw new HttpError(409, 'email_taken', 'Un membre de l\'équipe utilise déjà cet e-mail');
  const id = newId('adm');
  await db.insert(adminUsers).values({ id, email: normalized, role, passwordHash: await hashPassword(password) });
  return id;
}
