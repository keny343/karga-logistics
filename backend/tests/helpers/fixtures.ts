import request from 'supertest';
import type { Express } from 'express';
import { query } from '../../src/config/database.js';
import { hashDePassword } from '../../src/services/auth.service.js';
import type { Role } from '../../src/types/domain.js';

/**
 * Test fixtures build real rows through real SQL: the point of these tests is that
 * the constraints, the tenancy filters and the state machine hold together, and a
 * mocked repository would prove none of that.
 */

export const PASSWORD = 'Teste1234!';

let contador = 0;
const unico = (): string => {
  contador += 1;
  return `${Date.now().toString(36)}${contador}`;
};

/** Order matters: children before parents. */
export const limparBase = async (): Promise<void> => {
  await query('DELETE FROM driver_positions');
  await query('DELETE FROM delivery_proofs');
  await query('DELETE FROM order_status_history');
  await query('DELETE FROM orders');
  await query('DELETE FROM drivers');
  await query('DELETE FROM customers');
  await query('DELETE FROM sessions');
  await query('DELETE FROM login_attempts');
  await query('DELETE FROM audit_logs');
  await query('DELETE FROM users');
  await query('DELETE FROM companies');
};

export const criarEmpresa = async (nome = 'Empresa Teste'): Promise<string> => {
  const { rows } = await query<{ id: string }>(
    'INSERT INTO companies (name, slug) VALUES ($1, $2) RETURNING id',
    [nome, `empresa-${unico()}`],
  );
  const id = rows[0]?.id;
  if (id === undefined) throw new Error('empresa não criada');
  return id;
};

export const criarUtilizador = async (dados: {
  companyId: string;
  role: Role;
  email?: string;
  name?: string;
  password?: string;
}): Promise<{ id: string; email: string }> => {
  const email = dados.email ?? `${dados.role.toLowerCase()}-${unico()}@teste.ao`;
  const hash = await hashDePassword(dados.password ?? PASSWORD);
  const { rows } = await query<{ id: string }>(
    `INSERT INTO users (company_id, name, email, password_hash, role)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [dados.companyId, dados.name ?? `Utilizador ${dados.role}`, email, hash, dados.role],
  );
  const id = rows[0]?.id;
  if (id === undefined) throw new Error('utilizador não criado');
  return { id, email };
};

export const criarCliente = async (dados: {
  companyId: string;
  userId?: string;
  name?: string;
}): Promise<string> => {
  const { rows } = await query<{ id: string }>(
    `INSERT INTO customers
       (company_id, user_id, name, phone, addr_description, addr_municipality)
     VALUES ($1, $2, $3, $4, 'Rua de teste 1', 'Talatona') RETURNING id`,
    [
      dados.companyId,
      dados.userId ?? null,
      dados.name ?? 'Cliente Teste',
      `+244923${String(Math.floor(Math.random() * 900000) + 100000)}`,
    ],
  );
  const id = rows[0]?.id;
  if (id === undefined) throw new Error('cliente não criado');
  return id;
};

export const criarMotorista = async (dados: {
  companyId: string;
  userId?: string;
  status?: string;
  name?: string;
}): Promise<string> => {
  const { rows } = await query<{ id: string }>(
    `INSERT INTO drivers (company_id, user_id, name, phone, status)
     VALUES ($1, $2, $3, $4, $5::driver_status) RETURNING id`,
    [
      dados.companyId,
      dados.userId ?? null,
      dados.name ?? 'Motorista Teste',
      `+244924${String(Math.floor(Math.random() * 900000) + 100000)}`,
      dados.status ?? 'DISPONIVEL',
    ],
  );
  const id = rows[0]?.id;
  if (id === undefined) throw new Error('motorista não criado');
  return id;
};

export const criarEncomenda = async (dados: {
  companyId: string;
  customerId: string;
  status?: string;
  driverId?: string;
  expectedAt?: Date;
  /** Reports are read over a window, so a test needs orders outside it too. */
  createdAt?: Date;
  completedAt?: Date;
  destMunicipality?: string;
}): Promise<{ id: string; code: string }> => {
  const { rows } = await query<{ id: string; code: string }>(
    `INSERT INTO orders (
       company_id, code, customer_id, driver_id, status, description,
       weight_grams, value_cents,
       origin_description, origin_municipality, dest_description, dest_municipality,
       expected_delivery_at, created_at, completed_at
     ) VALUES (
       $1, 'KRG-' || lpad(nextval('order_code_seq')::text, 6, '0'), $2, $3, $4::order_status,
       'Encomenda de teste', 1000, 50000,
       'Armazém', 'Cacuaco', 'Casa do cliente', $6,
       $5, coalesce($7, now()), $8
     ) RETURNING id, code`,
    [
      dados.companyId,
      dados.customerId,
      dados.driverId ?? null,
      dados.status ?? 'CRIADO',
      dados.expectedAt ?? null,
      dados.destMunicipality ?? 'Talatona',
      dados.createdAt ?? null,
      dados.completedAt ?? null,
    ],
  );
  const linha = rows[0];
  if (linha === undefined) throw new Error('encomenda não criada');

  await query(
    `INSERT INTO order_status_history (order_id, company_id, status, actor_label)
     VALUES ($1, $2, $3::order_status, 'fixture')`,
    [linha.id, dados.companyId, dados.status ?? 'CRIADO'],
  );

  return linha;
};

/**
 * Real image bytes, small enough to inline.
 *
 * Both are complete, decodable files rather than a header followed by padding: the tests
 * that matter here are about what the server accepts and refuses, and a fake that only
 * satisfies the check being tested would let a broken check pass.
 */
export const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64',
);

export const JPEG_1X1 = Buffer.from(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwcJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPDIzMv/AABEIAAEAAQMBIgACEQEDEQH/xAAVAAEBAAAAAAAAAAAAAAAAAAAACv/EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAUAQEBAAAAAAAAAAAAAAAAAAAABf/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AJ0AGZf/2Q==',
  'base64',
);

/**
 * Attaches a proof the way a driver's browser does, over multipart. Tests that need a
 * delivery to be allowed use this rather than writing the row directly: the rule they
 * depend on is enforced by the API, so the fixture goes through the API.
 */
export const anexarProva = async (
  app: Express,
  cookie: string,
  orderId: string,
  opcoes: { kind?: 'FOTO' | 'ASSINATURA'; bytes?: Buffer; nome?: string; tipo?: string } = {},
) => {
  const pedido = request(app)
    .post(`/api/orders/${orderId}/proofs`)
    .set('Cookie', cookie)
    .field('kind', opcoes.kind ?? 'FOTO');

  return pedido.attach('file', opcoes.bytes ?? JPEG_1X1, {
    filename: opcoes.nome ?? 'entrega.jpg',
    contentType: opcoes.tipo ?? 'image/jpeg',
  });
};

/** Logs in over HTTP and returns the session cookie, exactly as a browser would hold it. */
export const iniciarSessao = async (
  app: Express,
  email: string,
  password: string = PASSWORD,
): Promise<string> => {
  const resposta = await request(app).post('/api/auth/login').send({ email, password });
  if (resposta.status !== 200) {
    throw new Error(`login falhou (${resposta.status}): ${JSON.stringify(resposta.body)}`);
  }
  const cookies = resposta.headers['set-cookie'];
  const lista = Array.isArray(cookies) ? cookies : [cookies];
  const sessao = lista.find((cookie) => typeof cookie === 'string' && cookie.startsWith('karga_session='));
  if (sessao === undefined) throw new Error('login não devolveu cookie de sessão');
  return sessao.split(';')[0] ?? '';
};
