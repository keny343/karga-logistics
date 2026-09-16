/**
 * One place that knows how to talk to the API. Errors arrive in the envelope the
 * backend promises ({ error: { code, message, requestId } }), so the UI can show
 * a real message and quote the request id instead of saying "something failed".
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

export interface Health {
  status: string;
  service: string;
  uptimeSeconds: number;
}

export const api = {
  health: () => request<Health>('/health'),
};
