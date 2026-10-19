import type { MailMessage } from './mailer.js';

// Modèles d'e-mails transactionnels. Texte brut + HTML simple (compatible avec tous les clients mail).

const escape = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function layout(title: string, paragraphs: string[], action?: { label: string; url: string }) {
  const body = paragraphs.map((p) => `<p style="margin:0 0 16px">${escape(p)}</p>`).join('');
  const button = action
    ? `<p style="margin:24px 0"><a href="${escape(action.url)}" style="background:#4f46e5;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">${escape(action.label)}</a></p>`
    : '';
  return `<!doctype html><html><body style="margin:0;background:#f4f5f7;font-family:system-ui,sans-serif;color:#111827">
<div style="max-width:520px;margin:0 auto;padding:32px 16px"><div style="background:#fff;border-radius:12px;padding:32px">
<p style="font-weight:800;font-size:18px;margin:0 0 24px">agcrypto</p><h1 style="font-size:20px;margin:0 0 16px">${escape(title)}</h1>
${body}${button}</div><p style="color:#6b7280;font-size:12px;text-align:center">Cet e-mail a été envoyé automatiquement, merci de ne pas y répondre.</p></div></body></html>`;
}

const message = (to: string, subject: string, paragraphs: string[], action?: { label: string; url: string }): MailMessage => ({
  to,
  subject,
  text: [...paragraphs, ...(action ? [`${action.label} : ${action.url}`] : [])].join('\n\n'),
  html: layout(subject, paragraphs, action),
});

export const emailVerification = (to: string, code: string) => message(to, 'Ton code de vérification', [
  `Voici ton code de vérification : ${code}`,
  'Il est valable 30 minutes. Si tu n\'as pas créé de compte agcrypto, ignore cet e-mail.',
]);

export const passwordReset = (to: string, url: string) => message(to, 'Réinitialisation du mot de passe', [
  'Tu as demandé à réinitialiser ton mot de passe. Le lien ci-dessous est valable 1 heure.',
  'Si tu n\'es pas à l\'origine de cette demande, ignore cet e-mail : ton mot de passe ne change pas.',
], { label: 'Choisir un nouveau mot de passe', url });

export const passwordChanged = (to: string) => message(to, 'Ton mot de passe a été modifié', [
  'Le mot de passe de ton compte agcrypto vient d\'être modifié et toutes tes sessions ont été déconnectées.',
  'Si tu n\'es pas à l\'origine de ce changement, contacte immédiatement le support.',
]);

export const kycApproved = (to: string, level: 'personal' | 'business', url: string) => message(to, 'Ton compte est vérifié', [
  level === 'business'
    ? 'Ta vérification entreprise a été validée. Ton compte professionnel n\'a plus de limite d\'encaissement ni de retrait.'
    : 'Ta vérification d\'identité a été validée. Tu peux maintenant retirer tes fonds, dans les limites du compte personnel.',
], { label: 'Accéder au tableau de bord', url });

export const kycRejected = (to: string, reason: string, url: string) => message(to, 'Ta vérification doit être corrigée', [
  'Ton dossier de vérification n\'a pas pu être validé pour la raison suivante :',
  reason,
  'Tu peux corriger les informations et renvoyer ton dossier depuis ton tableau de bord.',
], { label: 'Corriger mon dossier', url });

export const withdrawalProcessed = (
  to: string,
  w: { status: string; netAmount: string; currency: string; txHash: string | null; rejectReason: string | null },
  url: string,
) => w.status === 'completed'
  ? message(to, 'Ton retrait a été envoyé', [
    `${w.netAmount} ${w.currency.toUpperCase()} ont été envoyés à ton adresse.`,
    `Transaction : ${w.txHash}`,
  ], { label: 'Voir mes retraits', url })
  : message(to, 'Ton retrait a été refusé', [
    `Ta demande de retrait a été refusée : ${w.rejectReason}`,
    'Le montant a été recrédité sur ton solde.',
  ], { label: 'Voir mes retraits', url });

export const merchantSuspended = (to: string, reason: string) => message(to, 'Ton compte a été suspendu', [
  'Ton compte agcrypto a été suspendu pour la raison suivante :',
  reason,
  'Contacte le support pour plus d\'informations.',
]);
