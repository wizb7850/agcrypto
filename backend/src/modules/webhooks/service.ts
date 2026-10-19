import { and, eq, inArray, lte } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { Tx } from '../../context.js';
import type { Db } from '../../db/client.js';
import { merchants, webhookDeliveries } from '../../db/schema.js';
import { newId, signWebhook } from '../../lib/security.js';


// Délais entre les tentatives, ensuite la notification passe en "failed".
const RETRY_DELAYS_S = [30, 120, 600, 3600, 6 * 3600, 24 * 3600];

/** À appeler DANS la transaction qui modifie l'état (pattern outbox). */
export async function enqueueEvent(tx: Tx, merchantId: string, type: string, data: unknown) {
  const id = newId('evt');
  await tx.insert(webhookDeliveries).values({
    id,
    merchantId,
    eventType: type,
    payload: { id, type, created_at: new Date().toISOString(), data },
    status: 'pending',
  });
}

export async function deliverDueWebhooks(
  db: Db,
  log: FastifyBaseLogger,
  fetchImpl: typeof fetch = fetch,
  limit = 20,
): Promise<number> {
  // On "réserve" les lignes 60 s : si le worker plante, une autre instance les reprendra.
  const due = await db.transaction(async (tx) => {
    const rows = await tx
      .select({ delivery: webhookDeliveries, url: merchants.webhookUrl, secret: merchants.webhookSecret })
      .from(webhookDeliveries)
      .innerJoin(merchants, eq(merchants.id, webhookDeliveries.merchantId))
      .where(and(eq(webhookDeliveries.status, 'pending'), lte(webhookDeliveries.nextAttemptAt, new Date())))
      .orderBy(webhookDeliveries.nextAttemptAt)
      .limit(limit)
      .for('update', { of: webhookDeliveries, skipLocked: true });
    if (rows.length > 0) {
      await tx
        .update(webhookDeliveries)
        .set({ nextAttemptAt: new Date(Date.now() + 60_000) })
        .where(inArray(webhookDeliveries.id, rows.map((r) => r.delivery.id)));
    }
    return rows;
  });

  for (const { delivery, url, secret } of due) {
    if (!url) {
      await db.update(webhookDeliveries).set({ status: 'failed', lastError: 'Aucune URL de webhook' })
        .where(eq(webhookDeliveries.id, delivery.id));
      continue;
    }
    const body = JSON.stringify(delivery.payload);
    let error: string | null = null;
    try {
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-agcrypto-signature': signWebhook(secret, Math.floor(Date.now() / 1000), body),
        },
        body,
        redirect: 'manual',
        signal: AbortSignal.timeout(10_000),
      });
      if (res.status < 200 || res.status >= 300) error = `HTTP ${res.status}`;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }

    const attempts = delivery.attempts + 1;
    if (!error) {
      await db.update(webhookDeliveries).set({ status: 'delivered', attempts, lastError: null })
        .where(eq(webhookDeliveries.id, delivery.id));
      continue;
    }
    const delay = RETRY_DELAYS_S[attempts - 1];
    log.warn({ deliveryId: delivery.id, attempts, error }, 'échec envoi webhook');
    await db.update(webhookDeliveries).set({
      attempts,
      lastError: error,
      status: delay === undefined ? 'failed' : 'pending',
      nextAttemptAt: new Date(Date.now() + (delay ?? 0) * 1000),
    }).where(eq(webhookDeliveries.id, delivery.id));
  }
  return due.length;
}
