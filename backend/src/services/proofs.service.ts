import { createHash } from 'node:crypto';
import { assegurarPontoEmAngola } from '../domain/geografia.js';
import { validarImagem, type Ficheiro } from '../domain/imagem.js';
import * as encomendas from '../repositories/orders.repository.js';
import * as provas from '../repositories/proofs.repository.js';
import { publicar } from '../realtime/bus.js';
import { AppError } from '../utils/errors.js';
import type { Autenticado } from '../types/domain.js';
import { registarAuditoria } from './audit.service.js';
import { ambitoDe } from './ambito.service.js';
import type { Contexto } from './orders.service.js';
import { detalhe } from './orders.service.js';

/**
 * Proof of delivery: what was shown at the door.
 *
 * Two rules shape this file. Evidence is append-only - there is no edit and no delete,
 * because a record that can be revised afterwards proves nothing. And a proof is a claim
 * with a provenance, not a fact: who uploaded it, what the device said the time was, when
 * this server actually received it, and how wide the position circle was all travel with
 * it, so an operator resolving a dispute can see the difference between "photographed at
 * the door at 15:41" and "uploaded at 18:10 by an operator at the counter".
 */

/**
 * Bounded on purpose. Eight is more than any honest delivery needs - a photo of the
 * parcel, one of the door, a signature - and without a ceiling one driver with a stuck
 * upload loop is a way to fill the disk this all shares.
 */
const MAXIMO_POR_ENCOMENDA = 8;

/**
 * A phone's clock is often wrong, and the direction matters. A little in the future is
 * clock drift and is accepted as-is; hours in the future is a claim worth refusing,
 * because a proof dated after the delivery it documents helps nobody.
 */
const FUTURO_TOLERADO_MS = 5 * 60 * 1000;

/**
 * Before the parcel is in a driver's hands there is nothing to photograph, so those
 * states are refused rather than left to produce puzzling evidence. A failed attempt is
 * explicitly allowed: a photograph of the closed pharmacy is the most useful proof there
 * is when a customer asks why nobody came.
 */
const ESTADOS_COM_PROVA = ['RECOLHIDO', 'EM_ENTREGA', 'ENTREGUE', 'FALHA_ENTREGA', 'DEVOLVIDO'];

interface Acesso {
  readonly linha: NonNullable<Awaited<ReturnType<typeof encomendas.porId>>>;
  readonly meuMotoristaId?: string;
}

/**
 * Resolves the order the caller is allowed to see, or reports it missing.
 *
 * The same narrowing the orders endpoints use: a driver reaches his own parcels, a
 * customer her own, an operator the whole company. Anything else answers 404 rather than
 * 403, because a 403 confirms the id exists.
 */
const acessoDe = async (auth: Autenticado, orderId: string): Promise<Acesso> => {
  const linha = await encomendas.porId(auth.companyId, orderId);
  if (linha === null) throw new AppError('NOT_FOUND', 'Encomenda não encontrada.');

  const ambito = await ambitoDe(auth);
  if (ambito === 'vazio') throw new AppError('NOT_FOUND', 'Encomenda não encontrada.');

  if (ambito.driverId !== undefined && linha.driver_id !== ambito.driverId) {
    throw new AppError('NOT_FOUND', 'Encomenda não encontrada.');
  }
  if (ambito.customerId !== undefined && linha.customer_id !== ambito.customerId) {
    throw new AppError('NOT_FOUND', 'Encomenda não encontrada.');
  }

  return { linha, ...(ambito.driverId !== undefined ? { meuMotoristaId: ambito.driverId } : {}) };
};

export interface Anexo {
  readonly kind: provas.Tipo;
  readonly ficheiro: Ficheiro;
  readonly latitude?: number;
  readonly longitude?: number;
  readonly accuracyMeters?: number;
  readonly capturedAt?: string;
}

