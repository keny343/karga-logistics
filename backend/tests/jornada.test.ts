import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Socket as SocketCliente } from 'socket.io-client';
import { createApp } from '../src/app.js';
import { closePool, query } from '../src/config/database.js';
import { criarEmpresa, criarUtilizador, iniciarSessao, limparBase } from './helpers/fixtures.js';
import {
  arrancar,
  assentar,
  gravar,
  ligarCliente,
  type Ambiente,
  type Gravador,
} from './helpers/realtime.js';

/**
 * One working afternoon at a carrier in Luanda, played by everybody at once.
 *
 * The other suites test endpoints. This one tests a day: an operator dispatches, a driver
 * reports in from the road, a customer follows her parcel, an admin closes the books -
 * with every session signed in and every socket open at the same time, which is the only
 * arrangement in which the interesting failures happen.
 *
 * Two kinds of bug are only reachable this way.
 *
 * A leak between people who are online together. A rival carrier's operator and a driver
 * with nothing to do with this delivery stay connected from the first line to the last,
 * recording everything they are told, and the test ends by asserting the recordings are
 * empty. A suite that connects one client at a time can never fail that way.
 *
 * A story that stops making sense halfway. Each step asserts against what the previous
 * one produced - the code created is the code assigned, delivered, counted in the report
 * and written in the CSV - so a change that quietly breaks the seam between two features
 * fails here even when both still pass their own tests.
 *
 * The delivery fails on the first attempt and succeeds on the second, because that is
 * what an afternoon looks like and because the retry path is the one nobody walks by hand.
 */

const app = createApp();

/** Where the parcels leave from, and where this one is going. */
const ARMAZEM = {
  description: 'Armazém Karga, Estrada de Cacuaco km 8, pavilhão B',
  municipality: 'Cacuaco',
  latitude: -8.7776,
  longitude: 13.3672,
};
const DESTINO = {
  description: 'Via S8, Edifício Kilamba Center, loja 4',
  municipality: 'Talatona',
  reference: 'Em frente ao Talatona Imperial',
  latitude: -8.9167,
  longitude: 13.1833,
};

/** The road from Cacuaco to Talatona, as a phone would report it. */
const ROTA = [
  { latitude: -8.8125, longitude: 13.232 },
  { latitude: -8.8523, longitude: 13.2101 },
  { latitude: -8.9012, longitude: 13.1902 },
] as const;

interface Pessoa {
  readonly cookie: string;
  readonly socket: SocketCliente;
  readonly gravador: Gravador;
}

let ambiente: Ambiente;
const abertos: SocketCliente[] = [];

/** Signs in over HTTP and opens a socket, exactly as one browser does. */
const entrar = async (email: string): Promise<Pessoa> => {
  const cookie = await iniciarSessao(app, email);
  const { socket } = await ligarCliente(ambiente, cookie);
  abertos.push(socket);
  return { cookie, socket, gravador: gravar(socket) };
};

const hojeEmLuanda = (): string =>
  new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Luanda' });

