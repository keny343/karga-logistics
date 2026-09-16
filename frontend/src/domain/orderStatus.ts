/**
 * The status vocabulary as the API reports it. The backend owns which transitions
 * are legal; this file only decides how each status reads and which colour group
 * it belongs to.
 *
 * Grouping follows one rule: amber means the operation is waiting on us, blue
 * means it is moving, green means done, red means failed, grey means closed
 * without delivering.
 */
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

export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

interface Descricao {
  readonly label: string;
  readonly tone: Tone;
}

const MAPA: Record<OrderStatus, Descricao> = {
  CRIADO: { label: 'Criado', tone: 'warning' },
  CONFIRMADO: { label: 'Confirmado', tone: 'info' },
  PREPARANDO: { label: 'Em preparação', tone: 'info' },
  PRONTO: { label: 'Pronto', tone: 'warning' },
  ATRIBUIDO: { label: 'Atribuído', tone: 'info' },
  RECOLHIDO: { label: 'Recolhido', tone: 'info' },
  EM_ENTREGA: { label: 'Em entrega', tone: 'info' },
  ENTREGUE: { label: 'Entregue', tone: 'success' },
  CANCELADO: { label: 'Cancelado', tone: 'neutral' },
  FALHA_ENTREGA: { label: 'Falha na entrega', tone: 'danger' },
  DEVOLVIDO: { label: 'Devolvido', tone: 'neutral' },
};

export const statusLabel = (status: OrderStatus): string => MAPA[status].label;
export const statusTone = (status: OrderStatus): Tone => MAPA[status].tone;

/** The order in which statuses appear on a tracking timeline. */
export const TIMELINE_PRINCIPAL: readonly OrderStatus[] = [
  'CRIADO',
  'CONFIRMADO',
  'PREPARANDO',
  'PRONTO',
  'ATRIBUIDO',
  'RECOLHIDO',
  'EM_ENTREGA',
  'ENTREGUE',
];

export const DRIVER_STATUSES = ['DISPONIVEL', 'EM_ENTREGA', 'INDISPONIVEL', 'OFFLINE'] as const;
export type DriverStatus = (typeof DRIVER_STATUSES)[number];

const MOTORISTA: Record<DriverStatus, Descricao> = {
  DISPONIVEL: { label: 'Disponível', tone: 'success' },
  EM_ENTREGA: { label: 'Em entrega', tone: 'info' },
  INDISPONIVEL: { label: 'Indisponível', tone: 'warning' },
  OFFLINE: { label: 'Offline', tone: 'neutral' },
};

export const driverStatusLabel = (status: DriverStatus): string => MOTORISTA[status].label;
export const driverStatusTone = (status: DriverStatus): Tone => MOTORISTA[status].tone;
