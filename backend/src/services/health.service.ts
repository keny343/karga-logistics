import { query } from '../config/database.js';

export interface Readiness {
  ready: boolean;
  checks: {
    database: { ok: boolean; latencyMs?: number; error?: string };
  };
}

/**
 * Readiness answers one question: can this instance serve a request right now.
 * The database check is bounded, because a probe that hangs is worse than a
 * probe that fails - the orchestrator would keep sending traffic while waiting.
 */
export const checkReadiness = async (timeoutMs = 2_000): Promise<Readiness> => {
  const inicio = Date.now();
  try {
    await Promise.race([
      query('SELECT 1'),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`database check exceeded ${timeoutMs}ms`)), timeoutMs),
      ),
    ]);
    return { ready: true, checks: { database: { ok: true, latencyMs: Date.now() - inicio } } };
  } catch (erro) {
    return {
      ready: false,
      checks: {
        database: { ok: false, error: erro instanceof Error ? erro.message : 'unknown error' },
      },
    };
  }
};
