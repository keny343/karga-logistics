import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { closePool, query } from '../src/config/database.js';
import {
  anexarProva,
  criarCliente,
  criarEmpresa,
  criarEncomenda,
  criarMotorista,
  criarUtilizador,
  iniciarSessao,
  limparBase,
} from './helpers/fixtures.js';

const app = createApp();

let empresaA: string;
let empresaB: string;
let cookieOperador: string;
let clienteA: string;

beforeEach(async () => {
  await limparBase();

  empresaA = await criarEmpresa('Karga A');
  empresaB = await criarEmpresa('Karga B');

  const operador = await criarUtilizador({ companyId: empresaA, role: 'OPERADOR', name: 'Bia Op' });
  cookieOperador = await iniciarSessao(app, operador.email);
  clienteA = await criarCliente({ companyId: empresaA, name: 'Cliente A' });
});

afterAll(async () => {
  await closePool();
});

const criarPeloApi = async (extra: Record<string, unknown> = {}) =>
  request(app)
    .post('/api/orders')
    .set('Cookie', cookieOperador)
    .send({
      customerId: clienteA,
      description: 'Caixa de material clínico',
      weightGrams: 4200,
      valueCents: 150_000,
      origin: { description: 'Armazém Karga, km 8', municipality: 'Cacuaco' },
      destination: { description: 'Via S8, loja 4', municipality: 'Talatona' },
      ...extra,
    });

describe('POST /api/orders', () => {
  it('creates an order with a sequential code and its first history entry', async () => {
    const resposta = await criarPeloApi();

    expect(resposta.status).toBe(201);
    expect(resposta.body.order.code).toMatch(/^KRG-\d{6}$/);
    expect(resposta.body.order.status).toBe('CRIADO');
    expect(resposta.body.order.history).toHaveLength(1);
    expect(resposta.body.order.history[0].status).toBe('CRIADO');
    // The interface renders these as buttons, so they must be the domain's answer.
    expect(resposta.body.order.allowedTransitions).toEqual(['CONFIRMADO', 'CANCELADO']);
  });

  it('keeps money and weight as integers all the way through', async () => {
    const resposta = await criarPeloApi({ valueCents: 199_99, weightGrams: 501 });
    expect(resposta.body.order.valueCents).toBe(19999);
    expect(resposta.body.order.weightGrams).toBe(501);
  });

  it('refuses a customer from another company as if it did not exist', async () => {
    const clienteB = await criarCliente({ companyId: empresaB, name: 'Cliente B' });
    const resposta = await criarPeloApi({ customerId: clienteB });
    expect(resposta.status).toBe(404);
    expect(resposta.body.error.message).toContain('Cliente');
  });

  it('rejects an incomplete payload with a field-level explanation', async () => {
    const resposta = await request(app)
      .post('/api/orders')
      .set('Cookie', cookieOperador)
      .send({ customerId: clienteA, description: 'x' });

    expect(resposta.status).toBe(400);
    const campos = resposta.body.error.details.map((d: { field: string }) => d.field);
    expect(campos).toContain('weightGrams');
    expect(campos).toContain('destination');
  });

  it('refuses a negative value', async () => {
    const resposta = await criarPeloApi({ valueCents: -1 });
    expect(resposta.status).toBe(400);
  });
});