export const anexar = async (contexto: Contexto, orderId: string, anexo: Anexo) => {
  const companyId = contexto.auth.companyId;
  const { linha, meuMotoristaId } = await acessoDe(contexto.auth, orderId);

  // A customer may look at the proof of her own delivery. She may not add to it: the
  // record has to come from the side that was carrying the parcel.
  if (contexto.auth.role === 'CLIENTE') {
    throw new AppError('FORBIDDEN', 'Só a transportadora anexa provas de entrega.');
  }

  if (!ESTADOS_COM_PROVA.includes(linha.status)) {
    throw new AppError(
      'CONFLICT',
      `A encomenda ${linha.code} está em ${linha.status} e ainda não tem nada para provar. A prova é anexada a partir da recolha.`,
    );
  }

  const quantas = await provas.contar(companyId, orderId);
  if (quantas >= MAXIMO_POR_ENCOMENDA) {
    throw new AppError(
      'CONFLICT',
      `A encomenda ${linha.code} já tem ${MAXIMO_POR_ENCOMENDA} provas, que é o máximo.`,
    );
  }

  // The bytes decide the type, never the label the client attached to them.
  const mimeType = validarImagem(anexo.ficheiro);

  if (anexo.latitude !== undefined && anexo.longitude !== undefined) {
    // The same check a typed coordinate gets, including the swapped pair: a phone that
    // reports through a broken bridge reverses them, and the point looks plausible.
    assegurarPontoEmAngola({ latitude: anexo.latitude, longitude: anexo.longitude });
  }

  let capturedAt: Date | undefined;
  if (anexo.capturedAt !== undefined) {
    const instante = new Date(anexo.capturedAt);
    if (instante.getTime() > Date.now() + FUTURO_TOLERADO_MS) {
      throw new AppError(
        'VALIDATION_ERROR',
        'A hora da captura está no futuro. Verifica o relógio do telefone.',
      );
    }
    capturedAt = instante;
  }

  const sha256 = createHash('sha256').update(anexo.ficheiro.buffer).digest('hex');

  const prova = await provas.registar({
    companyId,
    orderId,
    kind: anexo.kind,
    // Set only when the driver himself uploaded it. An operator attaching a photo at the
    // counter did not stand at the door, and the record should not suggest he did.
    ...(meuMotoristaId !== undefined ? { driverId: meuMotoristaId } : {}),
    uploadedBy: contexto.auth.userId,
    uploaderLabel: `${contexto.auth.name} (${contexto.auth.email})`,
    mimeType,
    bytes: anexo.ficheiro.buffer,
    sha256,
    ...(anexo.latitude !== undefined ? { latitude: anexo.latitude } : {}),
    ...(anexo.longitude !== undefined ? { longitude: anexo.longitude } : {}),
    ...(anexo.accuracyMeters !== undefined ? { accuracyMeters: anexo.accuracyMeters } : {}),
    ...(capturedAt !== undefined ? { capturedAt } : {}),
  });

  await registarAuditoria({
    companyId,
    actorId: contexto.auth.userId,
    actorLabel: contexto.auth.email,
    action: 'DELIVERY_PROOF_ADDED',
    resourceType: 'order',
    resourceId: orderId,
    metadata: { proofId: prova.id, kind: prova.kind, byteSize: prova.byte_size, sha256 },
    ip: contexto.ip,
    requestId: contexto.requestId,
  });

  // The operator's screen updates without a reload, and so does the customer's: a proof
  // appearing is the answer to the question she has open in front of her.
  const encomenda = await detalhe(companyId, orderId);
  publicar(
    {
      companyId,
      operacao: true,
      ...(encomenda.driverId !== undefined ? { driverId: encomenda.driverId } : {}),
      customerId: encomenda.customerId,
    },
    'encomenda:actualizada',
    { motivo: 'prova', order: encomenda },
  );

  return provas.paraDto(prova);
};

export const listar = async (auth: Autenticado, orderId: string) => {
  await acessoDe(auth, orderId);
  const linhas = await provas.daEncomenda(auth.companyId, orderId);
  return linhas.map(provas.paraDto);
};

export const ficheiro = async (auth: Autenticado, orderId: string, proofId: string) => {
  await acessoDe(auth, orderId);

  const prova = await provas.porId(auth.companyId, proofId);
  // The proof must belong to the order in the path. Without this check the order id is
  // decoration, and one readable order would unlock every proof in the company.
  if (prova === null || prova.order_id !== orderId) {
    throw new AppError('NOT_FOUND', 'Prova não encontrada.');
  }

  const bytes = await provas.bytesDe(auth.companyId, proofId);
  if (bytes === null) throw new AppError('NOT_FOUND', 'Prova não encontrada.');

  return bytes;
};
