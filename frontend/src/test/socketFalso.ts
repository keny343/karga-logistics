import { vi } from 'vitest';

type Ouvinte = (dados: unknown, confirmar?: (resposta: unknown) => void) => void;

/**
 * A socket that behaves like one without a network.
 *
 * The tests that use it are about what the interface does with an event — a marker
 * that moves, a list that refetches, a driver told his position was refused. Running
 * a real Socket.IO client in jsdom would test the library instead, slowly.
 */
export interface SocketFalso {
  readonly on: (evento: string, ouvinte: Ouvinte) => void;
  readonly off: (evento: string, ouvinte: Ouvinte) => void;
  readonly emit: ReturnType<typeof vi.fn>;
  readonly close: ReturnType<typeof vi.fn>;
  /** Delivers an event to whoever is listening, as the server would. */
  receber: (evento: string, dados?: unknown) => void;
  /** Answers the next `emit` of this event with this acknowledgement. */
  responderA: (evento: string, resposta: unknown) => void;
}

export const criarSocketFalso = (): SocketFalso => {
  const ouvintes = new Map<string, Set<Ouvinte>>();
  const respostas = new Map<string, unknown>();

  const emit = vi.fn((evento: string, ...argumentos: unknown[]) => {
    const confirmar = argumentos.at(-1);
    const resposta = respostas.get(evento);
    if (typeof confirmar === 'function' && resposta !== undefined) {
      (confirmar as (dados: unknown) => void)(resposta);
    }
  });

  return {
    on: (evento, ouvinte) => {
      const conjunto = ouvintes.get(evento) ?? new Set<Ouvinte>();
      conjunto.add(ouvinte);
      ouvintes.set(evento, conjunto);
    },
    off: (evento, ouvinte) => {
      ouvintes.get(evento)?.delete(ouvinte);
    },
    emit,
    close: vi.fn(),
    receber: (evento, dados) => {
      for (const ouvinte of ouvintes.get(evento) ?? []) ouvinte(dados);
    },
    responderA: (evento, resposta) => {
      respostas.set(evento, resposta);
    },
  };
};