describe('GET /api/orders', () => {
  it('only ever returns orders of the caller company', async () => {
    await criarEncomenda({ companyId: empresaA, customerId: clienteA });
    const clienteB = await criarCliente({ companyId: empresaB });
    await criarEncomenda({ companyId: empresaB, customerId: clienteB });

    const resposta = await request(app).get('/api/orders').set('Cookie', cookieOperador);
    expect(resposta.status).toBe(200);
    expect(resposta.body.total).toBe(1);
  });

  it('filters by status', async () => {
    await criarEncomenda({ companyId: empresaA, customerId: clienteA, status: 'CRIADO' });
    await criarEncomenda({ companyId: empresaA, customerId: clienteA, status: 'ENTREGUE',
      driverId: await criarMotorista({ companyId: empresaA }) });

    const resposta = await request(app)
      .get('/api/orders?status=ENTREGUE')
      .set('Cookie', cookieOperador);
    expect(resposta.body.total).toBe(1);
    expect(resposta.body.items[0].status).toBe('ENTREGUE');
  });

  it('rejects a status that is not part of the vocabulary', async () => {
    const resposta = await request(app)
      .get('/api/orders?status=INVENTADO')
      .set('Cookie', cookieOperador);
    expect(resposta.status).toBe(400);
  });

  it('searches by code and by customer name', async () => {
    const { code } = await criarEncomenda({ companyId: empresaA, customerId: clienteA });

    const porCodigo = await request(app)
      .get(`/api/orders?search=${code}`)
      .set('Cookie', cookieOperador);
    expect(porCodigo.body.total).toBe(1);

    const porNome = await request(app).get('/api/orders?search=Cliente A').set('Cookie', cookieOperador);
    expect(porNome.body.total).toBe(1);
  });

  it('marks an order past its due date as late, and a finished one as not', async () => {
    const passado = new Date(Date.now() - 60 * 60 * 1000);
    await criarEncomenda({ companyId: empresaA, customerId: clienteA, expectedAt: passado });
    await criarEncomenda({
      companyId: empresaA,
      customerId: clienteA,
      status: 'ENTREGUE',
      driverId: await criarMotorista({ companyId: empresaA }),
      expectedAt: passado,
    });

    const resposta = await request(app).get('/api/orders?late=true').set('Cookie', cookieOperador);
    expect(resposta.body.total).toBe(1);
    expect(resposta.body.items[0].late).toBe(true);
  });

  it('paginates', async () => {
    for (let i = 0; i < 3; i += 1) {
      await criarEncomenda({ companyId: empresaA, customerId: clienteA });
    }
    const resposta = await request(app)
      .get('/api/orders?page=2&pageSize=2')
      .set('Cookie', cookieOperador);
    expect(resposta.body.total).toBe(3);
    expect(resposta.body.items).toHaveLength(1);
  });
});

describe('GET /api/orders/:id', () => {
  it('reports an order of another company as missing, never as forbidden', async () => {
    const clienteB = await criarCliente({ companyId: empresaB });
    const outra = await criarEncomenda({ companyId: empresaB, customerId: clienteB });

    const resposta = await request(app).get(`/api/orders/${outra.id}`).set('Cookie', cookieOperador);
    expect(resposta.status).toBe(404);
  });

  it('refuses an id that is not a uuid', async () => {
    const resposta = await request(app).get('/api/orders/nao-e-uuid').set('Cookie', cookieOperador);
    expect(resposta.status).toBe(400);
  });
});

