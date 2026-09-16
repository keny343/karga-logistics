import type { CookieOptions, Request, Response } from 'express';
import { z } from 'zod';
import { env } from '../config/env.js';
import { lerSessao } from '../middleware/authenticate.js';
import { COOKIE_SESSAO, iniciarSessao, terminarSessao } from '../services/auth.service.js';
import { registarAuditoria } from '../services/audit.service.js';

const esquemaLogin = z.object({
  email: z.string().trim().min(3).max(200).email('Email inválido.'),
  password: z.string().min(1, 'A palavra-passe é obrigatória.').max(200),
  companySlug: z.string().trim().min(2).max(60).optional(),
});

/**
 * httpOnly so no script can read it, SameSite=Lax so a cross-site form cannot
 * replay it while ordinary navigation still works, Secure everywhere but local
 * development, where there is no HTTPS to attach it to.
 */
const opcoesCookie = (expiresAt: Date): CookieOptions => ({
  httpOnly: true,
  sameSite: 'lax',
  secure: env.isProduction,
  path: '/',
  expires: expiresAt,
});

const clienteIp = (req: Request): string | null => req.ip ?? null;

export const login = async (req: Request, res: Response): Promise<void> => {
  const dados = esquemaLogin.parse(req.body);

  const sessao = await iniciarSessao({
    email: dados.email,
    password: dados.password,
    ...(dados.companySlug !== undefined ? { companySlug: dados.companySlug } : {}),
    ip: clienteIp(req),
    userAgent: req.header('user-agent') ?? null,
    requestId: req.requestId,
  });

  res.cookie(COOKIE_SESSAO, sessao.token, opcoesCookie(sessao.expiresAt));
  res.json({ user: sessao.user });
};

export const logout = async (req: Request, res: Response): Promise<void> => {
  const cookies = (req as Request & { cookies?: Record<string, string> }).cookies;
  const token = cookies?.[COOKIE_SESSAO];

  const sessao = await lerSessao(req);
  await terminarSessao(token);

  if (sessao !== null) {
    await registarAuditoria({
      companyId: sessao.companyId,
      actorId: sessao.userId,
      actorLabel: sessao.email,
      action: 'LOGOUT',
      ip: clienteIp(req),
      requestId: req.requestId,
    });
  }

  res.clearCookie(COOKIE_SESSAO, { path: '/' });
  res.json({ ok: true });
};

/**
 * Answers 200 with a null user when nobody is signed in. A 401 here would be
 * correct HTTP and a bad idea: the browser logs it as a failed request on every
 * anonymous page load, and real faults get lost among them.
 */
export const me = async (req: Request, res: Response): Promise<void> => {
  const sessao = await lerSessao(req);
  if (sessao === null) {
    res.json({ user: null });
    return;
  }
  res.json({
    user: {
      id: sessao.userId,
      name: sessao.name,
      email: sessao.email,
      role: sessao.role,
      companyId: sessao.companyId,
      companyName: sessao.companyName,
    },
  });
};
