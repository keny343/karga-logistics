import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { closePool, query } from '../src/config/database.js';
import { tipoRealDe } from '../src/domain/imagem.js';
import {
  anexarProva,
  criarCliente,
  criarEmpresa,
  criarEncomenda,
  criarMotorista,
  criarUtilizador,
  iniciarSessao,
  limparBase,
  JPEG_1X1,
  PNG_1X1,
} from './helpers/fixtures.js';

/**
 * Proof of delivery, and mostly what it refuses.
 *
 * An upload endpoint is the widest door an API has: it accepts arbitrary bytes from a
 * phone on a public network, stores them, and serves them back to a browser. So the bulk
 * of this file is the refusals - the text file wearing a `.jpg` name, the mismatch between
 * what a client declared and what it sent, the file that is too large - because each of
 * those passing quietly is how a delivery photo becomes a stored cross-site script.
 */

const app = createApp();

let empresaA: string;
let empresaB: string;
let cookieOperador: string;
let clienteA: string;

beforeEach(async () => {
  await limparBase();
  empresaA = await criarEmpresa('Karga A');
  empresaB = await criarEmpresa('Karga B');

  const operador = await criarUtilizador({ companyId: empresaA, role: 'OPERADOR', name: 'Bia' });
  cookieOperador = await iniciarSessao(app, operador.email);
  clienteA = await criarCliente({ companyId: empresaA, name: 'Cliente A' });
});

afterAll(async () => {
  await closePool();
});

/** An order in a state where a proof makes sense. */
const emEntrega = async (companyId = empresaA, customerId?: string) => {
  const motorista = await criarMotorista({ companyId, status: 'EM_ENTREGA' });
  return criarEncomenda({
    companyId,
    customerId: customerId ?? clienteA,
    status: 'EM_ENTREGA',
    driverId: motorista,
  });
};

