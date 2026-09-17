import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Socket as SocketCliente } from 'socket.io-client';
import { createApp } from '../src/app.js';
import { closePool, query } from '../src/config/database.js';
import {
  criarCliente,
  criarEmpresa,
  criarEncomenda,
  criarMotorista,
  criarUtilizador,
  iniciarSessao,
  limparBase,
} from './helpers/fixtures.js';
import { arrancar, esperarEvento, ligarCliente, naoChegou, type Ambiente } from './helpers/realtime.js';

const app = createApp();

const TALATONA = { latitude: -8.9167, longitude: 13.1833 };

let ambiente: Ambiente;
let empresaA: string;
let empresaB: string;
let clienteA: string;
let cookieOperador: string;
const abertos: SocketCliente[] = [];

const ligar = async (cookie?: string) => {
  const { socket, pronto } = await ligarCliente(ambiente, cookie);
  abertos.push(socket);
  return { socket, pronto };
};

beforeEach(async () => {
  await limparBase();
  ambiente = await arrancar(app);

  empresaA = await criarEmpresa('Karga A');
  empresaB = await criarEmpresa('Karga B');
  clienteA = await criarCliente({ companyId: empresaA, name: 'Cliente A' });

  const operador = await criarUtilizador({ companyId: empresaA, role: 'OPERADOR', name: 'Bia Op' });
  cookieOperador = await iniciarSessao(app, operador.email);
});

afterEach(async () => {
  for (const socket of abertos.splice(0)) socket.close();
  await ambiente.fechar();
});

afterAll(async () => {
  await closePool();
});

describe('realtime handshake', () => {
  it('refuses a socket with no session', async () => {
    await expect(ligar()).rejects.toThrow('UNAUTHENTICATED');
  });

  it('refuses a socket whose cookie is not a session', async () => {
    await expect(ligar('karga_session=nao-e-um-token-valido-mas-tem-tamanho')).rejects.toThrow(
      'UNAUTHENTICATED',
    );
  });

  it('accepts the same cookie the API accepts', async () => {
    const { pronto } = await ligar(cookieOperador);
    expect(pronto.role).toBe('OPERADOR');
  });

  it('refuses a driver account with no driver row', async () => {
    const orfao = await criarUtilizador({ companyId: empresaA, role: 'MOTORISTA' });
    // Failing closed: a session whose scope cannot be resolved gets no feed at all,
    // rather than the company's.
    await expect(ligar(await iniciarSessao(app, orfao.email))).rejects.toThrow('SEM_AMBITO');
  });

  it('drops a socket whose session was revoked elsewhere', async () => {
    const conta = await criarUtilizador({ companyId: empresaA, role: 'OPERADOR' });
    const cookie = await iniciarSessao(app, conta.email);
    const { socket } = await ligar(cookie);

    const terminada = esperarEvento(socket, 'sessao:terminada');
    await request(app).post('/api/auth/logout').set('Cookie', cookie);

    // Logging out in one tab has to close the socket in the others. A session that
    // was taken back must stop working now, which is the whole reason sessions live
    // in the database instead of a self-contained token.
    await terminada;
    await new Promise((resolver) => setTimeout(resolver, 100));
    expect(socket.connected).toBe(false);
  });
});

