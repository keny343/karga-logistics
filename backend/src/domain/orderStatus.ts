import { AppError } from '../utils/errors.js';

export const ORDER_STATUSES = [
  'CRIADO',
  'CONFIRMADO',
  'PREPARANDO',
  'PRONTO',
  'ATRIBUIDO',
  'RECOLHIDO',
  'EM_ENTREGA',
  'ENTREGUE',
  'CANCELADO',
  'FALHA_ENTREGA',
  'DEVOLVIDO',
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

/**
 * The only place that decides how an order may move. Everything else - routes,
 * services, the interface - asks this table rather than deciding for itself.
 *
 * Two rules are encoded here beyond the happy path. Cancelling is possible only
 * while the parcel is still in the warehouse: once a driver has it, the order ends
 * as delivered, failed or returned, because "cancelled" would leave a physical
 * parcel unaccounted for. And a failed delivery can be retried, which is why
 * FALHA_ENTREGA leads back to EM_ENTREGA.
 */
export const TRANSICOES: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  CRIADO: ['CONFIRMADO', 'CANCELADO'],
  CONFIRMADO: ['PREPARANDO', 'CANCELADO'],
  PREPARANDO: ['PRONTO', 'CANCELADO'],
  PRONTO: ['ATRIBUIDO', 'CANCELADO'],
  ATRIBUIDO: ['RECOLHIDO'],
  RECOLHIDO: ['EM_ENTREGA'],
  EM_ENTREGA: ['ENTREGUE', 'FALHA_ENTREGA'],
  FALHA_ENTREGA: ['EM_ENTREGA', 'DEVOLVIDO'],
  // Terminal. An order that ended does not move again; a new order is created
  // instead, so the history of what happened stays intact.
  ENTREGUE: [],
  CANCELADO: [],
  DEVOLVIDO: [],
};

/** States a driver must already be attached to. */
export const EXIGEM_MOTORISTA: readonly OrderStatus[] = [
  'ATRIBUIDO',
  'RECOLHIDO',
  'EM_ENTREGA',
  'ENTREGUE',
];

export const ESTADOS_FINAIS: readonly OrderStatus[] = ['ENTREGUE', 'CANCELADO', 'DEVOLVIDO'];

export const ESTADOS_ABERTOS: readonly OrderStatus[] = ORDER_STATUSES.filter(
  (status) => !ESTADOS_FINAIS.includes(status),
);

export const isOrderStatus = (valor: unknown): valor is OrderStatus =>
  typeof valor === 'string' && (ORDER_STATUSES as readonly string[]).includes(valor);

export const transicoesDe = (actual: OrderStatus): readonly OrderStatus[] => TRANSICOES[actual];

export const podeTransitar = (de: OrderStatus, para: OrderStatus): boolean =>
  TRANSICOES[de].includes(para);

export const isFinal = (status: OrderStatus): boolean => ESTADOS_FINAIS.includes(status);

export const exigeMotorista = (status: OrderStatus): boolean => EXIGEM_MOTORISTA.includes(status);

/**
 * Throws instead of returning false so a caller cannot forget to check. The
 * message names both states, because "transição inválida" alone tells an operator
 * nothing about what to do next.
 */
export const assegurarTransicao = (
  de: OrderStatus,
  para: OrderStatus,
  contexto: { readonly code: string; readonly temMotorista: boolean },
): void => {
  if (de === para) {
    throw new AppError('INVALID_STATE_TRANSITION', `A encomenda ${contexto.code} já está em ${para}.`);
  }

  if (!podeTransitar(de, para)) {
    const possiveis = TRANSICOES[de];
    throw new AppError(
      'INVALID_STATE_TRANSITION',
      possiveis.length === 0
        ? `A encomenda ${contexto.code} está em ${de}, que é um estado final, e não pode mudar para ${para}.`
        : `A encomenda ${contexto.code} está em ${de} e só pode passar a ${possiveis.join(' ou ')}. ${para} não é permitido.`,
    );
  }

  if (exigeMotorista(para) && !contexto.temMotorista) {
    throw new AppError(
      'INVALID_STATE_TRANSITION',
      `A encomenda ${contexto.code} precisa de um motorista atribuído antes de passar a ${para}.`,
    );
  }
};
