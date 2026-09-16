declare global {
  namespace Express {
    interface Request {
      /** Correlates every log line and error response of a single request. */
      requestId: string;
    }
  }
}

export {};