describe('POST /api/orders/:id/assign', () => {
  const prepararPronta = async () => {
    const encomenda = await criarEncomenda({
      companyId: empresaA,
      customerId: clienteA,
      status: 'PRONTO',
    });
    return encomenda;
  };

  it('assigns an available driver and moves the order to ATRIBUIDO', async () => {
    const encomenda = await prepararPronta();
    const motorista = await criarMotorista({ companyId: empresaA, name: 'Sílvia' });

    const resposta = await request(app)
      .post(`/api/orders/${encomenda.id}/assign`)
      .set('Cookie', cookieOperador)
      .send({ driverId: motorista });

    expect(resposta.status).toBe(200);
    expect(resposta.body.order.status).toBe('ATRIBUIDO');
    expect(resposta.body.order.driverName).toBe('Sílvia');
    expect(resposta.body.order.history.at(-1).note).toContain('Sílvia');
  });

  it('refuses a driver who is already carrying a parcel, and says why', async () => {
    const motorista = await criarMotorista({ companyId: empresaA, name: 'Manuel' });
    await criarEncomenda({
      companyId: empresaA,
      customerId: clienteA,
      status: 'EM_ENTREGA',
      driverId: motorista,
    });

    const encomenda = await prepararPronta();
    const resposta = await request(app)
      .post(`/api/orders/${encomenda.id}/assign`)
      .set('Cookie', cookieOperador)
      .send({ driverId: motorista });

    expect(resposta.status).toBe(409);
    expect(resposta.body.error.message).toContain('Manuel');
    expect(resposta.body.error.message).toContain('activa');
  });

  it('gives the same driver to only one of two simultaneous assignments', async () => {
    const [uma, outra] = await Promise.all([prepararPronta(), prepararPronta()]);
    const motorista = await criarMotorista({ companyId: empresaA, name: 'Disputado' });

    const atribuir = (orderId: string) =>
      request(app)
        .post(`/api/orders/${orderId}/assign`)
        .set('Cookie', cookieOperador)
        .send({ driverId: motorista });

    // Both requests read the driver as free before either writes. Only the unique
    // index decides this one, and the loser must still get a sentence an operator
    // can act on rather than a 500.
    const respostas = await Promise.all([atribuir(uma.id), atribuir(outra.id)]);
    const codigos = respostas.map((r) => r.status).sort();

    expect(codigos).toEqual([200, 409]);
    const recusada = respostas.find((r) => r.status === 409);
    expect(recusada?.body.error.message).toContain('activa');
  });

  it('refuses a driver who is off duty', async () => {
    const encomenda = await prepararPronta();
    const motorista = await criarMotorista({ companyId: empresaA, status: 'OFFLINE' });

    const resposta = await request(app)
      .post(`/api/orders/${encomenda.id}/assign`)
      .set('Cookie', cookieOperador)
      .send({ driverId: motorista });

    expect(resposta.status).toBe(409);
    expect(resposta.body.error.message).toContain('offline');
  });

  it('refuses a driver from another company as if he did not exist', async () => {
    const encomenda = await prepararPronta();
    const motoristaB = await criarMotorista({ companyId: empresaB });

    const resposta = await request(app)
      .post(`/api/orders/${encomenda.id}/assign`)
      .set('Cookie', cookieOperador)
      .send({ driverId: motoristaB });

    expect(resposta.status).toBe(404);
  });

  it('refuses to assign an order that is not ready yet', async () => {
    const encomenda = await criarEncomenda({
      companyId: empresaA,
      customerId: clienteA,
      status: 'CRIADO',
    });
    const motorista = await criarMotorista({ companyId: empresaA });

    const resposta = await request(app)
      .post(`/api/orders/${encomenda.id}/assign`)
      .set('Cookie', cookieOperador)
      .send({ driverId: motorista });

    expect(resposta.status).toBe(409);
    expect(resposta.body.error.code).toBe('INVALID_STATE_TRANSITION');

    // Nothing was written: the order is untouched and no driver is attached.
    const { rows } = await query<{ status: string; driver_id: string | null }>(
      'SELECT status, driver_id FROM orders WHERE id = $1',
      [encomenda.id],
    );
    expect(rows[0]).toEqual({ status: 'CRIADO', driver_id: null });
  });
});

