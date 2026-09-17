import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import { env } from '../config/env.js';
import { query } from '../config/database.js';
import { dentroDeAngola, pareceTrocado } from '../domain/geografia.js';
import * as posicoes from '../repositories/positions.repository.js';
import { ambitoDe } from '../services/ambito.service.js';
import { COOKIE_SESSAO, resolverSessao } from '../services/auth.service.js';
import type { Autenticado } from '../types/domain.js';
import { logger } from '../utils/logger.js';
import { ligarEmissor, publicar } from './bus.js';
import { salaOperacao, salasDe } from './salas.js';

/** Minimum gap between two accepted positions from the same socket. */
const INTERVALO_MINIMO_MS = 3_000;
/**
 * How often a live socket's session is checked against the database. The suite drops
 * it to a fraction of a second: a revocation that no test can observe is a claim
 * rather than a mechanism, and two minutes of waiting proves nothing extra.
 */
const REVALIDAR_MS = env.isTest ? 250 : 2 * 60 * 1000;

interface Ligado {
  readonly auth: Autenticado;
  /** The record the session is narrowed to, exactly as the API resolves it. */
  readonly vinculo: { readonly driverId?: string; readonly customerId?: string };
  ultimaPosicao: number;
}

const dadosDe = new WeakMap<Socket, Ligado>();

/**
 * Cookies are parsed here rather than by `cookie-parser`: the handshake is a raw
 * upgrade request that never goes through the Express middleware stack.
 */
const cookieDeSessao = (cabecalho: string | undefined): string | undefined => {
  if (cabecalho === undefined) return undefined;

  for (const parte of cabecalho.split(';')) {
    const separador = parte.indexOf('=');
    if (separador === -1) continue;
    if (parte.slice(0, separador).trim() !== COOKIE_SESSAO) continue;
    return decodeURIComponent(parte.slice(separador + 1).trim());
  }

  return undefined;
};

/**
 * The parcel the driver is carrying, so a position can be read next to it. The code
 * comes along with the id: the map says "a transportar KRG-000009", and an event that
 * carried only the id would leave it saying "sem entrega activa" next to a link to the
 * delivery — which is worse than saying nothing.
 */
const encomendaActiva = async (
  companyId: string,
  driverId: string,
): Promise<{ id: string; code: string } | undefined> => {
  const { rows } = await query<{ id: string; code: string }>(
    `SELECT id, code FROM orders
      WHERE company_id = $1 AND driver_id = $2
        AND status IN ('ATRIBUIDO', 'RECOLHIDO', 'EM_ENTREGA')
      ORDER BY updated_at DESC
      LIMIT 1`,
    [companyId, driverId],
  );
  return rows[0];
};

interface Recusa {
  readonly ok: false;
  readonly message: string;
}

/**
 * A position is a claim a phone makes. It is checked the same way a typed
 * coordinate is — including the swapped pair, which a browser will happily report if
 * something in between reverses them.
 */
const validarPosicao = (
  dados: unknown,
): { ok: true; latitude: number; longitude: number; accuracyMeters?: number } | Recusa => {
  if (typeof dados !== 'object' || dados === null) {
    return { ok: false, message: 'Posição inválida.' };
  }

  const { latitude, longitude, accuracyMeters } = dados as Record<string, unknown>;

  if (typeof latitude !== 'number' || typeof longitude !== 'number') {
    return { ok: false, message: 'Posição inválida.' };
  }
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return { ok: false, message: 'Posição inválida.' };
  }

  if (!dentroDeAngola({ latitude, longitude })) {
    return {
      ok: false,
      message: pareceTrocado({ latitude, longitude })
        ? 'Latitude e longitude parecem trocadas.'
        : 'A posição indicada está fora de Angola.',
    };
  }

  return {
    ok: true,
    latitude,
    longitude,
    ...(typeof accuracyMeters === 'number' && accuracyMeters >= 0
      ? { accuracyMeters: Math.round(accuracyMeters) }
      : {}),
  };
};

/**
 * The realtime layer.
 *
 * Authentication is the same session cookie the API uses, resolved by the same
 * function: a socket cannot be a second, weaker way in. Rooms are joined once, at
 * connect, from the session — a client never asks to subscribe to anything, because
 * a subscribe message is a request to name someone else's room.
 */
