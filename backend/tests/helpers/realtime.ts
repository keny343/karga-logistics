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

/**
 * Everything one browser was told, for as long as it stays connected.
 *
 * A journey test needs both halves of the question: what each person was told, and what
 * nobody told them. Waiting for an event proves the first; only a recording that was
 * listening the whole time proves the second.
 */
export interface Gravador {
  /** Every event received, in order. */
  readonly tudo: readonly { evento: string; dados: unknown }[];
  /** The payloads of one event, in order. */
  de: <T>(evento: string) => T[];
  quantos: (evento: string) => number;
  /** Waits until the predicate holds over what has arrived, or gives up. */
  ate: (
    descricao: string,
    condicao: (gravador: Gravador) => boolean,
    timeoutMs?: number,
  ) => Promise<void>;
}

const EVENTOS = ['encomenda:actualizada', 'motorista:posicao', 'aviso', 'sessao:terminada'] as const;

export const gravar = (socket: SocketCliente): Gravador => {
  const recebidos: { evento: string; dados: unknown }[] = [];

  for (const evento of EVENTOS) {
    socket.on(evento, (dados: unknown) => {
      recebidos.push({ evento, dados });
    });
  }

  const gravador: Gravador = {
    tudo: recebidos,
    de: <T,>(evento: string) =>
      recebidos.filter((linha) => linha.evento === evento).map((linha) => linha.dados as T),
    quantos: (evento) => recebidos.filter((linha) => linha.evento === evento).length,
    ate: async (descricao, condicao, timeoutMs = 3_000) => {
      const limite = Date.now() + timeoutMs;
      while (!condicao(gravador)) {
        if (Date.now() > limite) {
          const chegaram = recebidos.map((linha) => linha.evento).join(', ');
          throw new Error(`esgotou a espera por ${descricao}. Chegou: [${chegaram}]`);
        }
        await new Promise((resolver) => setTimeout(resolver, 25));
      }
    },
  };

  return gravador;
};

/**
 * Long enough for anything already in flight to have arrived. Used before asserting that
 * somebody was told nothing: absence needs a moment to mean anything.
 */
export const assentar = (ms = 350): Promise<void> =>
  new Promise((resolver) => setTimeout(resolver, ms));

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
