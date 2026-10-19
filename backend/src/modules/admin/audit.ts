import { desc, eq, sql } from 'drizzle-orm';
import type { Tx } from '../../context.js';
import type { Db } from '../../db/client.js';
import { adminAuditLog, adminUsers } from '../../db/schema.js';

export interface AuditEntry {
  adminId: string;
  action: string; // ex. kyc.approve, withdrawal.complete, merchant.suspend, team.create
  targetType: string;
  targetId: string;
  details?: Record<string, unknown>;
  ip?: string;
}

/** Trace une action de l'équipe. À appeler dans la même transaction que l'action elle-même. */
export async function audit(tx: Db | Tx, e: AuditEntry) {
  await tx.insert(adminAuditLog).values({
    adminId: e.adminId, action: e.action, targetType: e.targetType, targetId: e.targetId,
    details: e.details ?? null, ip: e.ip ?? null,
  });
}

export async function listAudit(db: Db, p: { limit: number; offset: number }) {
  const [rows, [count]] = await Promise.all([
    db.select({ log: adminAuditLog, adminEmail: adminUsers.email }).from(adminAuditLog)
      .leftJoin(adminUsers, eq(adminUsers.id, adminAuditLog.adminId))
      .orderBy(desc(adminAuditLog.createdAt), desc(adminAuditLog.id)).limit(p.limit).offset(p.offset),
    db.select({ total: sql<number>`count(*)::int` }).from(adminAuditLog),
  ]);
  return {
    entries: rows.map(({ log, adminEmail }) => ({
      id: String(log.id), admin_email: adminEmail, action: log.action, target_type: log.targetType,
      target_id: log.targetId, details: log.details, ip: log.ip, created_at: log.createdAt.toISOString(),
    })),
    total: count?.total ?? 0,
  };
}
