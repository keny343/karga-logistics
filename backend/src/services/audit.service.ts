import { query } from '../config/database.js';
import { logger } from '../utils/logger.js';

export interface EntradaAuditoria {
  readonly companyId: string | null;
  readonly actorId: string | null;
  /** Copied in as text so the record survives the account being deleted. */
  readonly actorLabel: string;
  readonly action: string;
  readonly resourceType?: string;
  readonly resourceId?: string;
  readonly metadata?: Record<string, unknown>;
  readonly ip?: string | null;
  readonly requestId?: string;
}

/**
 * Auditing must never be the reason a request fails: if the write breaks, the
 * action the user asked for has already succeeded, and refusing it afterwards
 * would be worse than a missing row. The failure is logged loudly instead.
 *
 * Nothing here may carry a password, a token or a session id - metadata is
 * written by callers who pass ids and names, not credentials.
 */
export const registarAuditoria = async (entrada: EntradaAuditoria): Promise<void> => {
  try {
    await query(
      `INSERT INTO audit_logs
         (company_id, actor_id, actor_label, action, resource_type, resource_id, metadata, ip, request_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        entrada.companyId,
        entrada.actorId,
        entrada.actorLabel,
        entrada.action,
        entrada.resourceType ?? null,
        entrada.resourceId ?? null,
        JSON.stringify(entrada.metadata ?? {}),
        entrada.ip ?? null,
        entrada.requestId ?? null,
      ],
    );
  } catch (erro) {
    logger.error('audit write failed', {
      action: entrada.action,
      resourceId: entrada.resourceId,
      message: erro instanceof Error ? erro.message : String(erro),
    });
  }
};
