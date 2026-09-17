import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { closePool, query } from '../src/config/database.js';
import { dentroDeAngola, pareceTrocado } from '../src/domain/geografia.js';
import {
  criarCliente,
  criarEmpresa,
  criarEncomenda,
  criarMotorista,
  criarUtilizador,
  iniciarSessao,
  limparBase,
} from './helpers/fixtures.js';

const app = createApp();

/** Talatona, and the same pair with the numbers exchanged. */
const TALATONA = { latitude: -8.9167, longitude: 13.1833 };

let empresaA: string;
let empresaB: string;
let cookieOperador: string;
let clienteA: string;

const comCoordenadas = async (
  id: string,
  ponto = TALATONA,
): Promise<void> => {
  await query('UPDATE orders SET dest_latitude = $2, dest_longitude = $3 WHERE id = $1', [
    id,
    ponto.latitude,
    ponto.longitude,
  ]);
};

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

describe('GET /api/map/operation', () => {
  const mapa = (cookie = cookieOperador) =>
    request(app).get('/api/map/operation').set('Cookie', cookie);

  it('draws the open orders that have a point', async () => {
    const encomenda = await criarEncomenda({ companyId: empresaA, customerId: clienteA });
    await comCoordenadas(encomenda.id);

    const resposta = await mapa();

    expect(resposta.status).toBe(200);
    expect(resposta.body.items).toHaveLength(1);
    // Coordinates are `numeric` in the database and must not reach the client as
    // strings: a marker at "-8.9167" is a marker nowhere.
    expect(resposta.body.items[0]).toMatchObject({
      code: encomenda.code,
      customerName: 'Cliente A',
      latitude: TALATONA.latitude,
      longitude: TALATONA.longitude,
    });
    expect(typeof resposta.body.items[0].latitude).toBe('number');
  });

  it('leaves finished orders off the map', async () => {
    const entregue = await criarEncomenda({
      companyId: empresaA,
      customerId: clienteA,
      status: 'ENTREGUE',
      driverId: await criarMotorista({ companyId: empresaA }),
      completedAt: new Date(),
    });
    await comCoordenadas(entregue.id);

    const resposta = await mapa();

    // A parcel delivered last month is noise covering the one being looked for.
    expect(resposta.body.items).toHaveLength(0);
    expect(resposta.body.withoutCoordinates).toHaveLength(0);
  });

  it('reports the orders it cannot draw instead of dropping them', async () => {
    const semPonto = await criarEncomenda({ companyId: empresaA, customerId: clienteA });
    const comPonto = await criarEncomenda({ companyId: empresaA, customerId: clienteA });
    await comCoordenadas(comPonto.id);

    const resposta = await mapa();

    expect(resposta.body.items).toHaveLength(1);
    expect(resposta.body.withoutCoordinates).toHaveLength(1);
    expect(resposta.body.withoutCoordinates[0].code).toBe(semPonto.code);
  });

  it('never shows another company\'s parcels', async () => {
    const clienteB = await criarCliente({ companyId: empresaB, name: 'Cliente B' });
    const daOutra = await criarEncomenda({ companyId: empresaB, customerId: clienteB });
    await comCoordenadas(daOutra.id);

    const resposta = await mapa();

    expect(resposta.body.items).toHaveLength(0);
  });

  it('shows a driver only the parcel he is carrying', async () => {
    const conta = await criarUtilizador({ companyId: empresaA, role: 'MOTORISTA' });
    const motorista = await criarMotorista({ companyId: empresaA, userId: conta.id });
    const outro = await criarMotorista({ companyId: empresaA, name: 'Outro' });

    const minha = await criarEncomenda({
      companyId: empresaA,
      customerId: clienteA,
      status: 'EM_ENTREGA',
      driverId: motorista,
    });
    const alheia = await criarEncomenda({
      companyId: empresaA,
      customerId: clienteA,
      status: 'EM_ENTREGA',
      driverId: outro,
    });
    await comCoordenadas(minha.id);
    await comCoordenadas(alheia.id);

    const resposta = await mapa(await iniciarSessao(app, conta.email));

    expect(resposta.body.items).toHaveLength(1);
    expect(resposta.body.items[0].code).toBe(minha.code);
  });

  it('answers a driver account with no driver row with an empty map', async () => {
    const orfao = await criarUtilizador({ companyId: empresaA, role: 'MOTORISTA' });
    const encomenda = await criarEncomenda({ companyId: empresaA, customerId: clienteA });
    await comCoordenadas(encomenda.id);

    const resposta = await mapa(await iniciarSessao(app, orfao.email));

    // A missing link fails closed: an empty map, never the whole company's.
    expect(resposta.body.items).toHaveLength(0);
    expect(resposta.body.center).toBeDefined();
  });

  it('returns the pickup points the parcels leave from', async () => {
    const encomenda = await criarEncomenda({ companyId: empresaA, customerId: clienteA });
    await comCoordenadas(encomenda.id);
    await query('UPDATE orders SET origin_latitude = -8.7776, origin_longitude = 13.3672');

    const resposta = await mapa();

    expect(resposta.body.origins).toHaveLength(1);
    expect(resposta.body.origins[0]).toMatchObject({ latitude: -8.7776, longitude: 13.3672 });
  });
});

