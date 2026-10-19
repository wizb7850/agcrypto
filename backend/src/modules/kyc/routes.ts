import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { HttpError } from '../../lib/errors.js';
import { route } from '../../lib/http.js';
import type { Guards } from '../../plugins/guards.js';
import { getLimits } from '../limits/service.js';
import { DOCUMENT_KINDS, type DocumentKind, getVerificationStatus, submissionBody, submitVerification, uploadDocument } from './service.js';

export function registerKycRoutes(app: FastifyInstance, ctx: AppContext, guards: Guards) {
  const { db, config } = ctx;
  const tags = ['Vérification du compte'];

  route(app, {
    method: 'GET', url: '/v1/verification', tags, auth: 'merchant_session',
    summary: 'Niveau de vérification, dernier dossier, documents demandés et limites',
    handler: async ({ req }) => {
      const { merchant } = await guards.merchant(req, { via: 'session' });
      return { ...(await getVerificationStatus(db, merchant)), limits: await getLimits(db, config, merchant) };
    },
  });

  route(app, {
    method: 'POST', url: '/v1/verification/documents', tags, auth: 'merchant_session',
    summary: 'Envoyer un document (JPG, PNG, WEBP ou PDF, 10 Mo max)',
    description: 'Le type de document est passé en paramètre ?kind=. Renvoie l\'identifiant à joindre au dossier.',
    query: z.object({ kind: z.enum(Object.keys(DOCUMENT_KINDS) as [DocumentKind, ...DocumentKind[]]) }),
    multipart: { file: 'file' },
    handler: async ({ req, reply, query }) => {
      const { merchant } = await guards.merchant(req, { via: 'session', requireActive: true });
      if (!req.isMultipart()) throw new HttpError(415, 'multipart_required', 'Envoie le fichier en multipart/form-data (champ « file »)');
      const file = await req.file();
      if (!file) throw new HttpError(400, 'file_required', 'Aucun fichier reçu');
      const data = await file.toBuffer(); // lève une erreur 413 au-delà de la limite
      return reply.status(201).send(await uploadDocument(ctx, merchant.id, query.kind, file.filename, data));
    },
  });

  route(app, {
    method: 'POST', url: '/v1/verification/submissions', tags, auth: 'merchant_session',
    summary: 'Envoyer le dossier de vérification (particulier ou entreprise)',
    description: 'Un seul dossier peut être en cours d\'examen. Un dossier refusé peut être corrigé et renvoyé.',
    body: submissionBody,
    handler: async ({ req, reply, body }) => {
      const { merchant } = await guards.merchant(req, { via: 'session', requireActive: true });
      return reply.status(201).send(await submitVerification(db, merchant, body));
    },
  });
}
