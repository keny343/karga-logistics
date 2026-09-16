import { query } from '../config/database.js';
import type { Role } from '../types/domain.js';

export interface UtilizadorComEmpresa {
  id: string;
  company_id: string;
  company_name: string;
  name: string;
  email: string;
  role: Role;
  password_hash: string;
  is_active: boolean;
}

/**
 * Email is unique per company, not globally, so this can legitimately return more
 * than one row. Login resolves the ambiguity rather than picking one at random.
 */
export const encontrarPorEmail = async (email: string): Promise<UtilizadorComEmpresa[]> => {
  const { rows } = await query<UtilizadorComEmpresa>(
    `SELECT u.id, u.company_id, c.name AS company_name, u.name, u.email, u.role,
            u.password_hash, u.is_active
       FROM users u
       JOIN companies c ON c.id = u.company_id
      WHERE lower(u.email) = lower($1)
        AND u.is_active
        AND c.is_active`,
    [email],
  );
  return rows;
};

export const encontrarPorEmailEEmpresa = async (
  email: string,
  companySlug: string,
): Promise<UtilizadorComEmpresa | null> => {
  const { rows } = await query<UtilizadorComEmpresa>(
    `SELECT u.id, u.company_id, c.name AS company_name, u.name, u.email, u.role,
            u.password_hash, u.is_active
       FROM users u
       JOIN companies c ON c.id = u.company_id
      WHERE lower(u.email) = lower($1)
        AND c.slug = $2
        AND u.is_active
        AND c.is_active`,
    [email, companySlug],
  );
  return rows[0] ?? null;
};

export const registarUltimoLogin = async (userId: string): Promise<void> => {
  await query('UPDATE users SET last_login_at = now() WHERE id = $1', [userId]);
};

// ------------------------------------------------------------------ sessions

export interface SessaoActiva {
  session_id: string;
  user_id: string;
  company_id: string;
  company_name: string;
  name: string;
  email: string;
  role: Role;
  last_seen_at: Date;
}

export const criarSessao = async (dados: {
  userId: string;
  companyId: string;
  tokenHash: string;
  ip: string | null;
  userAgent: string | null;
  expiresAt: Date;
}): Promise<string> => {
  const { rows } = await query<{ id: string }>(
    `INSERT INTO sessions (user_id, company_id, token_hash, ip, user_agent, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [dados.userId, dados.companyId, dados.tokenHash, dados.ip, dados.userAgent, dados.expiresAt],
  );
  const linha = rows[0];
  if (linha === undefined) throw new Error('sessão não foi criada');
  return linha.id;
};

export const sessaoPorHash = async (tokenHash: string): Promise<SessaoActiva | null> => {
  const { rows } = await query<SessaoActiva>(
    `SELECT s.id AS session_id, u.id AS user_id, u.company_id, c.name AS company_name,
            u.name, u.email, u.role, s.last_seen_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       JOIN companies c ON c.id = u.company_id
      WHERE s.token_hash = $1
        AND s.revoked_at IS NULL
        AND s.expires_at > now()
        AND u.is_active
        AND c.is_active`,
    [tokenHash],
  );
  return rows[0] ?? null;
};

/** Called at most once every few minutes: a write per request buys nothing. */
export const tocarSessao = async (sessionId: string): Promise<void> => {
  await query('UPDATE sessions SET last_seen_at = now() WHERE id = $1', [sessionId]);
};

export const revogarSessao = async (tokenHash: string): Promise<void> => {
  await query(
    'UPDATE sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL',
    [tokenHash],
  );
};

// ------------------------------------------------------------ login attempts

export const registarTentativa = async (dados: {
  email: string;
  ip: string | null;
  succeeded: boolean;
}): Promise<void> => {
  await query('INSERT INTO login_attempts (email, ip, succeeded) VALUES ($1, $2, $3)', [
    dados.email,
    dados.ip,
    dados.succeeded,
  ]);
};

/**
 * Counts recent failures for this account and for this address. Both matter: one
 * stops an attack on a known email, the other stops a sweep across many.
 */
export const falhasRecentes = async (
  email: string,
  ip: string | null,
  janelaMinutos: number,
): Promise<{ porEmail: number; porIp: number }> => {
  const { rows } = await query<{ por_email: string; por_ip: string }>(
    `SELECT
       count(*) FILTER (WHERE lower(email) = lower($1)) AS por_email,
       count(*) FILTER (WHERE $2::inet IS NOT NULL AND ip = $2::inet) AS por_ip
     FROM login_attempts
     WHERE succeeded = false
       AND created_at > now() - ($3 || ' minutes')::interval`,
    [email, ip, String(janelaMinutos)],
  );
  const linha = rows[0];
  return {
    porEmail: Number(linha?.por_email ?? 0),
    porIp: Number(linha?.por_ip ?? 0),
  };
};

export const limparTentativas = async (email: string): Promise<void> => {
  await query('DELETE FROM login_attempts WHERE lower(email) = lower($1)', [email]);
};
