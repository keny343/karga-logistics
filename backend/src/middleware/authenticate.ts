import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { COOKIE_SESSAO, resolverSessao } from '../services/auth.service.js';
import { AppError } from '../utils/errors.js';
import type { Autenticado, Role } from '../types/domain.js';

/**
 * The authorization chain, in order: authentication, then role, then company,
 * then ownership of the resource. Each layer is a separate step so a new endpoint
 * cannot accidentally get half of it.
 */

export const lerSessao = async (req: Request): Promise<Autenticado | null> => {
  const cookies = (req as Request & { cookies?: Record<string, string> }).cookies;
  return resolverSessao(cookies?.[COOKIE_SESSAO]);
};

/** Rejects anonymous callers. Everything past this point has req.auth. */
export const requerAutenticacao: RequestHandler = (req, _res, next) => {
  void lerSessao(req)
    .then((sessao) => {
      if (sessao === null) {
        next(new AppError('UNAUTHENTICATED', 'Precisas de iniciar sessão.'));
        return;
      }
      req.auth = sessao;
      next();
    })
    .catch(next);
};

export const requerPapel =
  (...permitidos: readonly Role[]): RequestHandler =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (req.auth === undefined) {
      next(new AppError('UNAUTHENTICATED', 'Precisas de iniciar sessão.'));
      return;
    }
    if (!permitidos.includes(req.auth.role)) {
      next(new AppError('FORBIDDEN', 'O teu perfil não permite esta ação.'));
      return;
    }
    next();
  };

/**
 * The company always comes from the session. This helper exists so no controller
 * is tempted to read it from a body or a query string, which would let a caller
 * name someone else's tenant.
 */
export const empresaDe = (req: Request): string => {
  if (req.auth === undefined) throw new AppError('UNAUTHENTICATED', 'Precisas de iniciar sessão.');
  return req.auth.companyId;
};