describe('POST /api/orders/:id/status', () => {
  it('walks an order from creation to delivery, recording each step', async () => {
    const criada = await criarPeloApi();
    const orderId = criada.body.order.id as string;
    const motorista = await criarMotorista({ companyId: empresaA });

    const passo = async (status: string) =>
      request(app)
        .post(`/api/orders/${orderId}/status`)
        .set('Cookie', cookieOperador)
        .send({ status });

    expect((await passo('CONFIRMADO')).status).toBe(200);
    expect((await passo('PREPARANDO')).status).toBe(200);
    expect((await passo('PRONTO')).status).toBe(200);

    await request(app)
      .post(`/api/orders/${orderId}/assign`)
      .set('Cookie', cookieOperador)
      .send({ driverId: motorista });

    expect((await passo('RECOLHIDO')).status).toBe(200);
    expect((await passo('EM_ENTREGA')).status).toBe(200);

    // A delivery needs something behind it, so the proof comes before the claim.
    expect((await anexarProva(app, cookieOperador, orderId)).status).toBe(201);

    const entregue = await passo('ENTREGUE');
    expect(entregue.status).toBe(200);
    expect(entregue.body.order.status).toBe('ENTREGUE');
    expect(entregue.body.order.completedAt).toBeDefined();
    expect(entregue.body.order.allowedTransitions).toEqual([]);
    // CRIADO plus seven moves.
    expect(entregue.body.order.history).toHaveLength(8);

    // The driver is free again once the parcel is delivered.
    const { rows } = await query<{ status: string }>('SELECT status FROM drivers WHERE id = $1', [
      motorista,
    ]);
    expect(rows[0]?.status).toBe('DISPONIVEL');
  });

  it('refuses a jump the state machine does not allow and explains the options', async () => {
    const encomenda = await criarEncomenda({ companyId: empresaA, customerId: clienteA });

    const resposta = await request(app)
      .post(`/api/orders/${encomenda.id}/status`)
      .set('Cookie', cookieOperador)
      .send({ status: 'ENTREGUE' });

    expect(resposta.status).toBe(409);
    expect(resposta.body.error.message).toContain('CONFIRMADO');
  });

  it('refuses to cancel an order a driver is already carrying', async () => {
    const motorista = await criarMotorista({ companyId: empresaA });
    const encomenda = await criarEncomenda({
      companyId: empresaA,
      customerId: clienteA,
      status: 'EM_ENTREGA',
      driverId: motorista,
    });

    const resposta = await request(app)
      .post(`/api/orders/${encomenda.id}/status`)
      .set('Cookie', cookieOperador)
      .send({ status: 'CANCELADO' });

    expect(resposta.status).toBe(409);
  });

  it('keeps the note that explains a failed delivery', async () => {
    const motorista = await criarMotorista({ companyId: empresaA });
    const encomenda = await criarEncomenda({
      companyId: empresaA,
      customerId: clienteA,
      status: 'EM_ENTREGA',
      driverId: motorista,
    });

    const resposta = await request(app)
      .post(`/api/orders/${encomenda.id}/status`)
      .set('Cookie', cookieOperador)
      .send({ status: 'FALHA_ENTREGA', note: 'Ninguém no local, cliente não atende.' });

    expect(resposta.status).toBe(200);
    expect(resposta.body.order.history.at(-1).note).toContain('Ninguém no local');
    expect(resposta.body.order.allowedTransitions).toEqual(['EM_ENTREGA', 'DEVOLVIDO']);
  });

  it('lets a driver move only his own parcel', async () => {
    const contaMotorista = await criarUtilizador({ companyId: empresaA, role: 'MOTORISTA' });
    const motoristaProprio = await criarMotorista({
      companyId: empresaA,
      userId: contaMotorista.id,
      status: 'EM_ENTREGA',
    });
    const outroMotorista = await criarMotorista({ companyId: empresaA, status: 'EM_ENTREGA' });
    const cookie = await iniciarSessao(app, contaMotorista.email);

    const minha = await criarEncomenda({
      companyId: empresaA,
      customerId: clienteA,
      status: 'EM_ENTREGA',
      driverId: motoristaProprio,
    });
    const alheia = await criarEncomenda({
      companyId: empresaA,
      customerId: clienteA,
      status: 'EM_ENTREGA',
      driverId: outroMotorista,
    });

    expect((await anexarProva(app, cookie, minha.id)).status).toBe(201);

    const propria = await request(app)
      .post(`/api/orders/${minha.id}/status`)
      .set('Cookie', cookie)
      .send({ status: 'ENTREGUE' });
    expect(propria.status).toBe(200);

    const doOutro = await request(app)
      .post(`/api/orders/${alheia.id}/status`)
      .set('Cookie', cookie)
      .send({ status: 'ENTREGUE' });
    // Refused for whose it is, not for what it is missing: the answer must not say
    // anything about the state of a parcel that is not his.
    expect(doOutro.status).toBe(403);
  });

  it('refuses a driver from another company entirely', async () => {
    const clienteB = await criarCliente({ companyId: empresaB });
    const outra = await criarEncomenda({ companyId: empresaB, customerId: clienteB });

    const resposta = await request(app)
      .post(`/api/orders/${outra.id}/status`)
      .set('Cookie', cookieOperador)
      .send({ status: 'CONFIRMADO' });

    expect(resposta.status).toBe(404);
  });

  it('writes an audit entry for each accepted change', async () => {
    const encomenda = await criarEncomenda({ companyId: empresaA, customerId: clienteA });
    await request(app)
      .post(`/api/orders/${encomenda.id}/status`)
      .set('Cookie', cookieOperador)
      .send({ status: 'CONFIRMADO' });

    const { rows } = await query<{ action: string; resource_id: string }>(
      "SELECT action, resource_id FROM audit_logs WHERE action <> 'LOGIN'",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.resource_id).toBe(encomenda.id);
  });
});

