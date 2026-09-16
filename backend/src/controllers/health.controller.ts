import type { Request, Response } from 'express';
import { checkReadiness } from '../services/health.service.js';

const arrancouEm = Date.now();

/** Liveness: the process answers. It deliberately touches no dependency. */
export const getHealth = (_req: Request, res: Response): void => {
  res.json({
    status: 'ok',
    service: 'karga-api',
    uptimeSeconds: Math.round((Date.now() - arrancouEm) / 1000),
  });
};

export const getReady = async (_req: Request, res: Response): Promise<void> => {
  const resultado = await checkReadiness();
  res.status(resultado.ready ? 200 : 503).json(resultado);
};