describe('the byte sniffing', () => {
  it('recognises exactly the three formats it accepts', () => {
    expect(tipoRealDe(JPEG_1X1)).toBe('image/jpeg');
    expect(tipoRealDe(PNG_1X1)).toBe('image/png');
    // A RIFF/WEBP header, which is the shape a phone's WebP arrives in.
    const webp = Buffer.concat([
      Buffer.from('RIFF'),
      Buffer.from([0x20, 0x00, 0x00, 0x00]),
      Buffer.from('WEBP'),
      Buffer.alloc(16),
    ]);
    expect(tipoRealDe(webp)).toBe('image/webp');
  });

  it('refuses what only looks like an image from the outside', () => {
    expect(tipoRealDe(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeUndefined();
    expect(tipoRealDe(Buffer.from('<?php system($_GET["c"]); ?>       '))).toBeUndefined();
    expect(tipoRealDe(Buffer.from('GIF89a'))).toBeUndefined();
    // A RIFF container that is not WebP - a WAV file, say - shares the first four bytes.
    const wav = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE'), Buffer.alloc(8)]);
    expect(tipoRealDe(wav)).toBeUndefined();
    // Too short to have a signature at all.
    expect(tipoRealDe(Buffer.from([0xff, 0xd8, 0xff]))).toBeUndefined();
  });
});

describe('POST /api/orders/:id/proofs', () => {
  it('stores a photo with who took it, where, and both clocks', async () => {
    const contaMotorista = await criarUtilizador({ companyId: empresaA, role: 'MOTORISTA', name: 'Manuel' });
    const motorista = await criarMotorista({
      companyId: empresaA,
      userId: contaMotorista.id,
      name: 'Manuel',
      status: 'EM_ENTREGA',
    });
    const encomenda = await criarEncomenda({
      companyId: empresaA,
      customerId: clienteA,
      status: 'EM_ENTREGA',
      driverId: motorista,
    });
    const cookie = await iniciarSessao(app, contaMotorista.email);

    const capturada = new Date(Date.now() - 90_000).toISOString();
    const resposta = await request(app)
      .post(`/api/orders/${encomenda.id}/proofs`)
      .set('Cookie', cookie)
      .field('kind', 'FOTO')
      .field('latitude', '-8.9167')
      .field('longitude', '13.1833')
      .field('accuracyMeters', '14')
      .field('capturedAt', capturada)
      .attach('file', JPEG_1X1, { filename: 'porta.jpg', contentType: 'image/jpeg' });

    expect(resposta.status).toBe(201);
    expect(resposta.body.proof).toMatchObject({
      kind: 'FOTO',
      mimeType: 'image/jpeg',
      byteSize: JPEG_1X1.length,
      driverName: 'Manuel',
      latitude: -8.9167,
      longitude: 13.1833,
      accuracyMeters: 14,
      capturedAt: capturada,
    });
    // The device's claim and the server's receipt are both kept, and they differ here.
    expect(resposta.body.proof.storedAt).not.toBe(capturada);
    expect(resposta.body.proof.sha256).toMatch(/^[0-9a-f]{64}$/);

    const { rows } = await query<{ action: string; metadata: { kind: string } }>(
      `SELECT action, metadata FROM audit_logs WHERE resource_id = $1 AND action = 'DELIVERY_PROOF_ADDED'`,
      [encomenda.id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.metadata.kind).toBe('FOTO');
  });

  it('records that an operator attached it, without pretending a driver was there', async () => {
    const encomenda = await emEntrega();

    const resposta = await anexarProva(app, cookieOperador, encomenda.id);

    expect(resposta.status).toBe(201);
    expect(resposta.body.proof.uploadedBy).toContain('Bia');
    // No driver: the operator was at a counter, not at the door.
    expect(resposta.body.proof.driverId).toBeUndefined();
    expect(resposta.body.proof.driverName).toBeUndefined();
  });

  it('refuses a text file wearing an image name and type', async () => {
    const encomenda = await emEntrega();

    const resposta = await anexarProva(app, cookieOperador, encomenda.id, {
      bytes: Buffer.from('<?php system($_GET["cmd"]); ?>                    '),
      nome: 'entrega.jpg',
      tipo: 'image/jpeg',
    });

    expect(resposta.status).toBe(400);
    expect(resposta.body.error.message).toContain('não é uma imagem');
    // Nothing was stored: a refusal that leaves the row behind is not a refusal.
    expect(await contarProvas(encomenda.id)).toBe(0);
  });

  it('refuses an image whose declared type disagrees with its bytes', async () => {
    const encomenda = await emEntrega();

    const resposta = await anexarProva(app, cookieOperador, encomenda.id, {
      bytes: PNG_1X1,
      nome: 'assinatura.png',
      tipo: 'image/jpeg',
    });

    expect(resposta.status).toBe(400);
    expect(resposta.body.error.message).toContain('image/png');
    expect(await contarProvas(encomenda.id)).toBe(0);
  });

  it('refuses an extension that contradicts the format', async () => {
    const encomenda = await emEntrega();

    const resposta = await anexarProva(app, cookieOperador, encomenda.id, {
      bytes: PNG_1X1,
      nome: 'assinatura.jpg',
      tipo: 'image/png',
    });

    expect(resposta.status).toBe(400);
    expect(resposta.body.error.message).toContain('.jpg');
  });

  it('refuses an SVG outright, whatever it is called', async () => {
    const encomenda = await emEntrega();

    const resposta = await anexarProva(app, cookieOperador, encomenda.id, {
      bytes: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
      nome: 'assinatura.svg',
      tipo: 'image/svg+xml',
    });

    expect(resposta.status).toBe(400);
  });

  it('refuses an image past the size limit', async () => {
    const encomenda = await emEntrega();

    // A real JPEG header followed by six megabytes, so it fails on size and not on type.
    const enorme = Buffer.concat([JPEG_1X1, Buffer.alloc(6 * 1024 * 1024)]);
    const resposta = await anexarProva(app, cookieOperador, encomenda.id, { bytes: enorme });

    expect(resposta.status).toBe(413);
    expect(resposta.body.error.message).toContain('5 MB');
    expect(await contarProvas(encomenda.id)).toBe(0);
  });

  it('refuses a request with no file at all', async () => {
    const encomenda = await emEntrega();

    const resposta = await request(app)
      .post(`/api/orders/${encomenda.id}/proofs`)
      .set('Cookie', cookieOperador)
      .field('kind', 'FOTO');

    expect(resposta.status).toBe(400);
    expect(resposta.body.error.message).toContain('file');
  });

  it('refuses a coordinate pair that is the wrong way round', async () => {
    const encomenda = await emEntrega();

    const resposta = await request(app)
      .post(`/api/orders/${encomenda.id}/proofs`)
      .set('Cookie', cookieOperador)
      .field('kind', 'FOTO')
      // Luanda's pair, swapped: a valid pair of numbers, in the Atlantic off Guinea.
      .field('latitude', '13.1833')
      .field('longitude', '-8.9167')
      .attach('file', JPEG_1X1, { filename: 'porta.jpg', contentType: 'image/jpeg' });

    expect(resposta.status).toBe(400);
    expect(resposta.body.error.message).toContain('trocadas');
  });

  it('refuses a capture time from the future', async () => {
    const encomenda = await emEntrega();

    const resposta = await request(app)
      .post(`/api/orders/${encomenda.id}/proofs`)
      .set('Cookie', cookieOperador)
      .field('kind', 'FOTO')
      .field('capturedAt', new Date(Date.now() + 3 * 3_600_000).toISOString())
      .attach('file', JPEG_1X1, { filename: 'porta.jpg', contentType: 'image/jpeg' });

    expect(resposta.status).toBe(400);
    expect(resposta.body.error.message).toContain('relógio');
  });

  it('refuses a proof before the parcel has left the warehouse', async () => {
    const encomenda = await criarEncomenda({ companyId: empresaA, customerId: clienteA });

    const resposta = await anexarProva(app, cookieOperador, encomenda.id);

    expect(resposta.status).toBe(409);
    expect(resposta.body.error.message).toContain('recolha');
  });

  it('accepts a proof of a failed attempt, which is the useful one', async () => {
    const motorista = await criarMotorista({ companyId: empresaA });
    const encomenda = await criarEncomenda({
      companyId: empresaA,
      customerId: clienteA,
      status: 'FALHA_ENTREGA',
      driverId: motorista,
    });

    const resposta = await anexarProva(app, cookieOperador, encomenda.id);

    expect(resposta.status).toBe(201);
  });

  it('treats the same file sent twice as one proof', async () => {
    const encomenda = await emEntrega();

    const primeira = await anexarProva(app, cookieOperador, encomenda.id);
    const segunda = await anexarProva(app, cookieOperador, encomenda.id);

    expect(primeira.status).toBe(201);
    // From the driver's side the upload worked, which is true. It just did not create a
    // second row.
    expect(segunda.status).toBe(201);
    expect(segunda.body.proof.id).toBe(primeira.body.proof.id);
    expect(await contarProvas(encomenda.id)).toBe(1);
  });

  it('stops at the ceiling instead of accepting proofs without end', async () => {
    const encomenda = await emEntrega();

    // Eight distinct files: the same bytes would be deduplicated instead of counted.
    for (let indice = 0; indice < 8; indice += 1) {
      const bytes = Buffer.concat([JPEG_1X1, Buffer.from([indice])]);
      expect((await anexarProva(app, cookieOperador, encomenda.id, { bytes })).status).toBe(201);
    }

    const nona = await anexarProva(app, cookieOperador, encomenda.id, {
      bytes: Buffer.concat([JPEG_1X1, Buffer.from('nona')]),
    });
    expect(nona.status).toBe(409);
    expect(nona.body.error.message).toContain('máximo');
  });

  it('never lets a driver attach to a parcel that is not his', async () => {
    const contaMotorista = await criarUtilizador({ companyId: empresaA, role: 'MOTORISTA' });
    await criarMotorista({ companyId: empresaA, userId: contaMotorista.id, status: 'EM_ENTREGA' });
    const cookie = await iniciarSessao(app, contaMotorista.email);

    const alheia = await emEntrega();

    const resposta = await anexarProva(app, cookie, alheia.id);

    // Missing, not forbidden: he must not learn that the order exists.
    expect(resposta.status).toBe(404);
  });

  it('never lets a customer attach one', async () => {
    const contaCliente = await criarUtilizador({ companyId: empresaA, role: 'CLIENTE' });
    const cliente = await criarCliente({ companyId: empresaA, userId: contaCliente.id });
    const cookie = await iniciarSessao(app, contaCliente.email);
    const encomenda = await emEntrega(empresaA, cliente);

    const resposta = await anexarProva(app, cookie, encomenda.id);

    // Refused by the role guard on the route, before the upload is even parsed. The
    // service repeats the check for the day somebody widens the route by accident.
    expect(resposta.status).toBe(403);
    expect(resposta.body.error.code).toBe('FORBIDDEN');
    expect(await contarProvas(encomenda.id)).toBe(0);
  });

  it('never crosses companies', async () => {
    const clienteB = await criarCliente({ companyId: empresaB });
    const alheia = await emEntrega(empresaB, clienteB);

    const resposta = await anexarProva(app, cookieOperador, alheia.id);

    expect(resposta.status).toBe(404);
  });
});

describe('GET /api/orders/:id/proofs and the file', () => {
  it('gives the customer her own proofs, and the bytes that were stored', async () => {
    const contaCliente = await criarUtilizador({ companyId: empresaA, role: 'CLIENTE' });
    const cliente = await criarCliente({ companyId: empresaA, userId: contaCliente.id });
    const cookie = await iniciarSessao(app, contaCliente.email);
    const encomenda = await emEntrega(empresaA, cliente);

    await anexarProva(app, cookieOperador, encomenda.id, { bytes: PNG_1X1, nome: 'a.png', tipo: 'image/png', kind: 'ASSINATURA' });

    const lista = await request(app)
      .get(`/api/orders/${encomenda.id}/proofs`)
      .set('Cookie', cookie);

    expect(lista.status).toBe(200);
    expect(lista.body.items).toHaveLength(1);

    const ficheiro = await request(app).get(lista.body.items[0].url as string).set('Cookie', cookie);

    expect(ficheiro.status).toBe(200);
    expect(ficheiro.headers['content-type']).toBe('image/png');
    expect(Buffer.compare(ficheiro.body as Buffer, PNG_1X1)).toBe(0);
    // Evidence is not cached by anything between here and the browser.
    expect(ficheiro.headers['cache-control']).toContain('private');
    // The client's filename is never echoed back as the download name.
    expect(ficheiro.headers['content-disposition']).not.toContain('a.png');
  });

  it('answers a second view with a 304 instead of the bytes', async () => {
    const encomenda = await emEntrega();
    const criada = await anexarProva(app, cookieOperador, encomenda.id);

    const primeira = await request(app)
      .get(criada.body.proof.url as string)
      .set('Cookie', cookieOperador);
    const etag = primeira.headers.etag as string;
    expect(etag).toContain(criada.body.proof.sha256);
    expect(primeira.headers['content-security-policy']).toContain("default-src 'none'");

    const segunda = await request(app)
      .get(criada.body.proof.url as string)
      .set('Cookie', cookieOperador)
      .set('If-None-Match', etag);

    expect(segunda.status).toBe(304);
    expect(segunda.body).toEqual({});

    // A browser rewrites the headers it kept for an image with the ones from the answer
    // that revalidated it. If the 304 arrives without the tight policy, the copy in the
    // cache is left under the application's, which allows scripts.
    expect(segunda.headers['content-security-policy']).toContain("default-src 'none'");
    expect(segunda.headers['x-content-type-options']).toBe('nosniff');
    expect(segunda.headers['cache-control']).toContain('private');
  });

  it('refuses a proof id that belongs to another order', async () => {
    const uma = await emEntrega();
    const outra = await emEntrega();
    const criada = await anexarProva(app, cookieOperador, uma.id);

    // The same proof id, hung off an order the caller may also read.
    const resposta = await request(app)
      .get(`/api/orders/${outra.id}/proofs/${criada.body.proof.id}/file`)
      .set('Cookie', cookieOperador);

    expect(resposta.status).toBe(404);
  });

  it('never shows one company the evidence of another', async () => {
    const clienteB = await criarCliente({ companyId: empresaB });
    const outraEmpresa = await criarUtilizador({ companyId: empresaB, role: 'OPERADOR' });
    const cookieB = await iniciarSessao(app, outraEmpresa.email);

    const minha = await emEntrega();
    const criada = await anexarProva(app, cookieOperador, minha.id);
    await emEntrega(empresaB, clienteB);

    expect(
      (await request(app).get(`/api/orders/${minha.id}/proofs`).set('Cookie', cookieB)).status,
    ).toBe(404);
    expect(
      (await request(app).get(criada.body.proof.url as string).set('Cookie', cookieB)).status,
    ).toBe(404);
  });

  it('refuses anybody without a session', async () => {
    const encomenda = await emEntrega();
    const criada = await anexarProva(app, cookieOperador, encomenda.id);

    const resposta = await request(app).get(criada.body.proof.url as string);

    expect(resposta.status).toBe(401);
  });
});

describe('the delivery rule', () => {
  it('refuses ENTREGUE with nothing behind it, and names what is missing', async () => {
    const encomenda = await emEntrega();

    const resposta = await request(app)
      .post(`/api/orders/${encomenda.id}/status`)
      .set('Cookie', cookieOperador)
      .send({ status: 'ENTREGUE' });

    expect(resposta.status).toBe(409);
    expect(resposta.body.error.code).toBe('PROOF_REQUIRED');
    expect(resposta.body.error.message).toContain('fotografia');

    // And nothing moved: the order is still out for delivery.
    const { rows } = await query<{ status: string }>('SELECT status FROM orders WHERE id = $1', [
      encomenda.id,
    ]);
    expect(rows[0]?.status).toBe('EM_ENTREGA');
  });

  it('accepts a signature alone, because a camera can fail', async () => {
    const encomenda = await emEntrega();
    await anexarProva(app, cookieOperador, encomenda.id, {
      kind: 'ASSINATURA',
      bytes: PNG_1X1,
      nome: 'assinatura.png',
      tipo: 'image/png',
    });

    const resposta = await request(app)
      .post(`/api/orders/${encomenda.id}/status`)
      .set('Cookie', cookieOperador)
      .send({ status: 'ENTREGUE' });

    expect(resposta.status).toBe(200);
  });

  it('does not stand in the way of a failed attempt or a cancellation', async () => {
    const falha = await emEntrega();
    const cancelada = await criarEncomenda({ companyId: empresaA, customerId: clienteA });

    expect(
      (
        await request(app)
          .post(`/api/orders/${falha.id}/status`)
          .set('Cookie', cookieOperador)
          .send({ status: 'FALHA_ENTREGA' })
      ).status,
    ).toBe(200);

    expect(
      (
        await request(app)
          .post(`/api/orders/${cancelada.id}/status`)
          .set('Cookie', cookieOperador)
          .send({ status: 'CANCELADO' })
      ).status,
    ).toBe(200);
  });

  it('carries the proofs on the order it belongs to', async () => {
    const encomenda = await emEntrega();
    await anexarProva(app, cookieOperador, encomenda.id);

    const resposta = await request(app)
      .get(`/api/orders/${encomenda.id}`)
      .set('Cookie', cookieOperador);

    expect(resposta.body.order.proofs).toHaveLength(1);
    expect(resposta.body.order.proofs[0].url).toContain(encomenda.id);
  });
});

const contarProvas = async (orderId: string): Promise<number> => {
  const { rows } = await query<{ total: string }>(
    'SELECT count(*) AS total FROM delivery_proofs WHERE order_id = $1',
    [orderId],
  );
  return Number(rows[0]?.total ?? 0);
};
