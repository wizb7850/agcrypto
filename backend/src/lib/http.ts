import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { HttpError } from './errors.js';

/**
 * Déclaration d'une route : un seul endroit pour la validation (zod) et la documentation (Swagger).
 * Les données reçues sont validées avant d'arriver au handler, qui les reçoit déjà typées.
 */
type Auth = 'public' | 'api_key' | 'merchant_session' | 'admin_session';
type Out<S> = S extends z.ZodType ? z.output<S> : undefined;

export interface RouteSpec<SB, SQ, SP> {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  url: string;
  tags: string[];
  summary: string;
  description?: string;
  auth: Auth | Auth[];
  body?: SB;
  query?: SQ;
  params?: SP;
  /** Documentation d'un envoi de fichier (multipart/form-data) */
  multipart?: Record<string, 'string' | 'file'>;
  hidden?: boolean;
  handler: (ctx: {
    req: FastifyRequest;
    reply: FastifyReply;
    body: Out<SB>;
    query: Out<SQ>;
    params: Out<SP>;
  }) => Promise<unknown>;
}

const SECURITY: Record<Auth, Record<string, string[]>[]> = {
  public: [],
  api_key: [{ apiKey: [] }],
  merchant_session: [{ merchantSession: [], csrf: [] }],
  admin_session: [{ adminSession: [], csrf: [] }],
};

const toJsonSchema = (s: z.ZodType) =>
  z.toJSONSchema(s, { io: 'input', unrepresentable: 'any', target: 'openapi-3.0' });

export function parse<T extends z.ZodType>(schema: T, data: unknown): z.output<T> {
  const r = schema.safeParse(data);
  if (!r.success) throw new HttpError(400, 'invalid_request', z.prettifyError(r.error));
  return r.data;
}

export function route<
  SB extends z.ZodType | undefined = undefined,
  SQ extends z.ZodType | undefined = undefined,
  SP extends z.ZodType | undefined = undefined,
>(app: FastifyInstance, spec: RouteSpec<SB, SQ, SP>) {
  const auths = Array.isArray(spec.auth) ? spec.auth : [spec.auth];
  app.route({
    method: spec.method,
    url: spec.url,
    schema: {
      tags: spec.tags,
      summary: spec.summary,
      description: spec.description,
      hide: spec.hidden,
      security: auths.flatMap((a) => SECURITY[a]),
      ...(spec.body && { body: toJsonSchema(spec.body) }),
      ...(spec.query && { querystring: toJsonSchema(spec.query) }),
      ...(spec.params && { params: toJsonSchema(spec.params) }),
      ...(spec.multipart && {
        consumes: ['multipart/form-data'],
        body: {
          type: 'object',
          properties: Object.fromEntries(Object.entries(spec.multipart).map(([k, t]) =>
            [k, t === 'file' ? { type: 'string', format: 'binary' } : { type: 'string' }])),
        },
      }),
    },
    handler: async (req, reply) => spec.handler({
      req,
      reply,
      body: (spec.body ? parse(spec.body, req.body ?? {}) : undefined) as Out<SB>,
      query: (spec.query ? parse(spec.query, req.query) : undefined) as Out<SQ>,
      params: (spec.params ? parse(spec.params, req.params) : undefined) as Out<SP>,
    }),
  });
}

/** Pagination standard : ?limit=&offset= */
export const pagination = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
});
