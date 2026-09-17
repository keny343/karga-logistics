import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { closePool, query } from '../src/config/database.js';
import { campo, documento } from '../src/utils/csv.js';
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

let empresaA: string;
let empresaB: string;
let cookieOperador: string;
let clienteA: string;

/** A Luanda date, n days back, in the form the API takes. */
const diaLuanda = (recuar = 0): string => {
  const instante = new Date(Date.now() - recuar * 86_400_000);
  return instante.toLocaleDateString('en-CA', { timeZone: 'Africa/Luanda' });
};

const relatorio = (parametros: Record<string, string>) =>
  request(app)
    .get('/api/reports/summary')
    .query({ from: diaLuanda(7), to: diaLuanda(0), ...parametros })
    .set('Cookie', cookieOperador);

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

describe('GET /api/reports/summary', () => {
  it('counts what happened inside the window and ignores what happened outside it', async () => {
    const agora = new Date();
    const haDoisDias = new Date(Date.now() - 2 * 86_400_000);
    const haQuarentaDias = new Date(Date.now() - 40 * 86_400_000);

    await criarEncomenda({
      companyId: empresaA,
      customerId: clienteA,
      status: 'ENTREGUE',
      driverId: await criarMotorista({ companyId: empresaA, name: 'Dentro' }),
      createdAt: haDoisDias,
      completedAt: agora,
    });
    await criarEncomenda({ companyId: empresaA, customerId: clienteA, status: 'FALHA_ENTREGA' });
    await criarEncomenda({
      companyId: empresaA,
      customerId: clienteA,
      status: 'ENTREGUE',
      // ENTREGUE without a driver is refused by the database, as it should be.
      driverId: await criarMotorista({ companyId: empresaA, name: 'Fora da janela' }),
      createdAt: haQuarentaDias,
      completedAt: haQuarentaDias,
    });

    const resposta = await relatorio({});

    expect(resposta.status).toBe(200);
    // Three orders exist; only the two inside the window are counted.
    expect(resposta.body.totals.created).toBe(2);
    expect(resposta.body.totals.delivered).toBe(1);
    expect(resposta.body.totals.failed).toBe(1);
  });

  it('never mixes companies', async () => {
    const clienteB = await criarCliente({ companyId: empresaB });
    await criarEncomenda({
      companyId: empresaB,
      customerId: clienteB,
      status: 'ENTREGUE',
      driverId: await criarMotorista({ companyId: empresaB }),
      completedAt: new Date(),
    });
    await criarEncomenda({ companyId: empresaA, customerId: clienteA });

    const resposta = await relatorio({});

    expect(resposta.body.totals.created).toBe(1);
    expect(resposta.body.totals.delivered).toBe(0);
  });

  it('reports no success rate rather than zero per cent when nothing has finished', async () => {
    await criarEncomenda({ companyId: empresaA, customerId: clienteA, status: 'CRIADO' });

    const resposta = await relatorio({});

    // 0% and "nothing finished yet" mean very different things to whoever reads it.
    expect(resposta.body.totals.completed).toBe(0);
    expect(resposta.body.totals.successRate).toBeNull();
    expect(resposta.body.totals.medianDeliveryMinutes).toBeNull();
  });

  it('computes the success rate over finished orders only', async () => {
    for (const status of ['ENTREGUE', 'ENTREGUE', 'ENTREGUE', 'FALHA_ENTREGA'] as const) {
      await criarEncomenda({
        companyId: empresaA,
        customerId: clienteA,
        status,
        ...(status === 'ENTREGUE'
          ? { driverId: await criarMotorista({ companyId: empresaA }), completedAt: new Date() }
          : {}),
      });
    }
    // Still in flight: it must not drag the rate down before it has an outcome.
    await criarEncomenda({ companyId: empresaA, customerId: clienteA, status: 'CRIADO' });

    const resposta = await relatorio({});

    expect(resposta.body.totals.completed).toBe(4);
    expect(resposta.body.totals.successRate).toBe(75);
  });

  it('measures the median delivery time, not the mean', async () => {
    const minutos = (n: number) => new Date(Date.now() - n * 60_000);
    // 30, 60 and 1440 minutes. The mean would say 510; the median says 60, which is
    // the number worth planning against.
    for (const duracao of [30, 60, 1440]) {
      await criarEncomenda({
        companyId: empresaA,
        customerId: clienteA,
        status: 'ENTREGUE',
        driverId: await criarMotorista({ companyId: empresaA }),
        createdAt: minutos(duracao),
        completedAt: new Date(),
      });
    }

    const resposta = await relatorio({});

    expect(resposta.body.totals.medianDeliveryMinutes).toBe(60);
  });

  it('fills every day of the window and counts deliveries on the day they happened', async () => {
    const haTresDias = new Date(Date.now() - 3 * 86_400_000);
    await criarEncomenda({
      companyId: empresaA,
      customerId: clienteA,
      status: 'ENTREGUE',
      driverId: await criarMotorista({ companyId: empresaA }),
      createdAt: haTresDias,
      completedAt: new Date(),
    });

    const resposta = await relatorio({});

    expect(resposta.body.perDay).toHaveLength(8);
    const criadaEm = resposta.body.perDay.find(
      (ponto: { day: string }) => ponto.day === diaLuanda(3),
    );
    const entregueEm = resposta.body.perDay.find(
      (ponto: { day: string }) => ponto.day === diaLuanda(0),
    );
    expect(criadaEm.created).toBe(1);
    expect(criadaEm.delivered).toBe(0);
    expect(entregueEm.created).toBe(0);
    expect(entregueEm.delivered).toBe(1);
  });

  it('does not multiply one series by the other on a day that has both', async () => {
    // Three created and two delivered on the same day. Counting after joining the
    // orders table twice would report six of each, and the chart would be fiction.
    for (let i = 0; i < 3; i += 1) {
      await criarEncomenda({ companyId: empresaA, customerId: clienteA });
    }
    for (let i = 0; i < 2; i += 1) {
      await criarEncomenda({
        companyId: empresaA,
        customerId: clienteA,
        status: 'ENTREGUE',
        driverId: await criarMotorista({ companyId: empresaA }),
        completedAt: new Date(),
      });
    }

    const resposta = await relatorio({});
    const hoje = resposta.body.perDay.at(-1);

    expect(hoje.created).toBe(5);
    expect(hoje.delivered).toBe(2);
    // And the chart must agree with the totals above it.
    expect(resposta.body.totals.created).toBe(5);
    expect(resposta.body.totals.delivered).toBe(2);
  });

  it('breaks the window down by driver and by destination municipality', async () => {
    const motorista = await criarMotorista({ companyId: empresaA, name: 'Sílvia Neto' });
    await criarEncomenda({
      companyId: empresaA,
      customerId: clienteA,
      status: 'ENTREGUE',
      driverId: motorista,
      completedAt: new Date(),
      destMunicipality: 'Viana',
    });
    await criarEncomenda({
      companyId: empresaA,
      customerId: clienteA,
      status: 'FALHA_ENTREGA',
      driverId: await criarMotorista({ companyId: empresaA, name: 'Outro' }),
      destMunicipality: 'Viana',
    });

    const resposta = await relatorio({});

    const silvia = resposta.body.byDriver.find(
      (linha: { driverName: string }) => linha.driverName === 'Sílvia Neto',
    );
    expect(silvia.delivered).toBe(1);
    expect(silvia.failed).toBe(0);

    const viana = resposta.body.byMunicipality.find(
      (linha: { municipality: string }) => linha.municipality === 'Viana',
    );
    expect(viana.count).toBe(2);
    expect(viana.delivered).toBe(1);
  });

  it('refuses a window that runs backwards, or one longer than a year', async () => {
    const invertido = await relatorio({ from: diaLuanda(0), to: diaLuanda(7) });
    expect(invertido.status).toBe(400);
    expect(invertido.body.error.code).toBe('VALIDATION_ERROR');

    const enorme = await relatorio({ from: '2020-01-01', to: diaLuanda(0) });
    expect(enorme.status).toBe(400);

    const inexistente = await relatorio({ from: '2026-02-31', to: diaLuanda(0) });
    expect(inexistente.status).toBe(400);
  });

  it('is closed to drivers and customers', async () => {
    for (const papel of ['MOTORISTA', 'CLIENTE'] as const) {
      const utilizador = await criarUtilizador({ companyId: empresaA, role: papel });
      const cookie = await iniciarSessao(app, utilizador.email);
      const resposta = await request(app)
        .get('/api/reports/summary')
        .query({ from: diaLuanda(7), to: diaLuanda(0) })
        .set('Cookie', cookie);
      expect(resposta.status, papel).toBe(403);
    }
  });
});

