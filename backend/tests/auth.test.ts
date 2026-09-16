import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { closePool, query } from '../src/config/database.js';
import {
  PASSWORD,
  criarEmpresa,
  criarUtilizador,
  iniciarSessao,
  limparBase,
} from './helpers/fixtures.js';

const app = createApp();

let companyId: string;
let admin: { id: string; email: string };

beforeEach(async () => {
  await limparBase();
  companyId = await criarEmpresa('Karga Teste');
  admin = await criarUtilizador({ companyId, role: 'ADMIN', name: 'Ana Admin' });
});

afterAll(async () => {
  await closePool();
});

describe('POST /api/auth/login', () => {
  it('signs in with the right credentials and sets an httpOnly cookie', async () => {
    const resposta = await request(app)
      .post('/api/auth/login')
      .send({ email: admin.email, password: PASSWORD });

    expect(resposta.status).toBe(200);
    expect(resposta.body.user).toMatchObject({
      email: admin.email,
      role: 'ADMIN',
      companyId,
      companyName: 'Karga Teste',
    });
    // The password must not travel back in any shape.
    expect(JSON.stringify(resposta.body)).not.toContain(PASSWORD);
    expect(JSON.stringify(resposta.body)).not.toContain('password');

    const cookies = resposta.headers['set-cookie'] as unknown as string[];
    const sessao = cookies.find((cookie) => cookie.startsWith('karga_session='));
    expect(sessao).toBeDefined();
    expect(sessao).toContain('HttpOnly');
    expect(sessao).toContain('SameSite=Lax');
  });

  it('refuses a wrong password with the same message as an unknown account', async () => {
    const errada = await request(app)
      .post('/api/auth/login')
      .send({ email: admin.email, password: 'ErradaErrada1!' });
    const inexistente = await request(app)
      .post('/api/auth/login')
      .send({ email: 'ninguem@teste.ao', password: PASSWORD });

    expect(errada.status).toBe(401);
    expect(inexistente.status).toBe(401);
    // Same wording, so the response cannot be used to enumerate accounts.
    expect(errada.body.error.message).toBe(inexistente.body.error.message);
    expect(errada.headers['set-cookie']).toBeUndefined();
  });

  it('stores only a hash of the session token', async () => {
    const cookie = await iniciarSessao(app, admin.email);
    const token = cookie.replace('karga_session=', '');

    const { rows } = await query<{ token_hash: string }>('SELECT token_hash FROM sessions');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.token_hash).not.toBe(token);
    expect(rows[0]?.token_hash).toHaveLength(64);
  });

  it('records the login in the audit trail without any credential', async () => {
    await iniciarSessao(app, admin.email);
    const { rows } = await query<{ action: string; metadata: unknown }>(
      'SELECT action, metadata FROM audit_logs ORDER BY created_at DESC',
    );
    expect(rows[0]?.action).toBe('LOGIN');
    expect(JSON.stringify(rows[0]?.metadata)).not.toContain(PASSWORD);
  });

  it('validates the payload before touching the database', async () => {
    const resposta = await request(app).post('/api/auth/login').send({ email: 'nao-e-email' });
    expect(resposta.status).toBe(400);
    expect(resposta.body.error.code).toBe('VALIDATION_ERROR');
    expect(resposta.body.error.details.map((d: { field: string }) => d.field)).toContain('email');
  });

  it('asks which company when the same email exists in two of them', async () => {
    const outra = await criarEmpresa('Outra Transportadora');
    await criarUtilizador({ companyId: outra, role: 'ADMIN', email: admin.email });

    const ambiguo = await request(app)
      .post('/api/auth/login')
      .send({ email: admin.email, password: PASSWORD });
    expect(ambiguo.status).toBe(409);
    expect(ambiguo.body.error.message).toContain('empresa');

    const { rows } = await query<{ slug: string }>('SELECT slug FROM companies WHERE id = $1', [
      companyId,
    ]);
    const resolvido = await request(app)
      .post('/api/auth/login')
      .send({ email: admin.email, password: PASSWORD, companySlug: rows[0]?.slug });
    expect(resolvido.status).toBe(200);
    expect(resolvido.body.user.companyId).toBe(companyId);
  });
});

