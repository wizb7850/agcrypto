import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import type { Db } from '../../db/client.js';
import { kycDocuments, kycSubmissions, merchants, merchantUsers } from '../../db/schema.js';
import { HttpError } from '../../lib/errors.js';
import { newId, sha256 } from '../../lib/security.js';
import type { AdminRow, MerchantRow } from '../../plugins/guards.js';
import { audit } from '../admin/audit.js';
import { sendInBackground } from '../notifications/mailer.js';
import * as mails from '../notifications/templates.js';

// =====================================================================
// Ce qu'on demande pour chaque niveau
// =====================================================================

export const DOCUMENT_KINDS = {
  id_front: 'Pièce d\'identité (recto)',
  id_back: 'Pièce d\'identité (verso)',
  selfie: 'Selfie avec la pièce d\'identité',
  proof_of_address: 'Justificatif de domicile (moins de 3 mois)',
  company_registration: 'Extrait d\'immatriculation de l\'entreprise',
  company_statutes: 'Statuts de l\'entreprise',
  company_proof_of_address: 'Justificatif d\'adresse de l\'entreprise',
  representative_id_front: 'Pièce d\'identité du dirigeant (recto)',
  representative_id_back: 'Pièce d\'identité du dirigeant (verso)',
} as const;
export type DocumentKind = keyof typeof DOCUMENT_KINDS;

const ID_TYPES = ['passport', 'id_card', 'driving_license'] as const;

const adult = z.iso.date('Date au format AAAA-MM-JJ').refine((d) => {
  const birth = new Date(d);
  const limit = new Date();
  limit.setFullYear(limit.getFullYear() - 18);
  return birth <= limit && birth.getFullYear() > 1900;
}, 'La personne doit être majeure');

const text = (max = 120) => z.string().trim().min(1, 'Champ obligatoire').max(max);

const person = {
  first_name: text(60),
  last_name: text(60),
  birth_date: adult,
  nationality: text(60),
  id_type: z.enum(ID_TYPES),
  id_number: text(60),
};

export const personalData = z.object({
  ...person,
  country: text(60),
  city: text(80),
  address: text(200),
  postal_code: z.string().trim().max(20).optional(),
});

export const businessData = z.object({
  company_name: text(150),
  registration_number: text(80),
  country: text(60),
  city: text(80),
  address: text(200),
  postal_code: z.string().trim().max(20).optional(),
  website: z.url().optional().or(z.literal('').transform(() => undefined)),
  activity: z.string().trim().min(3, 'Décris l\'activité en quelques mots').max(300),
  representative: z.object({ ...person, role: text(60) }),
});

/** Documents obligatoires selon le niveau et le type de pièce d'identité. */
export function requiredDocuments(level: 'personal' | 'business', idType?: string): DocumentKind[] {
  if (level === 'personal') {
    return ['id_front', ...(idType === 'passport' ? [] : ['id_back' as const]), 'selfie', 'proof_of_address'];
  }
  return ['company_registration', 'company_proof_of_address', 'representative_id_front',
    ...(idType === 'passport' ? [] : ['representative_id_back' as const])];
}

export const REQUIREMENTS = {
  personal: {
    documents: requiredDocuments('personal'),
    optional_documents: [] as DocumentKind[],
    note: 'Le verso n\'est pas demandé pour un passeport.',
  },
  business: {
    documents: requiredDocuments('business'),
    optional_documents: ['company_statutes'] as DocumentKind[],
    note: 'Le verso n\'est pas demandé pour un passeport.',
  },
};

// =====================================================================
// Documents
// =====================================================================

const MAX_FILE_BYTES = 10 * 1024 * 1024;

/** Détecte le vrai type du fichier par sa signature (on ne fait pas confiance à l'extension). */
function detectType(buf: Buffer): string | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

export async function uploadDocument(
  ctx: AppContext,
  merchantId: string,
  kind: DocumentKind,
  fileName: string,
  data: Buffer,
) {
  if (data.length === 0) throw new HttpError(400, 'empty_file', 'Fichier vide');
  if (data.length > MAX_FILE_BYTES) throw new HttpError(413, 'file_too_large', 'Fichier trop lourd (10 Mo maximum)');
  const mimeType = detectType(data);
  if (!mimeType) throw new HttpError(415, 'unsupported_file', 'Formats acceptés : JPG, PNG, WEBP ou PDF');

  const [{ pending }] = await ctx.db.select({ pending: sql<number>`count(*)::int` }).from(kycDocuments)
    .where(and(eq(kycDocuments.merchantId, merchantId), isNull(kycDocuments.submissionId))) as [{ pending: number }];
  if (pending >= 30) throw new HttpError(429, 'too_many_documents', 'Trop de documents en attente : envoie ton dossier');

  const id = newId('doc');
  await ctx.storage.put(id, data);
  const [doc] = await ctx.db.insert(kycDocuments).values({
    id, merchantId, kind, fileName: fileName.slice(0, 200), mimeType, size: data.length, sha256: sha256(data), storageKey: id,
  }).returning();
  return presentDocument(doc!);
}

