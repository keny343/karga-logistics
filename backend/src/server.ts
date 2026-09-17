import { createApp } from './app.js';
import { closePool } from './config/database.js';
import { env } from './config/env.js';
import { criarTempoReal } from './realtime/index.js';
import { logger } from './utils/logger.js';

const app = createApp();

const server = app.listen(env.PORT, '0.0.0.0', () => {
  logger.info('karga api listening', {
    port: env.PORT,
    env: env.NODE_ENV,
    corsOrigins: env.corsOrigins,
  });
});

const io = criarTempoReal(server);

/**
 * Deploys and container restarts send SIGTERM. Finishing in-flight requests
 * before closing the pool avoids handing a client an error for work that was
 * already done.
 */
const encerrar = (sinal: string): void => {
  logger.info('shutting down', { signal: sinal });
  // Sockets are closed first and deliberately: browsers reconnect, and one left
  // open would hold the server past the drain window for nothing.
  void io.close();
  server.close(async () => {
    await closePool();
    process.exit(0);
  });
  setTimeout(() => {
    logger.warn('forced shutdown: connections did not drain in time');
    process.exit(1);
  }, 10_000).unref();
};

process.on('SIGTERM', () => encerrar('SIGTERM'));
process.on('SIGINT', () => encerrar('SIGINT'));

process.on('unhandledRejection', (motivo) => {
  logger.error('unhandled rejection', {
    message: motivo instanceof Error ? motivo.message : String(motivo),
    stack: motivo instanceof Error ? motivo.stack : undefined,
  });
});
