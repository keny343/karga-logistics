import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { logger } from '../utils/logger.js';

/** Only accept an inbound id that is safe to echo into a header and a log line. */
const ID_ACEITAVEL = /^[A-Za-z0-9._-]{8,64}$/;

export const requestContext = (req: Request, res: Response, next: NextFunction): void => {
  const recebido = req.header('x-request-id');
  req.requestId = recebido !== undefined && ID_ACEITAVEL.test(recebido) ? recebido : randomUUID();
  res.setHeader('X-Request-Id', req.requestId);

  const inicio = process.hrtime.bigint();
  res.on('finish', () => {
    const duracaoMs = Number(process.hrtime.bigint() - inicio) / 1_000_000;
    logger.info('request', {
      requestId: req.requestId,
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      durationMs: Math.round(duracaoMs * 100) / 100,
    });
  });

  next();
};
