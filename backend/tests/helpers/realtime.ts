import { createServer, type Server as HttpServer } from 'node:http';
import { type Socket as SocketCliente, io as ligar } from 'socket.io-client';
import type { Express } from 'express';
import type { Server } from 'socket.io';
import { criarTempoReal } from '../../src/realtime/index.js';
import { ligarEmissor } from '../../src/realtime/bus.js';

/**
 * A real HTTP server with the real socket layer on it.
 *
 * The realtime tests are about who receives what, and that answer lives in the
 * handshake, the rooms and the session — none of which a mocked socket would
 * exercise. So the suite starts a server on an ephemeral port and connects actual
 * clients to it.
 */
export interface Ambiente {
  readonly url: string;
  readonly io: Server;
  readonly http: HttpServer;
  fechar: () => Promise<void>;
}

export const arrancar = async (app: Express): Promise<Ambiente> => {
  const http = createServer(app);
  const io = criarTempoReal(http);

  await new Promise<void>((resolver) => {
    http.listen(0, '127.0.0.1', resolver);
  });

  const endereco = http.address();
  if (endereco === null || typeof endereco === 'string') throw new Error('sem porta');

  return {
    url: `http://127.0.0.1:${endereco.port}`,
    io,
    http,
    fechar: async () => {
      await io.close();
      // The bus keeps a reference to the closed server; leaving it attached would
      // make the next file's publishes go nowhere silently.
      ligarEmissor(null);
      await new Promise<void>((resolver) => {
        http.close(() => resolver());
      });
    },
  };
};

/** Connects as a browser would: nothing but the session cookie. */
export const ligarCliente = (
  ambiente: Ambiente,
  cookie?: string,
): Promise<{ socket: SocketCliente; pronto: { role: string } }> =>
  new Promise((resolver, rejeitar) => {
    const socket = ligar(ambiente.url, {
      path: '/realtime',
      transports: ['websocket'],
      ...(cookie !== undefined ? { extraHeaders: { Cookie: cookie } } : {}),
      reconnection: false,
    });

    const desistir = setTimeout(() => {
      socket.close();
      rejeitar(new Error('ligação não completou'));
    }, 5_000);

    socket.on('pronto', (dados: { role: string }) => {
      clearTimeout(desistir);
      resolver({ socket, pronto: dados });
    });

    socket.on('connect_error', (erro) => {
      clearTimeout(desistir);
      socket.close();
      rejeitar(erro);
    });
  });

/** Waits for one event, or gives up. Used for "this must arrive". */
export const esperarEvento = <T>(
  socket: SocketCliente,
  evento: string,
  timeoutMs = 3_000,
): Promise<T> =>
  new Promise((resolver, rejeitar) => {
    const desistir = setTimeout(() => {
      rejeitar(new Error(`evento ${evento} não chegou`));
    }, timeoutMs);

    socket.once(evento, (dados: T) => {
      clearTimeout(desistir);
      resolver(dados);
    });
  });

/**
 * Waits a fixed moment and reports whether the event arrived. Used for "this must
 * not arrive", which cannot be proven by waiting for something else.
 */
export const naoChegou = async (
  socket: SocketCliente,
  evento: string,
  janelaMs = 400,
): Promise<boolean> => {
  let chegou = false;
  const registar = (): void => {
    chegou = true;
  };
  socket.on(evento, registar);
  await new Promise((resolver) => setTimeout(resolver, janelaMs));
  socket.off(evento, registar);
  return !chegou;
};
