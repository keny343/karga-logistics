import { Router } from 'express';

/**
 * Business routes mount here as each phase lands. Health and readiness are wired
 * directly onto the app, ahead of CORS, so a probe can never be blocked by an
 * origin list.
 */
export const apiRouter = Router();

apiRouter.get('/', (_req, res) => {
  res.json({
    service: 'karga-api',
    version: '0.1.0',
    resources: [],
  });
});
