import { salaCliente, salaMotorista, salaOperacao } from './salas.js';

/**
 * How the rest of the backend talks to connected browsers.
 *
 * Services publish through here instead of holding a Socket.IO server, for two
 * reasons: the HTTP path must work identically with no realtime attached (the test
 * suite runs that way, and so does a deploy where the socket layer is down), and a
 * service that imported the server would make the socket layer a dependency of the
 * domain rather than a consumer of it.
 *
 * A publish is fire-and-forget by design. A delivery that was recorded must not fail
 * because a browser could not be told about it — the interface can always ask the
 * API again, which is what it does on reconnect.
 */

export type EventoSaida = 'encomenda:actualizada' | 'motorista:posicao' | 'aviso';

export interface Destino {
  readonly companyId: string;
  /** Everyone dispatching for the company. */
  readonly operacao?: boolean;
  readonly driverId?: string;
  readonly customerId?: string;
}

interface Emissor {
  paraSalas(salas: readonly string[], evento: EventoSaida, dados: unknown): void;
}

let emissor: Emissor | null = null;

export const ligarEmissor = (novo: Emissor | null): void => {
  emissor = novo;
};

const salasDe = (destino: Destino): readonly string[] => [
  ...(destino.operacao === true ? [salaOperacao(destino.companyId)] : []),
  ...(destino.driverId !== undefined
    ? [salaMotorista(destino.companyId, destino.driverId)]
    : []),
  ...(destino.customerId !== undefined
    ? [salaCliente(destino.companyId, destino.customerId)]
    : []),
];

export const publicar = (destino: Destino, evento: EventoSaida, dados: unknown): void => {
  if (emissor === null) return;

  const salas = salasDe(destino);
  if (salas.length === 0) return;

  emissor.paraSalas(salas, evento, dados);
};
