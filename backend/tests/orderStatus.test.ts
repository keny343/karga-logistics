import { describe, expect, it } from 'vitest';
import {
  ESTADOS_FINAIS,
  ORDER_STATUSES,
  TRANSICOES,
  assegurarTransicao,
  exigeMotorista,
  isFinal,
  podeTransitar,
  transicoesDe,
  type OrderStatus,
} from '../src/domain/orderStatus.js';
import { AppError } from '../src/utils/errors.js';

const contexto = { code: 'KRG-000001', temMotorista: true };
const semMotorista = { code: 'KRG-000001', temMotorista: false };

/** Every ordered pair of statuses, used to prove the table is exhaustive. */
const todosOsPares = ORDER_STATUSES.flatMap((de) => ORDER_STATUSES.map((para) => [de, para] as const));

describe('the transition table', () => {
  it('covers every status', () => {
    for (const status of ORDER_STATUSES) {
      expect(TRANSICOES[status]).toBeDefined();
    }
  });

  it('never points at a status that does not exist', () => {
    for (const status of ORDER_STATUSES) {
      for (const destino of TRANSICOES[status]) {
        expect(ORDER_STATUSES).toContain(destino);
      }
    }
  });

  it('never allows a status to move to itself', () => {
    for (const status of ORDER_STATUSES) {
      expect(TRANSICOES[status]).not.toContain(status);
    }
  });

  it('leaves final states with nowhere to go', () => {
    for (const status of ESTADOS_FINAIS) {
      expect(TRANSICOES[status]).toEqual([]);
      expect(isFinal(status)).toBe(true);
    }
  });

  it('keeps every status reachable from CRIADO', () => {
    const alcancados = new Set<OrderStatus>(['CRIADO']);
    let cresceu = true;
    while (cresceu) {
      cresceu = false;
      for (const status of [...alcancados]) {
        for (const destino of TRANSICOES[status]) {
          if (!alcancados.has(destino)) {
            alcancados.add(destino);
            cresceu = true;
          }
        }
      }
    }
    expect([...alcancados].sort()).toEqual([...ORDER_STATUSES].sort());
  });
});

describe('the delivery happy path', () => {
  const caminho: readonly OrderStatus[] = [
    'CRIADO',
    'CONFIRMADO',
    'PREPARANDO',
    'PRONTO',
    'ATRIBUIDO',
    'RECOLHIDO',
    'EM_ENTREGA',
    'ENTREGUE',
  ];

  it('walks from creation to delivery one step at a time', () => {
    for (let i = 0; i < caminho.length - 1; i += 1) {
      const de = caminho[i] as OrderStatus;
      const para = caminho[i + 1] as OrderStatus;
      expect(podeTransitar(de, para), `${de} -> ${para}`).toBe(true);
      expect(() => assegurarTransicao(de, para, contexto)).not.toThrow();
    }
  });

  it('refuses to skip a step', () => {
    expect(podeTransitar('CRIADO', 'ENTREGUE')).toBe(false);
    expect(podeTransitar('PRONTO', 'EM_ENTREGA')).toBe(false);
    expect(podeTransitar('CONFIRMADO', 'ATRIBUIDO')).toBe(false);
  });

  it('refuses to go backwards', () => {
    expect(podeTransitar('EM_ENTREGA', 'RECOLHIDO')).toBe(false);
    expect(podeTransitar('ENTREGUE', 'EM_ENTREGA')).toBe(false);
    expect(podeTransitar('PRONTO', 'CRIADO')).toBe(false);
  });
});

describe('cancelling', () => {
  it('is allowed while the parcel is still in the warehouse', () => {
    for (const status of ['CRIADO', 'CONFIRMADO', 'PREPARANDO', 'PRONTO'] as const) {
      expect(podeTransitar(status, 'CANCELADO'), status).toBe(true);
    }
  });

  it('is refused once a driver is carrying it, so no parcel goes unaccounted for', () => {
    for (const status of ['ATRIBUIDO', 'RECOLHIDO', 'EM_ENTREGA'] as const) {
      expect(podeTransitar(status, 'CANCELADO'), status).toBe(false);
    }
  });
});

describe('a failed delivery', () => {
  it('can be retried', () => {
    expect(podeTransitar('EM_ENTREGA', 'FALHA_ENTREGA')).toBe(true);
    expect(podeTransitar('FALHA_ENTREGA', 'EM_ENTREGA')).toBe(true);
  });

  it('can end as a return', () => {
    expect(podeTransitar('FALHA_ENTREGA', 'DEVOLVIDO')).toBe(true);
  });

  it('cannot be turned straight into a delivery', () => {
    expect(podeTransitar('FALHA_ENTREGA', 'ENTREGUE')).toBe(false);
  });
});

describe('driver requirement', () => {
  it('applies to every state where someone is carrying the parcel', () => {
    for (const status of ['ATRIBUIDO', 'RECOLHIDO', 'EM_ENTREGA', 'ENTREGUE'] as const) {
      expect(exigeMotorista(status), status).toBe(true);
    }
  });

  it('refuses a transition into those states with no driver attached', () => {
    expect(() => assegurarTransicao('PRONTO', 'ATRIBUIDO', semMotorista)).toThrowError(AppError);
    try {
      assegurarTransicao('PRONTO', 'ATRIBUIDO', semMotorista);
    } catch (erro) {
      expect((erro as AppError).code).toBe('INVALID_STATE_TRANSITION');
      expect((erro as AppError).message).toContain('motorista');
    }
  });

  it('does not apply to the warehouse states', () => {
    expect(() => assegurarTransicao('CRIADO', 'CONFIRMADO', semMotorista)).not.toThrow();
    expect(() => assegurarTransicao('PREPARANDO', 'CANCELADO', semMotorista)).not.toThrow();
  });
});

describe('assegurarTransicao', () => {
  it('rejects every pair the table does not allow', () => {
    for (const [de, para] of todosOsPares) {
      if (podeTransitar(de, para)) continue;
      expect(() => assegurarTransicao(de, para, contexto), `${de} -> ${para}`).toThrowError(AppError);
    }
  });

  it('says which states are possible instead of only refusing', () => {
    try {
      assegurarTransicao('CRIADO', 'ENTREGUE', contexto);
      expect.unreachable('devia ter lançado');
    } catch (erro) {
      const mensagem = (erro as AppError).message;
      expect(mensagem).toContain('CRIADO');
      expect(mensagem).toContain('CONFIRMADO');
      expect(mensagem).toContain('KRG-000001');
    }
  });

  it('explains that a final state is final', () => {
    try {
      assegurarTransicao('ENTREGUE', 'EM_ENTREGA', contexto);
      expect.unreachable('devia ter lançado');
    } catch (erro) {
      expect((erro as AppError).message).toContain('estado final');
    }
  });

  it('tells the caller when nothing needs to change', () => {
    try {
      assegurarTransicao('EM_ENTREGA', 'EM_ENTREGA', contexto);
      expect.unreachable('devia ter lançado');
    } catch (erro) {
      expect((erro as AppError).message).toContain('já está');
    }
  });
});

describe('transicoesDe', () => {
  it('is what the interface offers as buttons', () => {
    expect(transicoesDe('EM_ENTREGA')).toEqual(['ENTREGUE', 'FALHA_ENTREGA']);
    expect(transicoesDe('ENTREGUE')).toEqual([]);
  });
});