const presentDocument = (d: typeof kycDocuments.$inferSelect) => ({
  id: d.id, kind: d.kind, label: DOCUMENT_KINDS[d.kind as DocumentKind] ?? d.kind,
  file_name: d.fileName, mime_type: d.mimeType, size: d.size, created_at: d.createdAt.toISOString(),
});

// =====================================================================
// Dossiers
// =====================================================================

type Submission = typeof kycSubmissions.$inferSelect;
const presentSubmission = (s: Submission) => ({
  id: s.id, level: s.level, status: s.status, reject_reason: s.rejectReason,
  submitted_at: s.submittedAt.toISOString(), reviewed_at: s.reviewedAt?.toISOString() ?? null,
});

export const submissionBody = z.discriminatedUnion('level', [
  z.object({ level: z.literal('personal'), data: personalData, document_ids: z.array(z.string()).min(1).max(20) }),
  z.object({ level: z.literal('business'), data: businessData, document_ids: z.array(z.string()).min(1).max(20) }),
]);

export async function submitVerification(db: Db, merchant: MerchantRow, body: z.output<typeof submissionBody>) {
  if (merchant.verificationLevel === 'business' || merchant.verificationLevel === body.level) {
    throw new HttpError(409, 'already_verified', 'Ton compte est déjà vérifié à ce niveau');
  }
  const idType = body.level === 'personal' ? body.data.id_type : body.data.representative.id_type;

  return db.transaction(async (tx) => {
    await tx.select({ id: merchants.id }).from(merchants).where(eq(merchants.id, merchant.id)).for('update');
    const [pending] = await tx.select({ id: kycSubmissions.id }).from(kycSubmissions)
      .where(and(eq(kycSubmissions.merchantId, merchant.id), eq(kycSubmissions.status, 'pending')));
    if (pending) throw new HttpError(409, 'already_pending', 'Un dossier est déjà en cours d\'examen');

    const ids = [...new Set(body.document_ids)];
    const docs = await tx.select().from(kycDocuments)
      .where(and(inArray(kycDocuments.id, ids), eq(kycDocuments.merchantId, merchant.id), isNull(kycDocuments.submissionId)));
    if (docs.length !== ids.length) {
      throw new HttpError(400, 'invalid_documents', 'Certains documents sont introuvables ou déjà utilisés : renvoie-les');
    }
    const missing = requiredDocuments(body.level, idType).filter((k) => !docs.some((d) => d.kind === k));
    if (missing.length) {
      throw new HttpError(400, 'missing_documents', `Documents manquants : ${missing.map((k) => DOCUMENT_KINDS[k]).join(', ')}`);
    }

    const [submission] = await tx.insert(kycSubmissions).values({
      id: newId('kyc'), merchantId: merchant.id, level: body.level, status: 'pending', data: body.data,
    }).returning();
    await tx.update(kycDocuments).set({ submissionId: submission!.id }).where(inArray(kycDocuments.id, ids));
    return presentSubmission(submission!);
  });
}

export async function getVerificationStatus(db: Db, merchant: MerchantRow) {
  const [latest] = await db.select().from(kycSubmissions).where(eq(kycSubmissions.merchantId, merchant.id))
    .orderBy(desc(kycSubmissions.submittedAt)).limit(1);
  return {
    account_type: merchant.accountType,
    level: merchant.verificationLevel,
    latest_submission: latest ? presentSubmission(latest) : null,
    requirements: REQUIREMENTS,
    document_kinds: DOCUMENT_KINDS,
  };
}

// =====================================================================
// Revue par l'équipe
// =====================================================================