describe('PATCH /api/orders/:id/coordinates', () => {
  // `object` rather than a coordinate type: some cases send a payload on purpose
  // that a caller would never write, like a latitude that is a word.
  const definir = (id: string, ponto: object, cookie = cookieOperador) =>
    request(app).patch(`/api/orders/${id}/coordinates`).set('Cookie', cookie).send(ponto);

  it('puts a parcel on the map and records who did it', async () => {
    const encomenda = await criarEncomenda({ companyId: empresaA, customerId: clienteA });

    const resposta = await definir(encomenda.id, TALATONA);

    expect(resposta.status).toBe(200);
    expect(resposta.body.order.destinationAddress.latitude).toBe(TALATONA.latitude);

    const { rows } = await query<{ metadata: { latitude: number } }>(
      `SELECT metadata FROM audit_logs WHERE action = 'ORDER_COORDINATES_SET' AND resource_id = $1`,
      [encomenda.id],
    );
    expect(rows[0]?.metadata.latitude).toBe(TALATONA.latitude);
  });

  it('names the mistake when latitude and longitude arrive swapped', async () => {
    const encomenda = await criarEncomenda({ companyId: empresaA, customerId: clienteA });

    const resposta = await definir(encomenda.id, {
      latitude: TALATONA.longitude,
      longitude: TALATONA.latitude,
    });

    expect(resposta.status).toBe(400);
    expect(resposta.body.error.code).toBe('VALIDATION_ERROR');
    // "Coordenadas inválidas" would leave whoever typed them hunting for a mistake
    // that is one exchange away, so the message carries the corrected pair.
    expect(resposta.body.error.message).toContain('trocadas');
    expect(resposta.body.error.message).toContain(String(TALATONA.latitude));
  });

  it('refuses a point outside Angola', async () => {
    const encomenda = await criarEncomenda({ companyId: empresaA, customerId: clienteA });

    const resposta = await definir(encomenda.id, { latitude: 48.8566, longitude: 2.3522 });

    expect(resposta.status).toBe(400);
    expect(resposta.body.error.message).toContain('fora de Angola');
  });

  it('refuses to move the destination of a finished order', async () => {
    const encomenda = await criarEncomenda({
      companyId: empresaA,
      customerId: clienteA,
      status: 'ENTREGUE',
      driverId: await criarMotorista({ companyId: empresaA }),
      completedAt: new Date(),
    });

    const resposta = await definir(encomenda.id, TALATONA);

    // Where a delivery went is history; the pin cannot rewrite it afterwards.
    expect(resposta.status).toBe(409);
    expect(resposta.body.error.code).toBe('CONFLICT');
  });

  it('answers 404 for an order in another company', async () => {
    const clienteB = await criarCliente({ companyId: empresaB });
    const daOutra = await criarEncomenda({ companyId: empresaB, customerId: clienteB });

    const resposta = await definir(daOutra.id, TALATONA);

    expect(resposta.status).toBe(404);
  });

  it('is closed to drivers and customers', async () => {
    const encomenda = await criarEncomenda({ companyId: empresaA, customerId: clienteA });

    for (const papel of ['MOTORISTA', 'CLIENTE'] as const) {
      const conta = await criarUtilizador({ companyId: empresaA, role: papel });
      const resposta = await definir(encomenda.id, TALATONA, await iniciarSessao(app, conta.email));
      expect(resposta.status, papel).toBe(403);
    }
  });

  it('rejects a payload that is not a pair of numbers', async () => {
    const encomenda = await criarEncomenda({ companyId: empresaA, customerId: clienteA });

    const resposta = await definir(encomenda.id, { latitude: 'norte', longitude: 13.2 });

    expect(resposta.status).toBe(400);
    expect(resposta.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('geography', () => {
  it('accepts points across the country and rejects points far outside it', () => {
    expect(dentroDeAngola({ latitude: -8.8383, longitude: 13.2344 })).toBe(true); // Luanda
    expect(dentroDeAngola({ latitude: -12.5763, longitude: 13.4055 })).toBe(true); // Benguela
    expect(dentroDeAngola({ latitude: -17.0667, longitude: 22.0 })).toBe(true); // Cuando Cubango
    expect(dentroDeAngola({ latitude: -5.55, longitude: 12.2 })).toBe(true); // Cabinda
    expect(dentroDeAngola({ latitude: -33.9249, longitude: 18.4241 })).toBe(false); // Cidade do Cabo
    expect(dentroDeAngola({ latitude: 48.8566, longitude: 2.3522 })).toBe(false); // Paris
    // The box is a sanity check, not a border: it necessarily includes slivers of
    // the neighbours, and refusing a point 20 km into the DRC is not its job.
  });

  it('recognises the one mistake worth naming', () => {
    expect(pareceTrocado({ latitude: 13.2344, longitude: -8.8383 })).toBe(true);
    expect(pareceTrocado({ latitude: 48.8566, longitude: 2.3522 })).toBe(false);
    expect(pareceTrocado({ latitude: -8.8383, longitude: 13.2344 })).toBe(false);
  });
});