describe('a working afternoon, with everybody signed in', () => {
  let admin: Pessoa;
  let operador: Pessoa;
  let motorista: Pessoa;
  let cliente: Pessoa;
  /** Connected throughout, and told nothing. */
  let outroMotorista: Pessoa;
  let rival: Pessoa;

  let idMotorista: string;
  let idCliente: string;
  /** The audit trail labels whoever acted by the address they signed in with. */
  let emailOperador: string;
  let emailMotorista: string;

  beforeEach(async () => {
    await limparBase();
    ambiente = await arrancar(app);

    const karga = await criarEmpresa('Karga Logistics Luanda');
    const concorrente = await criarEmpresa('Transportes Rivais');

    const contaAdmin = await criarUtilizador({
      companyId: karga,
      role: 'ADMIN',
      name: 'Adnírcio Inocêncio',
    });
    const contaOperador = await criarUtilizador({
      companyId: karga,
      role: 'OPERADOR',
      name: 'Beatriz Kiala',
    });
    const contaMotorista = await criarUtilizador({
      companyId: karga,
      role: 'MOTORISTA',
      name: 'Manuel Cardoso',
    });
    const contaCliente = await criarUtilizador({
      companyId: karga,
      role: 'CLIENTE',
      name: 'Luísa Domingos',
    });
    const contaOutroMotorista = await criarUtilizador({
      companyId: karga,
      role: 'MOTORISTA',
      name: 'Sílvia Neto',
    });
    const contaRival = await criarUtilizador({
      companyId: concorrente,
      role: 'OPERADOR',
      name: 'Operador Rival',
    });

    emailOperador = contaOperador.email;
    emailMotorista = contaMotorista.email;

    admin = await entrar(contaAdmin.email);
    operador = await entrar(contaOperador.email);

    // The operator registers the driver and the customer through the API, as she did on
    // the day each of them joined.
    const motoristaCriado = await request(app)
      .post('/api/drivers')
      .set('Cookie', operador.cookie)
      .send({
        name: 'Manuel Cardoso',
        phone: '+244924111000',
        vehicleType: 'MOTA',
        vehiclePlate: 'LD-42-19-MA',
      });
    expect(motoristaCriado.status).toBe(201);
    idMotorista = motoristaCriado.body.driver.id;

    const clienteCriado = await request(app)
      .post('/api/customers')
      .set('Cookie', operador.cookie)
      .send({ name: 'Luísa Domingos', phone: '+244923555111', address: DESTINO });
    expect(clienteCriado.status).toBe(201);
    idCliente = clienteCriado.body.customer.id;

    const outroCriado = await request(app)
      .post('/api/drivers')
      .set('Cookie', operador.cookie)
      .send({ name: 'Sílvia Neto', phone: '+244924222000' });

    // Attaching a login to the record it may read is done in SQL because there is no
    // endpoint for it yet. Saying so is better than inventing one here and implying the
    // product has it.
    await query('UPDATE drivers SET user_id = $2 WHERE id = $1', [idMotorista, contaMotorista.id]);
    await query('UPDATE drivers SET user_id = $2 WHERE id = $1', [
      outroCriado.body.driver.id,
      contaOutroMotorista.id,
    ]);
    await query('UPDATE customers SET user_id = $2 WHERE id = $1', [idCliente, contaCliente.id]);

    motorista = await entrar(contaMotorista.email);
    cliente = await entrar(contaCliente.email);
    outroMotorista = await entrar(contaOutroMotorista.email);
    rival = await entrar(contaRival.email);
  });

  afterEach(async () => {
    for (const socket of abertos.splice(0)) socket.close();
    await ambiente.fechar();
  });

  afterAll(async () => {
    await closePool();
  });

  it('carries one parcel to the customer, and tells each person only their part', async () => {
    // -------------------------------------------------------------- 14:00, at the counter
    const criada = await request(app)
      .post('/api/orders')
      .set('Cookie', operador.cookie)
      .send({
        customerId: idCliente,
        description: 'Duas caixas de medicamentos, refrigeradas',
        weightGrams: 8400,
        valueCents: 7_400_000,
        origin: ARMAZEM,
        destination: DESTINO,
        expectedAt: new Date(Date.now() + 4 * 3_600_000).toISOString(),
        notes: 'Entregar ao balcão da farmácia, não à portaria.',
      });

    expect(criada.status).toBe(201);
    const encomenda: { id: string; code: string } = criada.body.order;

    // The operator sees it appear, and so does the customer whose parcel it is.
    await operador.gravador.ate('a encomenda a aparecer na operação', (g) =>
      g
        .de<{ order: { code: string } }>('encomenda:actualizada')
        .some((evento) => evento.order.code === encomenda.code),
    );
    await cliente.gravador.ate('a cliente a saber que a encomenda existe', (g) =>
      g.quantos('encomenda:actualizada') === 1,
    );
    expect(operador.gravador.de<{ motivo: string }>('encomenda:actualizada')[0]?.motivo).toBe(
      'criada',
    );
    // Nobody is carrying it yet, so no driver has been told a thing.
    expect(motorista.gravador.tudo).toHaveLength(0);

    // ------------------------------------------------- 14:10, the warehouse does its part
    for (const estado of ['CONFIRMADO', 'PREPARANDO', 'PRONTO'] as const) {
      const passo = await request(app)
        .post(`/api/orders/${encomenda.id}/status`)
        .set('Cookie', operador.cookie)
        .send({ status: estado });
      expect(passo.status).toBe(200);
      expect(passo.body.order.status).toBe(estado);
    }

    // ------------------------------------------------------------------ 14:25, dispatch
    const atribuida = await request(app)
      .post(`/api/orders/${encomenda.id}/assign`)
      .set('Cookie', operador.cookie)
      .send({ driverId: idMotorista });

    expect(atribuida.status).toBe(200);
    expect(atribuida.body.order.driverName).toBe('Manuel Cardoso');

    // The driver is told what he needs in order to leave: the parcel, who it is for, and
    // where it goes.
    await motorista.gravador.ate('o aviso da nova entrega', (g) => g.quantos('aviso') === 1);
    const aviso = motorista.gravador.de<{ tipo: string; mensagem: string; orderId: string }>(
      'aviso',
    )[0];
    expect(aviso?.tipo).toBe('entrega:atribuida');
    expect(aviso?.mensagem).toContain(encomenda.code);
    expect(aviso?.mensagem).toContain('Luísa Domingos');
    expect(aviso?.mensagem).toContain('Talatona');
    expect(aviso?.orderId).toBe(encomenda.id);

    // ------------------------------------------------------------- 14:30, on the road
    const posicionar = (ponto: { latitude: number; longitude: number }) =>
      new Promise<{ ok: boolean; ignored?: boolean; message?: string }>((resolver) => {
        motorista.socket.emit('posicao', { ...ponto, accuracyMeters: 18 }, resolver);
      });

    expect((await posicionar(ROTA[0])).ok).toBe(true);

    // A phone reporting again immediately is not an error worth telling him about, and
    // the write it would cause is worth avoiding.
    expect(await posicionar(ROTA[0])).toMatchObject({ ok: true, ignored: true });

    await operador.gravador.ate('a posição do motorista na central', (g) =>
      g.quantos('motorista:posicao') === 1,
    );
    const reportada = operador.gravador.de<{
      driverName: string;
      orderCode: string;
      accuracyMeters: number;
    }>('motorista:posicao')[0];
    expect(reportada?.driverName).toBe('Manuel Cardoso');
    // The point arrives beside the parcel it belongs to, and beside how wide a circle the
    // phone admitted to.
    expect(reportada?.orderCode).toBe(encomenda.code);
    expect(reportada?.accuracyMeters).toBe(18);

    // The map the operator has open carries him, with the parcel named.
    const mapaOperador = await request(app)
      .get('/api/map/operation')
      .set('Cookie', operador.cookie);
    expect(mapaOperador.body.drivers).toHaveLength(1);
    expect(mapaOperador.body.drivers[0]).toMatchObject({
      driverName: 'Manuel Cardoso',
      orderCode: encomenda.code,
    });
    expect(mapaOperador.body.items.map((item: { code: string }) => item.code)).toContain(
      encomenda.code,
    );

    // The customer's map shows where her parcel is going and no courier: following a
    // delivery is not watching a person move.
    const mapaCliente = await request(app).get('/api/map/operation').set('Cookie', cliente.cookie);
    expect(mapaCliente.body.items).toHaveLength(1);
    expect(mapaCliente.body.drivers).toHaveLength(0);

    // ------------------------------------------------------ 14:40, he collects the parcel
    const recolhida = await request(app)
      .post(`/api/orders/${encomenda.id}/status`)
      .set('Cookie', motorista.cookie)
      .send({ status: 'RECOLHIDO' });
    expect(recolhida.status).toBe(200);

    await operador.gravador.ate('a central a saber que ele recolheu', (g) =>
      g.de<{ tipo: string }>('aviso').some((a) => a.tipo === 'entrega:progresso'),
    );

    await request(app)
      .post(`/api/orders/${encomenda.id}/status`)
      .set('Cookie', motorista.cookie)
      .send({ status: 'EM_ENTREGA' });

    for (const ponto of ROTA.slice(1)) {
      // Past the gap the server enforces, as a phone on the road would be.
      await assentar(3_100);
      expect((await posicionar(ponto)).ok).toBe(true);
    }

    // ------------------------------------------- 15:05, nobody at the counter to sign for it
    const falhou = await request(app)
      .post(`/api/orders/${encomenda.id}/status`)
      .set('Cookie', motorista.cookie)
      .send({ status: 'FALHA_ENTREGA', note: 'Farmácia fechada para almoço, volto às 15h30.' });
    expect(falhou.status).toBe(200);

    // A failed delivery is the one an operator has to act on rather than notice.
    await operador.gravador.ate('o aviso da falha', (g) =>
      g.de<{ tipo: string }>('aviso').some((a) => a.tipo === 'entrega:falhou'),
    );

    // ---------------------------------------------------- 15:35, the second attempt works
    await request(app)
      .post(`/api/orders/${encomenda.id}/status`)
      .set('Cookie', motorista.cookie)
      .send({ status: 'EM_ENTREGA' });

    const entregue = await request(app)
      .post(`/api/orders/${encomenda.id}/status`)
      .set('Cookie', motorista.cookie)
      .send({ status: 'ENTREGUE', note: 'Entregue ao balcão, recebido por D. Rosa.' });

    expect(entregue.status).toBe(200);
    expect(entregue.body.order.status).toBe('ENTREGUE');
    expect(entregue.body.order.completedAt).toBeDefined();

    // The same "delivered" arriving twice from a phone on a weak connection must not be
    // written twice.
    const repetido = await request(app)
      .post(`/api/orders/${encomenda.id}/status`)
      .set('Cookie', motorista.cookie)
      .send({ status: 'ENTREGUE' });
    expect(repetido.status).toBe(409);
    expect(repetido.body.error.code).toBe('INVALID_STATE_TRANSITION');

    // ------------------------------------------------ what each person can see afterwards
    const paraCliente = await request(app).get('/api/orders').set('Cookie', cliente.cookie);
    expect(paraCliente.body.items).toHaveLength(1);
    expect(paraCliente.body.items[0].code).toBe(encomenda.code);

    const detalhe = await request(app)
      .get(`/api/orders/${encomenda.id}`)
      .set('Cookie', cliente.cookie);
    // She reads the whole path her parcel took, the failed attempt and its reason
    // included: hiding it would make the delivery look tidier than it was.
    const historia = detalhe.body.order.history as { status: string; note?: string }[];
    expect(historia.map((linha) => linha.status)).toEqual([
      'CRIADO',
      'CONFIRMADO',
      'PREPARANDO',
      'PRONTO',
      'ATRIBUIDO',
      'RECOLHIDO',
      'EM_ENTREGA',
      'FALHA_ENTREGA',
      'EM_ENTREGA',
      'ENTREGUE',
    ]);
    expect(historia.at(-1)?.note).toContain('D. Rosa');

    // The rival carrier cannot even discover that the id exists.
    const paraRival = await request(app)
      .get(`/api/orders/${encomenda.id}`)
      .set('Cookie', rival.cookie);
    expect(paraRival.status).toBe(404);

    // A delivered parcel leaves the map, and its destination can no longer be moved:
    // where it went is history now.
    const mapaDepois = await request(app).get('/api/map/operation').set('Cookie', operador.cookie);
    expect(mapaDepois.body.items).toHaveLength(0);

    const tentarMover = await request(app)
      .patch(`/api/orders/${encomenda.id}/coordinates`)
      .set('Cookie', operador.cookie)
      .send({ latitude: -8.9, longitude: 13.19 });
    expect(tentarMover.status).toBe(409);

    // ------------------------------------------------------ 18:00, the admin closes up
    const hoje = hojeEmLuanda();
    const relatorio = await request(app)
      .get('/api/reports/summary')
      .query({ from: hoje, to: hoje })
      .set('Cookie', admin.cookie);

    expect(relatorio.status).toBe(200);
    expect(relatorio.body.totals).toMatchObject({ created: 1, delivered: 1, completed: 1 });
    // One delivery, delivered. The failed attempt was an attempt, not a failed order.
    expect(relatorio.body.totals.successRate).toBe(100);
    expect(relatorio.body.byDriver[0]).toMatchObject({
      driverName: 'Manuel Cardoso',
      assigned: 1,
      delivered: 1,
    });
    expect(relatorio.body.byMunicipality[0]).toMatchObject({ municipality: 'Talatona' });

    const csv = await request(app)
      .get('/api/reports/orders.csv')
      .query({ from: hoje, to: hoje })
      .set('Cookie', admin.cookie);

    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.text).toContain(encomenda.code);
    expect(csv.text).toContain('Manuel Cardoso');

    // ------------------------------------------------------- the trail the day left behind
    const { rows: auditoria } = await query<{ action: string; actor_label: string }>(
      `SELECT action, actor_label FROM audit_logs
        WHERE resource_id = $1 ORDER BY created_at, id`,
      [encomenda.id],
    );
    expect(auditoria.map((linha) => linha.action)).toEqual([
      'ORDER_CREATED',
      // The three warehouse steps have no name of their own in the trail and do not need
      // one: the status is in the metadata, and the history carries the detail.
      'ORDER_UPDATED',
      'ORDER_UPDATED',
      'ORDER_UPDATED',
      'ORDER_ASSIGNED',
      'DELIVERY_PICKED_UP',
      'DELIVERY_STARTED',
      'DELIVERY_FAILED',
      'DELIVERY_STARTED',
      'DELIVERY_COMPLETED',
    ]);
    // Who did it, not only what happened: the dispatch is hers, the road is his.
    expect(auditoria[4]?.actor_label).toBe(emailOperador);
    expect(auditoria.at(-1)?.actor_label).toBe(emailMotorista);

    // --------------------------------------------- the two who should have heard nothing
    await assentar();

    // A driver has no business knowing where a colleague is or what he is carrying.
    expect(outroMotorista.gravador.tudo).toEqual([]);
    // And the rival carrier, connected the whole afternoon, was told nothing at all.
    expect(rival.gravador.tudo).toEqual([]);

    // The customer heard about her own parcel, and never about a position.
    expect(cliente.gravador.quantos('motorista:posicao')).toBe(0);
    expect(cliente.gravador.quantos('encomenda:actualizada')).toBeGreaterThan(1);
  }, 30_000);

  it('closes the sockets of whoever signs out, and leaves everybody else working', async () => {
    const saida = await request(app).post('/api/auth/logout').set('Cookie', operador.cookie);
    expect(saida.status).toBe(200);

    await operador.gravador.ate('a sessão dada por terminada', (g) =>
      g.quantos('sessao:terminada') === 1,
    );
    await assentar(150);
    expect(operador.socket.connected).toBe(false);

    // The afternoon carries on for everybody else: one person leaving is not an outage.
    expect(admin.socket.connected).toBe(true);
    expect(motorista.socket.connected).toBe(true);

    const criada = await request(app)
      .post('/api/orders')
      .set('Cookie', admin.cookie)
      .send({
        customerId: idCliente,
        description: 'Encomenda registada depois da saída da operadora',
        weightGrams: 1200,
        valueCents: 350_000,
        origin: ARMAZEM,
        destination: DESTINO,
      });
    expect(criada.status).toBe(201);

    await admin.gravador.ate('o admin a ver a encomenda nova', (g) =>
      g.quantos('encomenda:actualizada') === 1,
    );
    // And the browser that signed out hears nothing more, which is the point of revoking
    // a session rather than waiting for it to lapse.
    expect(operador.gravador.quantos('encomenda:actualizada')).toBe(0);
  });
});