export async function listSubmissions(db: Db, p: { status: string; limit: number; offset: number }) {
  const where = eq(kycSubmissions.status, p.status);
  const [rows, [count]] = await Promise.all([
    db.select({ s: kycSubmissions, merchantName: merchants.name, accountType: merchants.accountType })
      .from(kycSubmissions).innerJoin(merchants, eq(merchants.id, kycSubmissions.merchantId)).where(where)
      // File d'attente : les plus anciens dossiers d'abord
      .orderBy(p.status === 'pending' ? asc(kycSubmissions.submittedAt) : desc(kycSubmissions.submittedAt))
      .limit(p.limit).offset(p.offset),
    db.select({ total: sql<number>`count(*)::int` }).from(kycSubmissions).where(where),
  ]);
  return {
    submissions: rows.map((r) => ({ ...presentSubmission(r.s), merchant_id: r.s.merchantId, merchant_name: r.merchantName, account_type: r.accountType })),
    total: count?.total ?? 0,
  };
}

export async function getSubmission(db: Db, id: string) {
  const [row] = await db.select({ s: kycSubmissions, m: merchants }).from(kycSubmissions)
    .innerJoin(merchants, eq(merchants.id, kycSubmissions.merchantId)).where(eq(kycSubmissions.id, id));
  if (!row) throw new HttpError(404, 'not_found', 'Dossier introuvable');
  const [docs, users, history] = await Promise.all([
    db.select().from(kycDocuments).where(eq(kycDocuments.submissionId, id)).orderBy(asc(kycDocuments.createdAt)),
    db.select({ email: merchantUsers.email }).from(merchantUsers).where(eq(merchantUsers.merchantId, row.m.id)),
    db.select().from(kycSubmissions).where(eq(kycSubmissions.merchantId, row.m.id)).orderBy(desc(kycSubmissions.submittedAt)),
  ]);
  return {
    ...presentSubmission(row.s),
    data: row.s.data,
    merchant: {
      id: row.m.id, name: row.m.name, account_type: row.m.accountType, verification_level: row.m.verificationLevel,
      status: row.m.status, emails: users.map((u) => u.email), created_at: row.m.createdAt.toISOString(),
    },
    documents: docs.map(presentDocument),
    history: history.filter((h) => h.id !== id).map(presentSubmission),
  };
}

export async function readDocument(ctx: AppContext, id: string) {
  const [doc] = await ctx.db.select().from(kycDocuments).where(eq(kycDocuments.id, id));
  if (!doc) throw new HttpError(404, 'not_found', 'Document introuvable');
  return { doc, data: await ctx.storage.get(doc.storageKey) };
}

interface Reviewer { ctx: AppContext; admin: AdminRow; ip: string; log: FastifyBaseLogger }

export async function reviewSubmission(r: Reviewer, id: string, decision: { approve: true } | { approve: false; reason: string }) {
  const { db, config, mailer } = r.ctx;
  const result = await db.transaction(async (tx) => {
    const [s] = await tx.select().from(kycSubmissions).where(eq(kycSubmissions.id, id)).for('update');
    if (!s) throw new HttpError(404, 'not_found', 'Dossier introuvable');
    if (s.status !== 'pending') throw new HttpError(409, 'already_reviewed', `Dossier déjà traité (${s.status})`);

    const [updated] = await tx.update(kycSubmissions).set({
      status: decision.approve ? 'approved' : 'rejected',
      rejectReason: decision.approve ? null : decision.reason,
      reviewedBy: r.admin.id,
      reviewedAt: new Date(),
    }).where(eq(kycSubmissions.id, id)).returning();

    if (decision.approve) {
      // Un dossier entreprise validé fait passer le compte en professionnel (sans limites)
      await tx.update(merchants).set(s.level === 'business'
        ? { verificationLevel: 'business', accountType: 'business' }
        : { verificationLevel: 'personal' })
        .where(eq(merchants.id, s.merchantId));
    }
    await audit(tx, {
      adminId: r.admin.id, action: decision.approve ? 'kyc.approve' : 'kyc.reject', targetType: 'kyc_submission',
      targetId: id, ip: r.ip, details: { merchant_id: s.merchantId, level: s.level, ...(decision.approve ? {} : { reason: decision.reason }) },
    });
    return updated!;
  });

  const users = await db.select({ email: merchantUsers.email }).from(merchantUsers).where(eq(merchantUsers.merchantId, result.merchantId));
  for (const u of users) {
    sendInBackground(mailer, r.log, decision.approve
      ? mails.kycApproved(u.email, result.level as 'personal' | 'business', `${config.APP_URL}/app`)
      : mails.kycRejected(u.email, decision.reason, `${config.APP_URL}/app/verification`));
  }
  return presentSubmission(result);
}
