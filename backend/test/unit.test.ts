import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { fromUnits, percentOf, toUnits } from '../src/lib/money.js';
import { mapPaymentStatus, verifyIpnSignature } from '../src/providers/nowpayments.js';
import { invoiceStatusFrom, isForward } from '../src/modules/payments/status.js';

describe('money', () => {
  it('calcule sans erreur d\'arrondi', () => {
    expect(fromUnits(toUnits('0.1') + toUnits('0.2'))).toBe('0.3');
    expect(fromUnits(toUnits(1e-7))).toBe('0.0000001');
    expect(fromUnits(-toUnits('12.50'))).toBe('-12.5');
    expect(fromUnits(percentOf(toUnits('100'), 1))).toBe('1');
    expect(fromUnits(percentOf(toUnits('49.99'), 0.5))).toBe('0.24995');
  });
  it('refuse les montants invalides', () => {
    expect(() => toUnits('abc')).toThrow();
    expect(() => toUnits('1.2.3')).toThrow();
  });
});

describe('signature IPN NOWPayments', () => {
  const secret = 'ipn-secret';
  const body = { payment_status: 'finished', payment_id: 5, fee: { serviceFee: 0, currency: 'btc' } };
  // Implémentation de référence de la doc NOWPayments (tri récursif des clés).
  const sorted = { fee: { currency: 'btc', serviceFee: 0 }, payment_id: 5, payment_status: 'finished' };
  const sig = createHmac('sha512', secret).update(JSON.stringify(sorted)).digest('hex');

  it('accepte une signature valide', () => expect(verifyIpnSignature(body, sig, secret)).toBe(true));
  it('rejette une signature fausse ou absente', () => {
    expect(verifyIpnSignature({ ...body, payment_id: 6 }, sig, secret)).toBe(false);
    expect(verifyIpnSignature(body, undefined, secret)).toBe(false);
    expect(verifyIpnSignature(body, sig, 'autre-secret')).toBe(false);
  });
});

describe('statuts', () => {
  it('mappe les statuts NOWPayments', () => {
    expect(mapPaymentStatus('waiting')).toBe('pending');
    expect(mapPaymentStatus('sending')).toBe('confirming');
    expect(mapPaymentStatus('finished')).toBe('paid');
  });
  it('ne recule jamais', () => {
    expect(isForward('confirming', 'paid')).toBe(true);
    expect(isForward('confirming', 'partially_paid')).toBe(true);
    expect(isForward('paid', 'confirming')).toBe(false);
    expect(isForward('paid', 'paid')).toBe(false);
  });
  it('agrège les paiements d\'une facture', () => {
    expect(invoiceStatusFrom([])).toBe('pending');
    expect(invoiceStatusFrom(['expired', 'pending'])).toBe('pending');
    expect(invoiceStatusFrom(['expired', 'paid'])).toBe('paid');
  });
});

import { withdrawalFee } from '../src/modules/withdrawals/fees.js';

describe('frais de retrait', () => {
  const cfg = { WITHDRAWAL_FEE_PERCENT: 10, WITHDRAWAL_FIXED_FEES: { usdttrc20: '1' } };
  it('pourcentage + fixe', () => {
    const { fee, net } = withdrawalFee(cfg, 'usdttrc20', toUnits('100'));
    expect([fromUnits(fee), fromUnits(net)]).toEqual(['11', '89']);
    expect(fromUnits(withdrawalFee(cfg, 'btc', toUnits('0.01')).fee)).toBe('0.001');
  });
  it('refuse un retrait que les frais dépassent', () => {
    expect(() => withdrawalFee(cfg, 'usdttrc20', toUnits('1'))).toThrow();
  });
});
