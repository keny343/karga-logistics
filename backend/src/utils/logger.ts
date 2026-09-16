import { env } from '../config/env.js';

export type Level = 'debug' | 'info' | 'warn' | 'error';

/** `silent` exists for the test suite, where expected errors are not news. */
export type Threshold = Level | 'silent';

const ORDEM: Record<Threshold, number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

/**
 * Keys whose values never reach the log, whatever the caller passes. Logging a
 * password once is enough to leak it, and log files travel further than code.
 */
const SEGREDOS = /^(password|senha|token|authorization|cookie|secret|apiKey|api_key)$/i;

const limpar = (valor: unknown, profundidade = 0): unknown => {
  if (profundidade > 4 || valor === null || typeof valor !== 'object') return valor;
  if (Array.isArray(valor)) return valor.map((item) => limpar(item, profundidade + 1));
  const saida: Record<string, unknown> = {};
  for (const [chave, item] of Object.entries(valor as Record<string, unknown>)) {
    saida[chave] = SEGREDOS.test(chave) ? '[redacted]' : limpar(item, profundidade + 1);
  }
  return saida;
};

export interface Logger {
  debug: (message: string, contexto?: Record<string, unknown>) => void;
  info: (message: string, contexto?: Record<string, unknown>) => void;
  warn: (message: string, contexto?: Record<string, unknown>) => void;
  error: (message: string, contexto?: Record<string, unknown>) => void;
}

/**
 * The level is a parameter rather than a global read so that tests can exercise
 * the formatting and redaction without turning logging on for the whole suite.
 */
export const createLogger = (minimo: Threshold): Logger => {
  const escrever = (level: Level, message: string, contexto: Record<string, unknown> = {}): void => {
    if (ORDEM[level] < ORDEM[minimo]) return;
    const linha = JSON.stringify({
      level,
      time: new Date().toISOString(),
      message,
      ...(limpar(contexto) as Record<string, unknown>),
    });
    // Warnings and errors go to stderr: hosting platforms classify streams, not
    // payloads, when they decide what counts as an incident.
    if (level === 'error' || level === 'warn') process.stderr.write(`${linha}\n`);
    else process.stdout.write(`${linha}\n`);
  };

  return {
    debug: (message, contexto) => escrever('debug', message, contexto),
    info: (message, contexto) => escrever('info', message, contexto),
    warn: (message, contexto) => escrever('warn', message, contexto),
    error: (message, contexto) => escrever('error', message, contexto),
  };
};

export const logger = createLogger(env.LOG_LEVEL);