export const criarTempoReal = (servidor: HttpServer): Server => {
  const io = new Server(servidor, {
    path: '/realtime',
    serveClient: false,
    cors: { origin: env.corsOrigins, credentials: true },
    // A driver on a weak connection loses the socket often; the browser reconnects
    // and refetches. Nothing depends on a socket staying up.
    pingTimeout: 20_000,
  });

  io.use((socket, next) => {
    void (async () => {
      const auth = await resolverSessao(cookieDeSessao(socket.request.headers.cookie));
      if (auth === null) {
        // The message reaches the client's `connect_error`, so the interface can say
        // "sessão expirada" instead of reconnecting forever against a closed door.
        next(new Error('UNAUTHENTICATED'));
        return;
      }

      const ambito = await ambitoDe(auth);
      if (ambito === 'vazio') {
        next(new Error('SEM_AMBITO'));
        return;
      }

      dadosDe.set(socket, { auth, vinculo: ambito, ultimaPosicao: 0 });
      next();
    })().catch((erro: unknown) => {
      logger.error('realtime handshake failed', {
        message: erro instanceof Error ? erro.message : String(erro),
      });
      next(new Error('INTERNAL_ERROR'));
    });
  });

  io.on('connection', (socket) => {
    const ligado = dadosDe.get(socket);
    if (ligado === undefined) {
      socket.disconnect(true);
      return;
    }

    const { auth } = ligado;
    void socket.join([...salasDe(auth, ligado.vinculo)]);

    socket.emit('pronto', { role: auth.role, companyName: auth.companyName });

    // A session that is revoked - logout elsewhere, an account disabled - must stop
    // working now, not when the socket happens to drop. This is the same reason
    // sessions live in the database instead of a self-contained token.
    const revalidacao = setInterval(() => {
      void (async () => {
        const { rows } = await query<{ id: string }>(
          `SELECT id FROM sessions WHERE id = $1 AND revoked_at IS NULL AND expires_at > now()`,
          [auth.sessionId],
        );
        if (rows.length === 0) {
          socket.emit('sessao:terminada');
          socket.disconnect(true);
        }
      })().catch(() => undefined);
    }, REVALIDAR_MS);

    socket.on('disconnect', () => {
      clearInterval(revalidacao);
      dadosDe.delete(socket);
    });

    socket.on('posicao', (dados: unknown, confirmar?: (resposta: unknown) => void) => {
      void (async () => {
        // Only a driver reports a position, and only his own: the driver id comes
        // from the session, never from the message.
        const driverId = ligado.vinculo.driverId;
        if (auth.role !== 'MOTORISTA' || driverId === undefined) {
          confirmar?.({ ok: false, message: 'Só um motorista reporta posição.' });
          return;
        }

        const agora = Date.now();
        if (agora - ligado.ultimaPosicao < INTERVALO_MINIMO_MS) {
          // Dropped rather than refused: a phone reporting too eagerly is not an
          // error worth telling the driver about, and the write it would cause is.
          confirmar?.({ ok: true, ignored: true });
          return;
        }

        const validada = validarPosicao(dados);
        if (!validada.ok) {
          confirmar?.({ ok: false, message: validada.message });
          return;
        }

        ligado.ultimaPosicao = agora;
        const encomenda = await encomendaActiva(auth.companyId, driverId);

        await posicoes.registar({
          driverId,
          companyId: auth.companyId,
          latitude: validada.latitude,
          longitude: validada.longitude,
          ...(validada.accuracyMeters !== undefined
            ? { accuracyMeters: validada.accuracyMeters }
            : {}),
          ...(encomenda !== undefined ? { orderId: encomenda.id } : {}),
        });

        // Positions go to the people dispatching, and to nobody else. Another driver
        // has no business knowing where his colleague is, and a customer following a
        // parcel is a phase of its own with a narrower payload.
        publicar({ companyId: auth.companyId, operacao: true }, 'motorista:posicao', {
          driverId,
          driverName: auth.name,
          latitude: validada.latitude,
          longitude: validada.longitude,
          ...(validada.accuracyMeters !== undefined
            ? { accuracyMeters: validada.accuracyMeters }
            : {}),
          ...(encomenda !== undefined ? { orderId: encomenda.id, orderCode: encomenda.code } : {}),
          reportedAt: new Date().toISOString(),
        });

        confirmar?.({ ok: true });
      })().catch((erro: unknown) => {
        logger.error('realtime position failed', {
          message: erro instanceof Error ? erro.message : String(erro),
        });
        confirmar?.({ ok: false, message: 'Não foi possível registar a posição.' });
      });
    });
  });

  ligarEmissor({
    paraSalas: (salas, evento, dados) => {
      io.to([...salas]).emit(evento, dados);
    },
  });

  logger.info('realtime listening', { path: '/realtime' });

  return io;
};

/** Exported for the tests that assert room naming without a live server. */
export { salaOperacao };
