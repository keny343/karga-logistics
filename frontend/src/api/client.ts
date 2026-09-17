import type { DriverStatus, OrderStatus } from '../domain/orderStatus';

/**
 * One place that knows how to talk to the API. Errors arrive in the envelope the
 * backend promises, so a screen can show a real message and quote the request id
 * instead of saying "something failed".
 */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    requestId?: string;
    details?: { field: string; message: string }[];
  };
}

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly requestId?: string;
  readonly details?: { field: string; message: string }[];

  constructor(status: number, body: ApiErrorBody) {
    super(body.error.message);
    this.name = 'ApiError';
    this.status = status;
    this.code = body.error.code;
    if (body.error.requestId !== undefined) this.requestId = body.error.requestId;
    if (body.error.details !== undefined) this.details = body.error.details;
  }
}

const semRede = (): ApiError =>
  new ApiError(0, {
    error: {
      code: 'NETWORK_ERROR',
      message: 'Sem ligação ao servidor. Verifica a rede e tenta de novo.',
    },
  });

export const request = async <T>(caminho: string, init: RequestInit = {}): Promise<T> => {
  let resposta: Response;
  try {
    resposta = await fetch(caminho, {
      ...init,
      credentials: 'include',
      headers: {
        ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
    });
  } catch {
    throw semRede();
  }

  const texto = await resposta.text();
  const corpo: unknown = texto.length > 0 ? JSON.parse(texto) : null;

  if (!resposta.ok) {
    const temEnvelope =
      corpo !== null && typeof corpo === 'object' && 'error' in (corpo as Record<string, unknown>);
    throw new ApiError(
      resposta.status,
      temEnvelope
        ? (corpo as ApiErrorBody)
        : { error: { code: 'UNEXPECTED_ERROR', message: `Erro ${resposta.status}.` } },
    );
  }

  return corpo as T;
};

const enviar = <T>(metodo: string, caminho: string, corpo?: unknown): Promise<T> =>
  request<T>(caminho, {
    method: metodo,
    ...(corpo !== undefined ? { body: JSON.stringify(corpo) } : {}),
  });

const comFiltros = (caminho: string, filtros: Record<string, string | number | undefined>): string => {
  const params = new URLSearchParams();
  for (const [chave, valor] of Object.entries(filtros)) {
    if (valor !== undefined && valor !== '') params.set(chave, String(valor));
  }
  const query = params.toString();
  return query.length > 0 ? `${caminho}?${query}` : caminho;
};

// ---------------------------------------------------------------- types

export type Role = 'ADMIN' | 'OPERADOR' | 'MOTORISTA' | 'CLIENTE';

export interface User {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly role: Role;
  readonly companyId: string;
  readonly companyName: string;
}

export interface Endereco {
  readonly description: string;
  readonly province: string;
  readonly municipality: string;
  readonly locality?: string;
  readonly reference?: string;
  readonly latitude?: number;
  readonly longitude?: number;
}

export interface Customer {
  readonly id: string;
  readonly name: string;
  readonly phone: string;
  readonly email?: string;
  readonly address: Endereco;
  readonly ordersCount?: number;
  readonly isActive: boolean;
  readonly createdAt: string;
}

export interface Driver {
  readonly id: string;
  readonly name: string;
  readonly phone: string;
  readonly documentId?: string;
  readonly status: DriverStatus;
  readonly vehicleType?: 'MOTA' | 'CARRO' | 'CARRINHA';
  readonly vehiclePlate?: string;
  readonly activeOrders: number;
  readonly deliveredCount: number;
  readonly isActive: boolean;
}

export interface OrderHistoryEntry {
  readonly status: OrderStatus;
  readonly at: string;
  readonly by: string;
  readonly note?: string;
}

export interface OrderSummary {
  readonly id: string;
  readonly code: string;
  readonly status: OrderStatus;
  readonly customerName: string;
  readonly driverName?: string;
  readonly destination: string;
  readonly valueCents: number;
  readonly createdAt: string;
  readonly expectedAt?: string;
  readonly late: boolean;
}

export interface Order extends OrderSummary {
  readonly customerId: string;
  readonly driverId?: string;
  readonly origin: Endereco;
  readonly destinationAddress: Endereco;
  readonly description: string;
  readonly weightGrams: number;
  readonly notes?: string;
  readonly completedAt?: string;
  readonly history: readonly OrderHistoryEntry[];
  readonly allowedTransitions: readonly OrderStatus[];
}

export interface Pagina<T> {
  readonly items: readonly T[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
}

export interface DashboardResumo {
  readonly ordersToday: number;
  readonly inDelivery: number;
  readonly delivered: number;
  readonly failed: number;
  readonly late: number;
  readonly activeDrivers: number;
  readonly byStatus: readonly { readonly status: OrderStatus; readonly count: number }[];
  readonly perDay: readonly { readonly day: string; readonly count: number }[];
  readonly recent: readonly OrderSummary[];
}

export interface Intervalo {
  readonly from: string;
  readonly to: string;
}

export interface RelatorioTotais {
  readonly created: number;
  readonly delivered: number;
  readonly failed: number;
  readonly cancelled: number;
  readonly returned: number;
  readonly inProgress: number;
  readonly late: number;
  readonly completed: number;
  readonly valueCents: number;
  readonly weightGrams: number;
  /** Null when nothing in the window has finished yet, which is not the same as 0%. */
  readonly successRate: number | null;
  readonly medianDeliveryMinutes: number | null;
}

export interface Relatorio {
  readonly range: Intervalo;
  readonly totals: RelatorioTotais;
  readonly perDay: readonly {
    readonly day: string;
    readonly created: number;
    readonly delivered: number;
  }[];
  readonly byStatus: readonly { readonly status: OrderStatus; readonly count: number }[];
  readonly byDriver: readonly {
    readonly driverId: string;
    readonly driverName: string;
    readonly assigned: number;
    readonly delivered: number;
    readonly failed: number;
    readonly medianDeliveryMinutes: number | null;
  }[];
  readonly byMunicipality: readonly {
    readonly municipality: string;
    readonly count: number;
    readonly delivered: number;
  }[];
}

export interface NovaEncomenda {
  readonly customerId: string;
  readonly description: string;
  readonly weightGrams: number;
  readonly valueCents: number;
  readonly origin: Endereco;
  readonly destination: Endereco;
  readonly expectedAt?: string;
  readonly notes?: string;
}

// ---------------------------------------------------------------- endpoints

export const api = {
  health: () => request<{ status: string; service: string; uptimeSeconds: number }>('/health'),

  login: (email: string, password: string) =>
    enviar<{ user: User }>('POST', '/api/auth/login', { email, password }),
  logout: () => enviar<{ ok: true }>('POST', '/api/auth/logout'),
  me: () => request<{ user: User | null }>('/api/auth/me'),

  dashboard: () => request<DashboardResumo>('/api/dashboard'),

  orders: (filtros: {
    status?: string;
    search?: string;
    driverId?: string;
    late?: string;
    page?: number;
  }) =>
    request<Pagina<OrderSummary>>(comFiltros('/api/orders', filtros)),
  order: (id: string) => request<{ order: Order }>(`/api/orders/${id}`),
  createOrder: (dados: NovaEncomenda) => enviar<{ order: Order }>('POST', '/api/orders', dados),
  assignOrder: (id: string, driverId: string) =>
    enviar<{ order: Order }>('POST', `/api/orders/${id}/assign`, { driverId }),
  changeStatus: (id: string, status: OrderStatus, note?: string) =>
    enviar<{ order: Order }>('POST', `/api/orders/${id}/status`, {
      status,
      ...(note !== undefined && note !== '' ? { note } : {}),
    }),

  customers: (filtros: { search?: string; page?: number }) =>
    request<Pagina<Customer>>(comFiltros('/api/customers', filtros)),
  createCustomer: (dados: {
    name: string;
    phone: string;
    email?: string;
    address: Endereco;
  }) => enviar<{ customer: Customer }>('POST', '/api/customers', dados),

  drivers: (filtros: { status?: string; search?: string; page?: number } = {}) =>
    request<Pagina<Driver>>(comFiltros('/api/drivers', filtros)),
  createDriver: (dados: {
    name: string;
    phone: string;
    documentId?: string;
    vehicleType?: string;
    vehiclePlate?: string;
  }) => enviar<{ driver: Driver }>('POST', '/api/drivers', dados),
  setDriverStatus: (id: string, status: DriverStatus) =>
    enviar<{ driver: Driver }>('PATCH', `/api/drivers/${id}`, { status }),

  report: (intervalo: Intervalo) =>
    request<Relatorio>(comFiltros('/api/reports/summary', { ...intervalo })),

  /**
   * The export is a file, so it does not go through `request`: the response is a
   * CSV, not the JSON envelope, and the browser has to be handed something to
   * download. The blob is fetched rather than linked so an error arrives as a
   * message on the screen instead of a downloaded file containing the error.
   */
  exportOrders: async (intervalo: Intervalo, status?: string): Promise<void> => {
    const caminho = comFiltros('/api/reports/orders.csv', {
      ...intervalo,
      ...(status !== undefined && status !== '' ? { status } : {}),
    });

    let resposta: Response;
    try {
      resposta = await fetch(caminho, { credentials: 'include' });
    } catch {
      throw semRede();
    }

    if (!resposta.ok) {
      const texto = await resposta.text();
      let corpo: unknown = null;
      try {
        corpo = texto.length > 0 ? JSON.parse(texto) : null;
      } catch {
        corpo = null;
      }
      const temEnvelope =
        corpo !== null && typeof corpo === 'object' && 'error' in (corpo as Record<string, unknown>);
      throw new ApiError(
        resposta.status,
        temEnvelope
          ? (corpo as ApiErrorBody)
          : {
              error: {
                code: 'EXPORT_FAILED',
                message: 'Não foi possível gerar a exportação. Tenta de novo.',
              },
            },
      );
    }

    const ficheiro = await resposta.blob();
    const url = URL.createObjectURL(ficheiro);
    const ligacao = document.createElement('a');
    ligacao.href = url;
    ligacao.download = `karga-encomendas-${intervalo.from}-a-${intervalo.to}.csv`;
    ligacao.click();
    // Without this the blob stays in memory for the life of the page.
    URL.revokeObjectURL(url);
  },
};
