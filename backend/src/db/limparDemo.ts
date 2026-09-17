import { closePool, transaction } from '../config/database.js';
import { logger } from '../utils/logger.js';

/**
 * Removes the demonstration carrier and everything hanging off it, so the seed can be run
 * again after it changes.
 *
 * Scoped to the one company the seed creates, by slug: a database with real data in it has
 * no such row and this deletes nothing. The order is children first and by company_id
 * rather than a cascade, because `users` is deliberately RESTRICT - the schema does not let
 * a company with accounts in it disappear by accident, and this is not an accident.
 */
const TABELAS = [
  'driver_positions',
  'delivery_proofs',
  'order_status_history',
  'orders',
  'drivers',
  'customers',
  'sessions',
  'audit_logs',
  'users',
] as const;

const limpar = async (): Promise<void> => {
  await transaction(async (client) => {
    const { rows } = await client.query<{ id: string }>(
      'SELECT id FROM companies WHERE slug = $1',
      ['karga-luanda'],
    );
    const companyId = rows[0]?.id;
    if (companyId === undefined) {
      logger.info('demo data absent, nothing to remove');
      return;
    }

    for (const tabela of TABELAS) {
      await client.query(`DELETE FROM ${tabela} WHERE company_id = $1`, [companyId]);
    }
    await client.query('DELETE FROM companies WHERE id = $1', [companyId]);

    logger.info('demo data removed', { companyId });
  });
};

limpar()
  .then(() => closePool())
  .then(() => process.exit(0))
  .catch((erro: unknown) => {
    logger.error('demo cleanup failed', {
      message: erro instanceof Error ? erro.message : String(erro),
    });
    process.exit(1);
  });
