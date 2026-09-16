import { Router, type RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import * as auth from '../controllers/auth.controller.js';
import * as clientes from '../controllers/customers.controller.js';
import * as dashboard from '../controllers/dashboard.controller.js';
import * as motoristas from '../controllers/drivers.controller.js';
import * as encomendas from '../controllers/orders.controller.js';
import { requerAutenticacao, requerPapel } from '../middleware/authenticate.js';
import { env } from '../config/env.js';

/**
 * Health and readiness are wired directly onto the app, ahead of CORS, so a probe
 * can never be blocked by an origin list. Everything here is behind a session
 * except login.
 */
export const apiRouter = Router();

/**
 * Async handlers wrapped so a rejected promise reaches the error middleware.
 * Express 5 forwards rejections from async handlers already, but being explicit
 * keeps the behaviour independent of that.
 */
const rota =
  (handler: (...args: Parameters<RequestHandler>) => Promise<void>): RequestHandler =>
  (req, res, next) => {
    handler(req, res, next).catch(next);
  };

/**
 * A second, tighter limit in front of login, on top of the per-account throttling
 * in the database. This one stops the flood before it reaches bcrypt, which is
 * deliberately expensive.
 */
const limiteLogin = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: env.isTest ? 1000 : 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    error: {
      code: 'RATE_LIMITED',
      message: 'Demasiadas tentativas de início de sessão. Tenta de novo dentro de alguns minutos.',
    },
  },
});

apiRouter.get('/', (_req, res) => {
  res.json({
    service: 'karga-api',
    version: '0.3.0',
    resources: ['auth', 'dashboard', 'orders', 'customers', 'drivers'],
  });
});

// ----------------------------------------------------------------- auth
apiRouter.post('/auth/login', limiteLogin, rota(auth.login));
apiRouter.post('/auth/logout', rota(auth.logout));
apiRouter.get('/auth/me', rota(auth.me));

// Everything below requires a session.
apiRouter.use(requerAutenticacao);

const operacao = requerPapel('ADMIN', 'OPERADOR');

// ------------------------------------------------------------ dashboard
apiRouter.get('/dashboard', operacao, rota(dashboard.resumo));

// ------------------------------------------------------------- encomendas
apiRouter.get('/orders', rota(encomendas.listar));
apiRouter.post('/orders', operacao, rota(encomendas.criar));
apiRouter.get('/orders/:id', rota(encomendas.obter));
apiRouter.post('/orders/:id/assign', operacao, rota(encomendas.atribuir));
// Drivers change the state of their own parcels; the service checks ownership.
apiRouter.post(
  '/orders/:id/status',
  requerPapel('ADMIN', 'OPERADOR', 'MOTORISTA'),
  rota(encomendas.mudarEstado),
);

// --------------------------------------------------------------- clientes
apiRouter.get('/customers', operacao, rota(clientes.listar));
apiRouter.post('/customers', operacao, rota(clientes.criar));
apiRouter.get('/customers/:id', operacao, rota(clientes.obter));

// ------------------------------------------------------------- motoristas
apiRouter.get('/drivers', operacao, rota(motoristas.listar));
apiRouter.post('/drivers', operacao, rota(motoristas.criar));
apiRouter.patch('/drivers/:id', operacao, rota(motoristas.actualizarEstado));
apiRouter.get('/drivers/available', operacao, rota(encomendas.motoristasDisponiveis));