describe('order events', () => {
  it('tells the operators when an order changes state', async () => {
    const { socket } = await ligar(cookieOperador);
    const encomenda = await criarEncomenda({ companyId: empresaA, customerId: clienteA });

    const chegada = esperarEvento<{ motivo: string; order: { code: string; status: string } }>(
      socket,
      'encomenda:actualizada',
    );

    await request(app)
      .post(`/api/orders/${encomenda.id}/status`)
      .set('Cookie', cookieOperador)
      .send({ status: 'CONFIRMADO' });

    const evento = await chegada;
    expect(evento.motivo).toBe('estado');
    expect(evento.order).toMatchObject({ code: encomenda.code, status: 'CONFIRMADO' });
  });

  it('never leaks an event to another company', async () => {
    const operadorB = await criarUtilizador({ companyId: empresaB, role: 'OPERADOR' });
    const { socket } = await ligar(await iniciarSessao(app, operadorB.email));
    const encomenda = await criarEncomenda({ companyId: empresaA, customerId: clienteA });

    await request(app)
      .post(`/api/orders/${encomenda.id}/status`)
      .set('Cookie', cookieOperador)
      .send({ status: 'CONFIRMADO' });

    expect(await naoChegou(socket, 'encomenda:actualizada')).toBe(true);
  });

  it('tells the assigned driver by name, and only him', async () => {
    const conta = await criarUtilizador({ companyId: empresaA, role: 'MOTORISTA', name: 'Manuel' });
    const motorista = await criarMotorista({ companyId: empresaA, userId: conta.id });

    const outraConta = await criarUtilizador({ companyId: empresaA, role: 'MOTORISTA' });
    await criarMotorista({ companyId: empresaA, userId: outraConta.id, name: 'Sílvia' });

    const { socket: dele } = await ligar(await iniciarSessao(app, conta.email));
    const { socket: doOutro } = await ligar(await iniciarSessao(app, outraConta.email));

    const encomenda = await criarEncomenda({
      companyId: empresaA,
      customerId: clienteA,
      status: 'PRONTO',
    });

    const aviso = esperarEvento<{ tipo: string; mensagem: string }>(dele, 'aviso');

    await request(app)
      .post(`/api/orders/${encomenda.id}/assign`)
      .set('Cookie', cookieOperador)
      .send({ driverId: motorista });

    const recebido = await aviso;
    expect(recebido.tipo).toBe('entrega:atribuida');
    expect(recebido.mensagem).toContain(encomenda.code);
    // A driver has no business being told about his colleague's work.
    expect(await naoChegou(doOutro, 'aviso')).toBe(true);
  });

  it('tells the customer about their own order and nobody else\'s', async () => {
    const conta = await criarUtilizador({ companyId: empresaA, role: 'CLIENTE' });
    const cliente = await criarCliente({ companyId: empresaA, userId: conta.id, name: 'Luísa' });
    const { socket } = await ligar(await iniciarSessao(app, conta.email));

    const alheia = await criarEncomenda({ companyId: empresaA, customerId: clienteA });
    await request(app)
      .post(`/api/orders/${alheia.id}/status`)
      .set('Cookie', cookieOperador)
      .send({ status: 'CONFIRMADO' });

    expect(await naoChegou(socket, 'encomenda:actualizada')).toBe(true);

    const minha = await criarEncomenda({ companyId: empresaA, customerId: cliente });
    const chegada = esperarEvento<{ order: { code: string } }>(socket, 'encomenda:actualizada');

    await request(app)
      .post(`/api/orders/${minha.id}/status`)
      .set('Cookie', cookieOperador)
      .send({ status: 'CONFIRMADO' });

    expect((await chegada).order.code).toBe(minha.code);
  });

  it('tells the operators when a driver moves his own parcel', async () => {
    const conta = await criarUtilizador({ companyId: empresaA, role: 'MOTORISTA', name: 'Manuel' });
    const motorista = await criarMotorista({ companyId: empresaA, userId: conta.id });
    const encomenda = await criarEncomenda({
      companyId: empresaA,
      customerId: clienteA,
      status: 'ATRIBUIDO',
      driverId: motorista,
    });

    const { socket } = await ligar(cookieOperador);
    const aviso = esperarEvento<{ tipo: string; mensagem: string }>(socket, 'aviso');

    await request(app)
      .post(`/api/orders/${encomenda.id}/status`)
      .set('Cookie', await iniciarSessao(app, conta.email))
      .send({ status: 'RECOLHIDO' });

    const recebido = await aviso;
    expect(recebido.tipo).toBe('entrega:progresso');
    expect(recebido.mensagem).toContain('Manuel');
  });
});

