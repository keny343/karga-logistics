import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { env } from '../config/env.js';
import * as repo from '../repositories/auth.repository.js';
import { registarAuditoria } from './audit.service.js';
import { AppError } from '../utils/errors.js';
import type { Autenticado, Role } from '../types/domain.js';

export const COOKIE_SESSAO = 'karga_session';

const DIAS_DE_SESSAO = 7;
const JANELA_MINUTOS = 15;
const FALHAS_POR_CONTA = 5;
const FALHAS_POR_IP = 20;
/** Refresh last_seen at most this often, to avoid a write on every request. */
const INTERVALO_TOQUE_MS = 5 * 60 * 1000;

export const hashDeToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

/**
 * bcrypt at cost 12: slow enough that an offline attack on a stolen hash is
 * expensive, fast enough that a login is not noticeable.
 *
 * The suite drops to the minimum cost. It hashes dozens of passwords per file and
 * at cost 12 that is a minute of waiting to prove nothing about the cost factor
 * itself - what the tests check is the logic around the hash.
 */
const CUSTO_BCRYPT = env.isTest ? 4 : 12;

export const hashDePassword = (password: string): Promise<string> =>
  bcrypt.hash(password, CUSTO_BCRYPT);

export interface SessaoCriada {
  readonly token: string;
  readonly expiresAt: Date;
  readonly user: {
    id: string;
    name: string;
    email: string;
    role: Role;
    companyId: string;
    companyName: string;
  };
}

interface DadosLogin {
  readonly email: string;
  readonly password: string;
  readonly companySlug?: string;
  readonly ip: string | null;
  readonly userAgent: string | null;
  readonly requestId: string;
}

/**
 * Wrong password and unknown account answer identically. Telling them apart
 * hands an attacker a list of valid emails, and the honest message ("email ou
 * palavra-passe incorrectos") is no less useful to the person who typed it.
 */
const credenciaisInvalidas = (): AppError =>
  new AppError('UNAUTHENTICATED', 'Email ou palavra-passe incorrectos.');

export const iniciarSessao = async (dados: DadosLogin): Promise<SessaoCriada> => {
  const falhas = await repo.falhasRecentes(dados.email, dados.ip, JANELA_MINUTOS);
  if (falhas.porEmail >= FALHAS_POR_CONTA || falhas.porIp >= FALHAS_POR_IP) {
    throw new AppError(
      'RATE_LIMITED',
      `Demasiadas tentativas falhadas. Espera ${JANELA_MINUTOS} minutos antes de tentar de novo.`,
    );
  }

  const candidatos =
    dados.companySlug !== undefined
      ? [await repo.encontrarPorEmailEEmpresa(dados.email, dados.companySlug)].filter(
          (u): u is repo.UtilizadorComEmpresa => u !== null,
        )
      : await repo.encontrarPorEmail(dados.email);

  // The same person may work for two carriers. Choosing one silently would log
  // them into the wrong company's data.
  if (candidatos.length > 1) {
    throw new AppError('CONFLICT', 'Este email existe em mais do que uma empresa. Indica a empresa.');
  }

  const utilizador = candidatos[0];

  // Hash a throwaway value when the account does not exist, so a missing account
  // does not answer measurably faster than a wrong password.
  if (utilizador === undefined) {
    await bcrypt.compare(dados.password, '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinva');
    await repo.registarTentativa({ email: dados.email, ip: dados.ip, succeeded: false });
    throw credenciaisInvalidas();
  }

  const correcta = await bcrypt.compare(dados.password, utilizador.password_hash);
  if (!correcta) {
    await repo.registarTentativa({ email: dados.email, ip: dados.ip, succeeded: false });
    await registarAuditoria({
      companyId: utilizador.company_id,
      actorId: utilizador.id,
      actorLabel: utilizador.email,
      action: 'LOGIN_FAILED',
      ip: dados.ip,
      requestId: dados.requestId,
    });
    throw credenciaisInvalidas();
  }

  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + DIAS_DE_SESSAO * 24 * 60 * 60 * 1000);

  await repo.criarSessao({
    userId: utilizador.id,
    companyId: utilizador.company_id,
    tokenHash: hashDeToken(token),
    ip: dados.ip,
    userAgent: dados.userAgent,
    expiresAt,
  });

  await repo.registarTentativa({ email: dados.email, ip: dados.ip, succeeded: true });
  await repo.limparTentativas(dados.email);
  await repo.registarUltimoLogin(utilizador.id);
  await registarAuditoria({
    companyId: utilizador.company_id,
    actorId: utilizador.id,
    actorLabel: utilizador.email,
    action: 'LOGIN',
    ip: dados.ip,
    requestId: dados.requestId,
  });

  return {
    token,
    expiresAt,
    user: {
      id: utilizador.id,
      name: utilizador.name,
      email: utilizador.email,
      role: utilizador.role,
      companyId: utilizador.company_id,
      companyName: utilizador.company_name,
    },
  };
};

export const resolverSessao = async (token: string | undefined): Promise<Autenticado | null> => {
  if (token === undefined || token.length < 20) return null;

  const sessao = await repo.sessaoPorHash(hashDeToken(token));
  if (sessao === null) return null;

  if (Date.now() - sessao.last_seen_at.getTime() > INTERVALO_TOQUE_MS) {
    await repo.tocarSessao(sessao.session_id);
  }

  return {
    sessionId: sessao.session_id,
    userId: sessao.user_id,
    companyId: sessao.company_id,
    companyName: sessao.company_name,
    name: sessao.name,
    email: sessao.email,
    role: sessao.role,
  };
};

export const terminarSessao = async (token: string | undefined): Promise<void> => {
  if (token === undefined) return;
  await repo.revogarSessao(hashDeToken(token));
};

/**
 * Constant-time comparison for values that are secrets. Not used on the session
 * path (the token is looked up by hash) but kept for the phases that compare
 * client-supplied keys.
 */
export const iguaisEmTempoConstante = (a: string, b: string): boolean => {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
};
