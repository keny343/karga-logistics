import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLogger } from '../src/utils/logger.js';

const logger = createLogger('debug');

const capturar = (canal: 'stdout' | 'stderr') =>
  vi.spyOn(process[canal], 'write').mockImplementation(() => true);

afterEach(() => {
  vi.restoreAllMocks();
});

describe('structured logging', () => {
  it('writes one JSON line per event', () => {
    const escrita = capturar('stdout');
    logger.info('order created', { orderId: 'KRG-000001' });
    const linha = escrita.mock.calls[0]?.[0] as string;
    expect(linha.endsWith('\n')).toBe(true);
    const evento = JSON.parse(linha);
    expect(evento).toMatchObject({ level: 'info', message: 'order created', orderId: 'KRG-000001' });
    expect(evento.time).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('sends errors to stderr so platforms classify them correctly', () => {
    const err = capturar('stderr');
    logger.error('boom');
    expect(err).toHaveBeenCalledOnce();
  });

  it('redacts secrets even when a caller passes them by accident', () => {
    const escrita = capturar('stdout');
    logger.info('login attempt', {
      email: 'op@karga.ao',
      password: 'segredo-real',
      nested: { token: 'abc123', authorization: 'Bearer xyz' },
    });
    const evento = JSON.parse(escrita.mock.calls[0]?.[0] as string);
    expect(evento.password).toBe('[redacted]');
    expect(evento.nested.token).toBe('[redacted]');
    expect(evento.nested.authorization).toBe('[redacted]');
    expect(evento.email).toBe('op@karga.ao');
  });

  it('drops events below the configured level', () => {
    const escrita = capturar('stdout');
    createLogger('warn').info('nao deve aparecer');
    expect(escrita).not.toHaveBeenCalled();
  });
});