describe('driver positions', () => {
  const posicionar = (socket: SocketCliente, dados: unknown): Promise<{ ok: boolean; message?: string; ignored?: boolean }> =>
    new Promise((resolver) => {
      socket.emit('posicao', dados, resolver);
    });

  const comMotorista = async () => {
    const conta = await criarUtilizador({ companyId: empresaA, role: 'MOTORISTA', name: 'Manuel' });
    const motorista = await criarMotorista({ companyId: empresaA, userId: conta.id });
    const { socket } = await ligar(await iniciarSessao(app, conta.email));
    return { socket, motorista };
  };

  it('stores a position and shows it to the operators', async () => {
    const { socket: operador } = await ligar(cookieOperador);
    const { socket, motorista } = await comMotorista();

    const chegada = esperarEvento<{ driverId: string; latitude: number }>(
      operador,
      'motorista:posicao',
    );
    const resposta = await posicionar(socket, { ...TALATONA, accuracyMeters: 12.4 });

    expect(resposta.ok).toBe(true);
    expect(await chegada).toMatchObject({ driverId: motorista, latitude: TALATONA.latitude });

    const { rows } = await query<{ latitude: string; accuracy_meters: number }>(
      'SELECT latitude, accuracy_meters FROM driver_positions WHERE driver_id = $1',
      [motorista],
    );
    expect(Number(rows[0]?.latitude)).toBe(TALATONA.latitude);
    // Accuracy is kept beside the point: a claim with a 2 km radius must be readable
    // as one rather than drawn like a certainty.
    expect(rows[0]?.accuracy_meters).toBe(12);
  });

  it('ties the position to the parcel the driver is carrying', async () => {
    const { socket: operador } = await ligar(cookieOperador);
    const { socket, motorista } = await comMotorista();
    const encomenda = await criarEncomenda({
      companyId: empresaA,
      customerId: clienteA,
      status: 'EM_ENTREGA',
      driverId: motorista,
    });

    const chegada = esperarEvento<{ orderId: string; orderCode: string }>(
      operador,
      'motorista:posicao',
    );
    await posicionar(socket, TALATONA);

    const { rows } = await query<{ order_id: string }>(
      'SELECT order_id FROM driver_positions WHERE driver_id = $1',
      [motorista],
    );
    expect(rows[0]?.order_id).toBe(encomenda.id);

    // The code travels with the id. Without it the map draws a pin that says "sem
    // entrega activa" directly above a link to the delivery.
    expect(await chegada).toMatchObject({ orderId: encomenda.id, orderCode: encomenda.code });
  });

  it('keeps a driver from seeing another driver', async () => {
    const { socket } = await comMotorista();

    const outraConta = await criarUtilizador({ companyId: empresaA, role: 'MOTORISTA' });
    await criarMotorista({ companyId: empresaA, userId: outraConta.id, name: 'Sílvia' });
    const { socket: outro } = await ligar(await iniciarSessao(app, outraConta.email));

    await posicionar(socket, TALATONA);

    expect(await naoChegou(outro, 'motorista:posicao')).toBe(true);
  });

  it('keeps a position inside one company', async () => {
    const operadorB = await criarUtilizador({ companyId: empresaB, role: 'OPERADOR' });
    const { socket: deB } = await ligar(await iniciarSessao(app, operadorB.email));
    const { socket } = await comMotorista();

    await posicionar(socket, TALATONA);

    expect(await naoChegou(deB, 'motorista:posicao')).toBe(true);
  });

  it('refuses a swapped pair, naming the mistake', async () => {
    const { socket, motorista } = await comMotorista();

    const resposta = await posicionar(socket, {
      latitude: TALATONA.longitude,
      longitude: TALATONA.latitude,
    });

    expect(resposta.ok).toBe(false);
    expect(resposta.message).toContain('trocadas');

    const { rows } = await query('SELECT 1 FROM driver_positions WHERE driver_id = $1', [motorista]);
    expect(rows).toHaveLength(0);
  });

  it('refuses a position that is not a pair of numbers', async () => {
    const { socket } = await comMotorista();

    expect((await posicionar(socket, { latitude: 'norte', longitude: 13.2 })).ok).toBe(false);
    expect((await posicionar(socket, null)).ok).toBe(false);
    expect((await posicionar(socket, { latitude: Number.NaN, longitude: 13.2 })).ok).toBe(false);
  });

  it('drops a second position that arrives too soon', async () => {
    const { socket, motorista } = await comMotorista();

    await posicionar(socket, TALATONA);
    const segunda = await posicionar(socket, { latitude: -8.81, longitude: 13.23 });

    // Not an error the driver should be told about — but the write it would cause is
    // worth avoiding, and the stored point must still be the first one.
    expect(segunda).toMatchObject({ ok: true, ignored: true });

    const { rows } = await query<{ latitude: string }>(
      'SELECT latitude FROM driver_positions WHERE driver_id = $1',
      [motorista],
    );
    expect(Number(rows[0]?.latitude)).toBe(TALATONA.latitude);
  });

  it('refuses a position from anyone who is not a driver', async () => {
    const { socket } = await ligar(cookieOperador);

    const resposta = await posicionar(socket, TALATONA);

    expect(resposta.ok).toBe(false);
    expect(resposta.message).toContain('motorista');
  });
});

