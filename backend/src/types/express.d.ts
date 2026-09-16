import type { Autenticado } from './domain.js';

declare global {
  namespace Express {
    interface Request {
      /** Correlates every log line and error response of a single request. */
      requestId: string;
      /** Present only after requerAutenticacao has run. */
      auth?: Autenticado;
    }
  }
}

export {};