describe('brute force protection', () => {
  it('locks the account out after five failures and keeps it locked for the right password', async () => {
    for (let tentativa = 0; tentativa < 5; tentativa += 1) {
      const resposta = await request(app)
        .post('/api/auth/login')
        .send({ email: admin.email, password: 'Errada1!' });
      expect(resposta.status).toBe(401);
    }

    const bloqueado = await request(app)
      .post('/api/auth/login')
      .send({ email: admin.email, password: PASSWORD });

    expect(bloqueado.status).toBe(429);
    expect(bloqueado.body.error.code).toBe('RATE_LIMITED');
    expect(bloqueado.headers['set-cookie']).toBeUndefined();
  });

  it('clears the counter once a login succeeds', async () => {
    await request(app).post('/api/auth/login').send({ email: admin.email, password: 'Errada1!' });
    await iniciarSessao(app, admin.email);

    const { rows } = await query<{ total: string }>(
      'SELECT count(*) AS total FROM login_attempts WHERE lower(email) = lower($1)',
      [admin.email],
    );
    expect(Number(rows[0]?.total)).toBe(0);
  });

  it('does not lock a different account out', async () => {
    const outro = await criarUtilizador({ companyId, role: 'OPERADOR' });
    for (let tentativa = 0; tentativa < 5; tentativa += 1) {
      await request(app).post('/api/auth/login').send({ email: admin.email, password: 'Errada1!' });
    }
    const resposta = await request(app)
      .post('/api/auth/login')
      .send({ email: outro.email, password: PASSWORD });
    expect(resposta.status).toBe(200);
  });
});

describe('GET /api/auth/me', () => {
  it('answers 200 with a null user when nobody is signed in', async () => {
    const resposta = await request(app).get('/api/auth/me');
    expect(resposta.status).toBe(200);
    expect(resposta.body).toEqual({ user: null });
  });

  it('describes the signed-in user', async () => {
    const cookie = await iniciarSessao(app, admin.email);
    const resposta = await request(app).get('/api/auth/me').set('Cookie', cookie);
    expect(resposta.status).toBe(200);
    expect(resposta.body.user).toMatchObject({ email: admin.email, role: 'ADMIN' });
  });

  it('ignores a forged cookie', async () => {
    const resposta = await request(app)
      .get('/api/auth/me')
      .set('Cookie', 'karga_session=inventadoinventadoinventado');
    expect(resposta.body).toEqual({ user: null });
  });
});

describe('POST /api/auth/logout', () => {
  it('revokes the session so the cookie stops working', async () => {
    const cookie = await iniciarSessao(app, admin.email);

    const saiu = await request(app).post('/api/auth/logout').set('Cookie', cookie);
    expect(saiu.status).toBe(200);

    const depois = await request(app).get('/api/auth/me').set('Cookie', cookie);
    expect(depois.body).toEqual({ user: null });

    const { rows } = await query<{ revoked_at: Date | null }>('SELECT revoked_at FROM sessions');
    expect(rows[0]?.revoked_at).not.toBeNull();
  });

  it('is harmless when there is no session', async () => {
    const resposta = await request(app).post('/api/auth/logout');
    expect(resposta.status).toBe(200);
  });
});

describe('protected routes', () => {
  it('refuse anonymous callers', async () => {
    for (const caminho of ['/api/dashboard', '/api/orders', '/api/customers', '/api/drivers']) {
      const resposta = await request(app).get(caminho);
      expect(resposta.status, caminho).toBe(401);
      expect(resposta.body.error.code).toBe('UNAUTHENTICATED');
    }
  });

  it('refuse a driver on the operations endpoints', async () => {
    const motorista = await criarUtilizador({ companyId, role: 'MOTORISTA' });
    const cookie = await iniciarSessao(app, motorista.email);

    for (const caminho of ['/api/dashboard', '/api/customers', '/api/drivers']) {
      const resposta = await request(app).get(caminho).set('Cookie', cookie);
      expect(resposta.status, caminho).toBe(403);
      expect(resposta.body.error.code).toBe('FORBIDDEN');
    }
  });

  it('let a driver read the order list, narrowed to their own', async () => {
    const motorista = await criarUtilizador({ companyId, role: 'MOTORISTA' });
    const cookie = await iniciarSessao(app, motorista.email);
    const resposta = await request(app).get('/api/orders').set('Cookie', cookie);
    expect(resposta.status).toBe(200);
    expect(resposta.body.items).toEqual([]);
  });
});
