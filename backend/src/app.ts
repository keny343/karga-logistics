import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { env } from './config/env.js';
import { getHealth, getReady } from './controllers/health.controller.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { requestContext } from './middleware/requestContext.js';
import { apiRouter } from './routes/index.js';
import { AppError } from './utils/errors.js';

export const createApp = (): Express => {
  const app = express();

  // Render and Vercel sit in front of this process, so the client IP arrives in
  // a header. Trusting exactly one hop keeps rate limiting keyed on the real
  // caller without letting a client forge the chain.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(requestContext);

  // Probes come before CORS on purpose: an origin misconfiguration must not be
  // able to make the service look dead to its own platform.
  app.get('/health', getHealth);
  app.get('/ready', getReady);

  app.use(helmet());
  app.use(
    cors({
      origin: (origin, callback) => {
        // No Origin header means a server-side or same-origin caller.
        if (origin === undefined || env.corsOrigins.includes(origin.replace(/\/+$/, ''))) {
          callback(null, true);
          return;
        }
        callback(new AppError('FORBIDDEN', 'Origem não permitida.'));
      },
      credentials: true,
    }),
  );

  app.use(express.json({ limit: '256kb' }));
  app.use(express.urlencoded({ extended: false, limit: '256kb' }));
  // Session cookies are read here and nowhere else; no signing secret is needed
  // because the cookie carries an opaque token, not data the server trusts.
  app.use(cookieParser());

  app.use(
    '/api',
    rateLimit({
      windowMs: 60_000,
      limit: env.isTest ? 10_000 : 300,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      handler: (_req, _res, next) => {
        next(new AppError('RATE_LIMITED', 'Demasiados pedidos. Tenta novamente em instantes.'));
      },
    }),
  );

  app.use('/api', apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};