describe('GET /api/map/operation with positions', () => {
  it('carries the fleet as it stands, so a reconnect does not start empty', async () => {
    const motorista = await criarMotorista({ companyId: empresaA, name: 'Manuel' });
    await query(
      `INSERT INTO driver_positions (driver_id, company_id, latitude, longitude)
       VALUES ($1, $2, $3, $4)`,
      [motorista, empresaA, TALATONA.latitude, TALATONA.longitude],
    );

    const resposta = await request(app).get('/api/map/operation').set('Cookie', cookieOperador);

    expect(resposta.body.drivers).toHaveLength(1);
    expect(resposta.body.drivers[0]).toMatchObject({
      driverName: 'Manuel',
      latitude: TALATONA.latitude,
    });
    expect(resposta.body.positionFreshnessMinutes).toBeGreaterThan(0);
  });

  it('leaves out a position too old to mean anything', async () => {
    const motorista = await criarMotorista({ companyId: empresaA });
    await query(
      `INSERT INTO driver_positions (driver_id, company_id, latitude, longitude, reported_at)
       VALUES ($1, $2, $3, $4, now() - interval '2 hours')`,
      [motorista, empresaA, TALATONA.latitude, TALATONA.longitude],
    );

    const resposta = await request(app).get('/api/map/operation').set('Cookie', cookieOperador);

    // The driver may have finished, gone home, or closed the tab that was reporting.
    expect(resposta.body.drivers).toHaveLength(0);
  });

  it('never carries another company\'s fleet', async () => {
    const motoristaB = await criarMotorista({ companyId: empresaB });
    await query(
      `INSERT INTO driver_positions (driver_id, company_id, latitude, longitude)
       VALUES ($1, $2, $3, $4)`,
      [motoristaB, empresaB, TALATONA.latitude, TALATONA.longitude],
    );

    const resposta = await request(app).get('/api/map/operation').set('Cookie', cookieOperador);

    expect(resposta.body.drivers).toHaveLength(0);
  });

  it('shows a customer no positions at all', async () => {
    const conta = await criarUtilizador({ companyId: empresaA, role: 'CLIENTE' });
    await criarCliente({ companyId: empresaA, userId: conta.id });
    const motorista = await criarMotorista({ companyId: empresaA });
    await query(
      `INSERT INTO driver_positions (driver_id, company_id, latitude, longitude)
       VALUES ($1, $2, $3, $4)`,
      [motorista, empresaA, TALATONA.latitude, TALATONA.longitude],
    );

    const resposta = await request(app)
      .get('/api/map/operation')
      .set('Cookie', await iniciarSessao(app, conta.email));

    // Where the courier is right now is not part of following a parcel.
    expect(resposta.body.drivers).toHaveLength(0);
  });
});
