/**
 * Every error the client is allowed to see has a code from this list. Codes are
 * part of the API contract: the frontend switches on them, so they change only
 * with a deliberate version bump.
 */
export const ERROR_CODES = {
  VALIDATION_ERROR: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  COMPANY_MISMATCH: 404,
  INVALID_STATE_TRANSITION: 409,
  CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

export interface ErrorDetail {
  readonly field: string;
  readonly message: string;
}

/**
 * A resource that belongs to another company answers 404 and not 403, on
 * purpose: a tenant should not be able to discover that an id exists elsewhere.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: readonly ErrorDetail[];
  override readonly cause?: unknown;

  constructor(
    code: ErrorCode,
    message: string,
    options: { details?: readonly ErrorDetail[]; cause?: unknown } = {},
  ) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = ERROR_CODES[code];
    if (options.details !== undefined) this.details = options.details;
    if (options.cause !== undefined) this.cause = options.cause;
  }
}

export const notFound = (recurso: string): AppError =>
  new AppError('NOT_FOUND', `${recurso} não encontrado.`);

export const validationFailed = (details: readonly ErrorDetail[]): AppError =>
  new AppError('VALIDATION_ERROR', 'Dados inválidos.', { details });
