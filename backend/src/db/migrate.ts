import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { closePool, pool, transaction } from '../config/database.js';
import { logger } from '../utils/logger.js';

const pastaMigracoes = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../migrations');

interface Aplicada {
  name: string;
  checksum: string;
}

const assegurarTabela = async (): Promise<void> => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name        text PRIMARY KEY,
      checksum    text NOT NULL,
      applied_at  timestamptz NOT NULL DEFAULT now()
    )
  `);
};

const somaDe = (conteudo: string): string =>
  createHash('sha256').update(conteudo.replace(/\r\n/g, '\n')).digest('hex').slice(0, 16);

/**
 * Each file runs once, inside a transaction, and its checksum is stored. Editing
 * an applied migration is refused rather than silently ignored: the file and the
 * database would disagree, and the difference would only surface in production.
 */
export const migrate = async (): Promise<{ aplicadas: string[] }> => {
  await assegurarTabela();

  const { rows } = await pool.query<Aplicada>('SELECT name, checksum FROM schema_migrations');
  const jaAplicadas = new Map(rows.map((linha) => [linha.name, linha.checksum]));

  const ficheiros = (await readdir(pastaMigracoes)).filter((f) => f.endsWith('.sql')).sort();
  const aplicadas: string[] = [];

  for (const ficheiro of ficheiros) {
    const sql = await readFile(path.join(pastaMigracoes, ficheiro), 'utf8');
    const checksum = somaDe(sql);
    const anterior = jaAplicadas.get(ficheiro);

    if (anterior !== undefined) {
      if (anterior !== checksum) {
        throw new Error(
          `A migração ${ficheiro} mudou depois de aplicada (${anterior} -> ${checksum}). ` +
            'Cria uma migração nova em vez de editar esta.',
        );
      }
      continue;
    }

    await transaction(async (client) => {
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', [
        ficheiro,
        checksum,
      ]);
    });

    aplicadas.push(ficheiro);
    logger.info('migration applied', { migration: ficheiro });
  }

  return { aplicadas };
};

const executadoDirectamente = process.argv[1] !== undefined
  && path.resolve(process.argv[1]).startsWith(path.resolve(path.dirname(fileURLToPath(import.meta.url))));

if (executadoDirectamente) {
  try {
    const { aplicadas } = await migrate();
    logger.info(aplicadas.length > 0 ? 'migrations up to date' : 'nothing to migrate', {
      count: aplicadas.length,
    });
  } catch (erro) {
    logger.error('migration failed', { message: erro instanceof Error ? erro.message : String(erro) });
    process.exitCode = 1;
  } finally {
    await closePool();
  }
}
