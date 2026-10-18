import type { PaymentStatus } from '../providers/nowpayments.js';

// Les IPN peuvent arriver en double ou dans le désordre : un paiement ne
// fait qu'avancer, jamais reculer (ex. "confirming" reçu après "paid" est ignoré).
const RANK: Record<PaymentStatus, number> = {
  pending: 0, confirming: 1, partially_paid: 2, failed: 3, expired: 3, paid: 4, refunded: 5,
};

export const isForward = (from: PaymentStatus, to: PaymentStatus) => RANK[to] > RANK[from];

// Une facture peut avoir plusieurs paiements (le client change de crypto, par exemple).
// Son statut est celui du paiement le plus significatif.
const INVOICE_PRIORITY: PaymentStatus[] = [
  'paid', 'refunded', 'confirming', 'partially_paid', 'pending', 'failed', 'expired',
];

export function invoiceStatusFrom(paymentStatuses: PaymentStatus[]): PaymentStatus {
  return INVOICE_PRIORITY.find((s) => paymentStatuses.includes(s)) ?? 'pending';
}