describe('GET /api/reports/orders.csv', () => {
  const exportar = (parametros: Record<string, string> = {}) =>
    request(app)
      .get('/api/reports/orders.csv')
      .query({ from: diaLuanda(7), to: diaLuanda(0), ...parametros })
      .set('Cookie', cookieOperador);

  it('exports the window as a CSV a spreadsheet can open', async () => {
    await criarEncomenda({ companyId: empresaA, customerId: clienteA });

    const resposta = await exportar();

    expect(resposta.status).toBe(200);
    expect(resposta.headers['content-type']).toContain('text/csv');
    expect(resposta.headers['content-disposition']).toContain(`karga-encomendas-${diaLuanda(7)}`);
    // A BOM, or Excel reads the accented headers as mojibake.
    expect(resposta.text.startsWith('\uFEFF')).toBe(true);
    expect(resposta.text).toContain('Código;Estado;Cliente');
    expect(resposta.text).toContain('Cliente A');
    // Values are decimal in the export and integers everywhere else: 50000 cêntimos.
    expect(resposta.text).toContain('500,00');
  });

  it('writes the readable label of a status, not the enum value', async () => {
    await criarEncomenda({ companyId: empresaA, customerId: clienteA, status: 'FALHA_ENTREGA' });

    const resposta = await exportar();

    expect(resposta.text).toContain('Falha na entrega');
    expect(resposta.text).not.toContain('FALHA_ENTREGA');
  });

  it('exports nothing from another company', async () => {
    const clienteB = await criarCliente({ companyId: empresaB, name: 'Cliente Da Outra' });
    await criarEncomenda({ companyId: empresaB, customerId: clienteB });

    const resposta = await exportar();

    expect(resposta.status).toBe(200);
    expect(resposta.text).not.toContain('Cliente Da Outra');
    expect(resposta.headers['x-row-count']).toBe('0');
  });

  it('records the export in the audit trail, with how many rows left the system', async () => {
    await criarEncomenda({ companyId: empresaA, customerId: clienteA });

    await exportar();

    const { rows } = await query<{ action: string; metadata: { rows: number } }>(
      `SELECT action, metadata FROM audit_logs WHERE company_id = $1 AND action = 'REPORT_EXPORTED'`,
      [empresaA],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.metadata.rows).toBe(1);
  });

  it('is closed to drivers', async () => {
    const motorista = await criarUtilizador({ companyId: empresaA, role: 'MOTORISTA' });
    const cookie = await iniciarSessao(app, motorista.email);

    const resposta = await request(app)
      .get('/api/reports/orders.csv')
      .query({ from: diaLuanda(7), to: diaLuanda(0) })
      .set('Cookie', cookie);

    expect(resposta.status).toBe(403);
  });
});

