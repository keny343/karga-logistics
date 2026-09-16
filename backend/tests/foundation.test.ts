import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { closePool } from '../src/config/database.js';

const app = createApp();

afterAll(async () => {
  await closePool();
});

describe('liveness', () => {
  it('answers without touching the database', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', service: 'karga-api' });
  });

  it('returns a request id that the caller can quote in a bug report', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('reuses a caller-supplied request id so traces cross service boundaries', async () => {
    const res = await request(app).get('/health').set('X-Request-Id', 'karga-teste-0001');
    expect(res.headers['x-request-id']).toBe('karga-teste-0001');
  });

  // Node's own HTTP client refuses to send a header containing a newline, so the
  // injection attempt this guards against can only arrive from another client.
  // What is testable here is the whitelist: anything outside it is replaced.
  it.each(['ab', 'id com espaços', 'a;b<c>d', 'x'.repeat(200)])(
    'replaces an unacceptable inbound request id (%s)',
    async (forjado) => {
      const res = await request(app).get('/health').set('X-Request-Id', forjado);
      expect(res.headers['x-request-id']).not.toBe(forjado);
      expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    },
  );
});

describe('readiness', () => {
  it('reports the database it depends on', async () => {
    const res = await request(app).get('/ready');
    expect([200, 503]).toContain(res.status);
    expect(res.body.checks.database).toBeDefined();
    if (res.status === 200) {
      expect(res.body.ready).toBe(true);
      expect(res.body.checks.database.ok).toBe(true);
    }
  });
});

describe('error envelope', () => {
  // Anonymously, an unknown path under /api answers 401 rather than 404: the
  // session check sits in front of the whole router, so an outsider cannot map
  // which routes exist. `/health` is public and unrouted below it.
  it('answers an unknown route with the documented shape', async () => {
    const res = await request(app).get('/health/nao-existe');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(typeof res.body.error.message).toBe('string');
    expect(res.body.error.requestId).toBeDefined();
  });

  it('does not disclose which api routes exist to an anonymous caller', async () => {
    const res = await request(app).get('/api/nao-existe');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('answers malformed JSON with JSON, not an HTML error page', async () => {
    const res = await request(app)
      .post('/api/nao-existe')
      .set('Content-Type', 'application/json')
      .send('{"quebrado":');
    expect(res.status).toBe(400);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('never leaks a stack trace to the client', async () => {
    const res = await request(app).get('/api/nao-existe');
    expect(JSON.stringify(res.body)).not.toContain('at ');
  });
});

describe('cross-origin rules', () => {
  it('allows the configured frontend origin', async () => {
    const res = await request(app).get('/api').set('Origin', 'http://localhost:5175');
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5175');
  });

  it('refuses an origin that is not on the list', async () => {
    const res = await request(app).get('/api').set('Origin', 'https://atacante.example');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('keeps probes reachable regardless of origin', async () => {
    const res = await request(app).get('/health').set('Origin', 'https://atacante.example');
    expect(res.status).toBe(200);
  });
});
