import { createHash } from 'node:crypto';
import type { Request, Response } from 'express';
import * as servico from '../services/proofs.service.js';
import { AppError } from '../utils/errors.js';
import { idSchema, provaSchema } from '../validators/schemas.js';

const contextoDe = (req: Request) => {
  if (req.auth === undefined) throw new AppError('UNAUTHENTICATED', 'Precisas de iniciar sessão.');
  return { auth: req.auth, requestId: req.requestId, ip: req.ip ?? null };
};

const autenticado = (req: Request) => {
  if (req.auth === undefined) throw new AppError('UNAUTHENTICATED', 'Precisas de iniciar sessão.');
  return req.auth;
};

export const anexar = async (req: Request, res: Response): Promise<void> => {
  const orderId = idSchema.parse(req.params.id);
  const dados = provaSchema.parse(req.body);

  // Multer put the file here, or nothing did. The message names the field because the
  // most common cause is a client that sent the image under a different name.
  if (req.file === undefined) {
    throw new AppError('VALIDATION_ERROR', 'Falta a imagem. Envia-a no campo "file".');
  }

  const prova = await servico.anexar(contextoDe(req), orderId, {
    kind: dados.kind,
    ficheiro: {
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
      buffer: req.file.buffer,
    },
    ...(dados.latitude !== undefined ? { latitude: dados.latitude } : {}),
    ...(dados.longitude !== undefined ? { longitude: dados.longitude } : {}),
    ...(dados.accuracyMeters !== undefined ? { accuracyMeters: dados.accuracyMeters } : {}),
    ...(dados.capturedAt !== undefined ? { capturedAt: dados.capturedAt } : {}),
  });

  res.status(201).json({ proof: prova });
};

export const listar = async (req: Request, res: Response): Promise<void> => {
  const orderId = idSchema.parse(req.params.id);
  const items = await servico.listar(autenticado(req), orderId);
  res.json({ items });
};

/**
 * Serves one proof's bytes.
 *
 * The headers matter as much as the bytes. `nosniff` stops a browser from second-guessing
 * the type; a locked-down CSP means that even if something got past the magic-byte check
 * and were interpreted as a document, it could load nothing and run nothing; `private`
 * keeps a proxy from caching one company's evidence where another request might find it.
 * `inline` with a generated name is deliberate: the client's filename is never echoed,
 * because a name is a path in disguise and this one would arrive in a download folder.
 */
export const ficheiro = async (req: Request, res: Response): Promise<void> => {
  const orderId = idSchema.parse(req.params.id);
  const proofId = idSchema.parse(req.params.proofId);

  const prova = await servico.ficheiro(autenticado(req), orderId, proofId);

  const etag = `"${prova.sha256}"`;

  // Set before the 304 is even considered, because a browser updates the headers it has
  // stored for an image with the ones that come back from revalidating it. Leave them off
  // here and a cached proof quietly loses the tight policy and inherits the application's,
  // which allows scripts and styles. The headers travel with every answer about the file.
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate');
  res.setHeader('ETag', etag);
  res.setHeader(
    'Content-Disposition',
    `inline; filename="prova-${createHash('sha256').update(proofId).digest('hex').slice(0, 12)}"`,
  );

  // The hash is the strongest validator available and the bytes never change, so a repeat
  // view costs a 304 rather than a megabyte. No type and no length on that answer: there is
  // no body for them to describe.
  if (req.headers['if-none-match'] === etag) {
    res.status(304).end();
    return;
  }

  res.setHeader('Content-Type', prova.mimeType);
  res.setHeader('Content-Length', prova.bytes.length);
  res.end(prova.bytes);
};