describe('customers and drivers', () => {
  it('creates a customer and normalises the phone number', async () => {
    const resposta = await request(app)
      .post('/api/customers')
      .set('Cookie', cookieOperador)
      .send({
        name: 'Farmácia Central',
        phone: '923 456 789',
        address: { description: 'Rua 1', municipality: 'Maianga' },
      });

    expect(resposta.status).toBe(201);
    expect(resposta.body.customer.phone).toBe('+244923456789');
    expect(resposta.body.customer.address.province).toBe('Luanda');
  });

  it('refuses a second customer with the same phone number', async () => {
    const corpo = {
      name: 'Loja A',
      phone: '+244923456789',
      address: { description: 'Rua 1', municipality: 'Maianga' },
    };
    await request(app).post('/api/customers').set('Cookie', cookieOperador).send(corpo);
    const repetido = await request(app)
      .post('/api/customers')
      .set('Cookie', cookieOperador)
      .send(corpo);

    expect(repetido.status).toBe(409);
    expect(repetido.body.error.message).toContain('telefone');
  });

  it('never lists customers of another company', async () => {
    await criarCliente({ companyId: empresaB, name: 'Cliente da B' });
    const resposta = await request(app).get('/api/customers').set('Cookie', cookieOperador);
    const nomes = resposta.body.items.map((item: { name: string }) => item.name);
    expect(nomes).not.toContain('Cliente da B');
  });

  it('refuses to take a driver off duty while he is carrying a parcel', async () => {
    const motorista = await criarMotorista({ companyId: empresaA, status: 'EM_ENTREGA' });
    await criarEncomenda({
      companyId: empresaA,
      customerId: clienteA,
      status: 'EM_ENTREGA',
      driverId: motorista,
    });

    const resposta = await request(app)
      .patch(`/api/drivers/${motorista}`)
      .set('Cookie', cookieOperador)
      .send({ status: 'OFFLINE' });

    expect(resposta.status).toBe(409);
    expect(resposta.body.error.message).toContain('activa');
  });

  it('lets an idle driver go off duty', async () => {
    const motorista = await criarMotorista({ companyId: empresaA });
    const resposta = await request(app)
      .patch(`/api/drivers/${motorista}`)
      .set('Cookie', cookieOperador)
      .send({ status: 'OFFLINE' });

    expect(resposta.status).toBe(200);
    expect(resposta.body.driver.status).toBe('OFFLINE');
  });

  it('only offers available drivers for assignment', async () => {
    await criarMotorista({ companyId: empresaA, name: 'Livre' });
    await criarMotorista({ companyId: empresaA, name: 'Fora', status: 'OFFLINE' });
    await criarMotorista({ companyId: empresaB, name: 'Da outra empresa' });

    const resposta = await request(app)
      .get('/api/drivers/available')
      .set('Cookie', cookieOperador);

    const nomes = resposta.body.items.map((item: { name: string }) => item.name);
    expect(nomes).toEqual(['Livre']);
  });
});

describe('dashboard', () => {
  it('counts only the caller company and fills every day of the window', async () => {
    const motorista = await criarMotorista({ companyId: empresaA });
    await criarEncomenda({ companyId: empresaA, customerId: clienteA });
    await criarEncomenda({
      companyId: empresaA,
      customerId: clienteA,
      status: 'EM_ENTREGA',
      driverId: motorista,
    });
    const clienteB = await criarCliente({ companyId: empresaB });
    await criarEncomenda({ companyId: empresaB, customerId: clienteB });

    const resposta = await request(app).get('/api/dashboard').set('Cookie', cookieOperador);

    expect(resposta.status).toBe(200);
    expect(resposta.body.ordersToday).toBe(2);
    expect(resposta.body.inDelivery).toBe(1);
    expect(resposta.body.perDay).toHaveLength(14);
    expect(resposta.body.recent).toHaveLength(2);
  });

  it('counts the day as Luanda counts it, not as UTC does', async () => {
    await criarEncomenda({ companyId: empresaA, customerId: clienteA });

    const resposta = await request(app).get('/api/dashboard').set('Cookie', cookieOperador);

    // Between 23:00 and midnight in Luanda, UTC is already on the next date. The
    // last bucket of the chart must be the day an operator in Luanda calls today,
    // and the order just created must be inside it — otherwise the KPI and the
    // chart contradict each other for an hour every night.
    const hojeEmLuanda = new Date()
      .toLocaleDateString('en-CA', { timeZone: 'Africa/Luanda' });
    const ultimo = resposta.body.perDay.at(-1);

    expect(ultimo.day).toBe(hojeEmLuanda);
    expect(ultimo.count).toBeGreaterThanOrEqual(1);
    expect(resposta.body.ordersToday).toBe(ultimo.count);
  });
});
