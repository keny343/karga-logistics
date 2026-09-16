import pg from 'pg';
import { env } from './env.js';
import { logger } from '../utils/logger.js';

/**
 * Money arrives as integer minor units (cêntimos) and weight as integer grams,
 * so nothing in this schema needs pg's numeric-to-string dance. Timestamps stay
 * as Date objects; the driver already returns them in UTC.
 */
export const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  ...(env.DATABASE_SSL ? { ssl: { rejectUnauthorized: false } } : {}),
  max: env.isTest ? 4 : 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  application_name: 'karga-api',
});

pool.on('error', (erro) => {
  // An idle client dying is not a request failure, but it must not be silent.
  logger.error('idle postgres client failed', { message: erro.message });
});

export interface QueryResult<T> {
  rows: T[];
  rowCount: number;
}

export const query = async <T extends pg.QueryResultRow>(
  sql: string,
  params: readonly unknown[] = [],
): Promise<QueryResult<T>> => {
  const resultado = await pool.query<T>(sql, params as unknown[]);
  return { rows: resultado.rows, rowCount: resultado.rowCount ?? 0 };
};

/**
 * Runs a unit of work inside a transaction. Callers get a client and must use it
 * for every statement in the unit, otherwise the work escapes the transaction.
 */
export const transaction = async <T>(
  trabalho: (client: pg.PoolClient) => Promise<T>,
): Promise<T> => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const resultado = await trabalho(client);
    await client.query('COMMIT');
    return resultado;
  } catch (erro) {
    await client.query('ROLLBACK');
    throw erro;
  } finally {
    client.release();
  }
};

export const closePool = async (): Promise<void> => {
  await pool.end();
};