describe('csv writing', () => {
  it('escapes separators, quotes and newlines', () => {
    expect(campo('Talatona; loja 4')).toBe('"Talatona; loja 4"');
    expect(campo('Diz "urgente"')).toBe('"Diz ""urgente"""');
    expect(campo('linha 1\nlinha 2')).toBe('"linha 1\nlinha 2"');
    expect(campo(null)).toBe('');
    expect(campo(0)).toBe('0');
  });

  it('neutralises a value a spreadsheet would run as a formula', () => {
    // Whoever opens the export did not type this; a customer did, in a form.
    expect(campo('=HYPERLINK("http://mau.example","clica")')).toBe(
      `"'=HYPERLINK(""http://mau.example"",""clica"")"`,
    );
    expect(campo('+244923000000')).toBe(`'+244923000000`);
    expect(campo('-5')).toBe(`'-5`);
    expect(campo('@casa')).toBe(`'@casa`);
    // A plain phone number is not a formula and must be left as typed.
    expect(campo('+244 923 000 000')).toBe(`'+244 923 000 000`);
    expect(campo('923000000')).toBe('923000000');
  });

  it('writes CRLF rows behind a byte-order mark', () => {
    expect(documento(['a', 'b'], [[1, 2]])).toBe('\uFEFFa;b\r\n1;2\r\n');
  });
});
