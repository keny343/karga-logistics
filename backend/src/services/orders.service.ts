import { transaction } from '../config/database.js';
import { assegurarTransicao, isFinal, type OrderStatus } from '../domain/orderStatus.js';
import * as motoristas from '../repositories/drivers.repository.js';
import * as encomendas from '../repositories/orders.repository.js';
import { registarAuditoria } from './audit.service.js';
import { AppError } from '../utils/errors.js';
import type { Autenticado } from '../types/domain.js';

export interface Contexto {
  readonly auth: Autenticado;
  readonly requestId: string;
  readonly ip: string | null;
}

const autorDe = (auth: Autenticado) => ({ id: auth.userId, label: `${auth.name} (${auth.email})` });

const encomendaOuNada = async (companyId: string, orderId: string) => {
  const linha = await encomendas.porId(companyId, orderId);
  // A row that belongs to another company is reported as missing, not forbidden:
  // 403 would confirm that the id exists somewhere.
  if (linha === null) throw new AppError('NOT_FOUND', 'Encomenda não encontrada.');
  return linha;
};

export const detalhe = async (companyId: string, orderId: string) => {
  const linha = await encomendaOuNada(companyId, orderId);
  const historico = await encomendas.historico(linha.id);
  return encomendas.paraDetalhe(linha, historico);
};

export const criar = async (contexto: Contexto, dados: encomendas.NovaEncomenda) => {
  const orderId = await encomendas.criar(contexto.auth.companyId, autorDe(contexto.auth), dados);

  await registarAuditoria({
    companyId: contexto.auth.companyId,
    actorId: contexto.auth.userId,
    actorLabel: contexto.auth.email,
    action: 'ORDER_CREATED',
    resourceType: 'order',
    resourceId: orderId,
    ip: contexto.ip,
    requestId: contexto.requestId,
  });

  return detalhe(contexto.auth.companyId, orderId);
};

const violaUmaEntregaPorMotorista = (erro: unknown) =>
  typeof erro === 'object' &&
  erro !== null &&
  (erro as { code?: string }).code === '23505' &&
  (erro as { constraint?: string }).constraint === 'orders_motorista_activo_idx';

/**
 * Assignment is the one place where two aggregates meet, so it runs in a single
 * transaction with the order row locked. Everything is checked before anything is
 * written: that the driver exists in this company, is active, is not off duty, and
 * is not already carrying something.
 */
export const atribuirMotorista = async (
  contexto: Contexto,
  orderId: string,
  driverId: string,
) => {
  const companyId = contexto.auth.companyId;

  const motorista = await motoristas.porId(companyId, driverId);
  if (motorista === null || !motorista.is_active) {
    throw new AppError('NOT_FOUND', 'Motorista não encontrado.');
  }
  if (motorista.status === 'INDISPONIVEL' || motorista.status === 'OFFLINE') {
    throw new AppError(
      'CONFLICT',
      `Não foi possível atribuir o motorista. ${motorista.name} está ${motorista.status === 'OFFLINE' ? 'offline' : 'indisponível'}.`,
    );
  }

  const jaOcupado = new AppError(
    'CONFLICT',
    `Não foi possível atribuir o motorista. ${motorista.name} já possui uma entrega activa.`,
  );

  try {
    await transaction(async (client) => {
      const linha = await encomendas.paraActualizacao(client, companyId, orderId);
      if (linha === null) throw new AppError('NOT_FOUND', 'Encomenda não encontrada.');

      const activas = await encomendas.contarActivasDoMotorista(client, companyId, driverId);
      if (activas > 0) throw jaOcupado;

      // The driver must be attached before the state moves, because ATRIBUIDO is one
      // of the states the domain refuses without one.
      assegurarTransicao(linha.status, 'ATRIBUIDO', { code: linha.code, temMotorista: true });

      await encomendas.definirMotorista(client, companyId, orderId, driverId);
      await encomendas.aplicarEstado(client, {
        companyId,
        orderId,
        de: linha.status,
        para: 'ATRIBUIDO',
        autorId: contexto.auth.userId,
        autorLabel: autorDe(contexto.auth).label,
        note: `Atribuída a ${motorista.name}`,
        finalizar: false,
      });
    });
  } catch (erro) {
    // The count above locks the order, not the driver, so two operators assigning
    // the same driver at the same moment can both read zero. The partial unique
    // index catches the loser, and the operator gets the same sentence either way.
    if (violaUmaEntregaPorMotorista(erro)) throw jaOcupado;
    throw erro;
  }

  await registarAuditoria({
    companyId,
    actorId: contexto.auth.userId,
    actorLabel: contexto.auth.email,
    action: 'ORDER_ASSIGNED',
    resourceType: 'order',
    resourceId: orderId,
    metadata: { driverId, driverName: motorista.name },
    ip: contexto.ip,
    requestId: contexto.requestId,
  });

  return detalhe(companyId, orderId);
};

const ACCOES_POR_ESTADO: Partial<Record<OrderStatus, string>> = {
  RECOLHIDO: 'DELIVERY_PICKED_UP',
  EM_ENTREGA: 'DELIVERY_STARTED',
  ENTREGUE: 'DELIVERY_COMPLETED',
  FALHA_ENTREGA: 'DELIVERY_FAILED',
  CANCELADO: 'ORDER_CANCELLED',
  DEVOLVIDO: 'ORDER_RETURNED',
};

export const mudarEstado = async (
  contexto: Contexto,
  orderId: string,
  para: OrderStatus,
  note?: string,
) => {
  const companyId = contexto.auth.companyId;
  let driverAfectado: string | null = null;

  await transaction(async (client) => {
    const linha = await encomendas.paraActualizacao(client, companyId, orderId);
    if (linha === null) throw new AppError('NOT_FOUND', 'Encomenda não encontrada.');

    assegurarTransicao(linha.status, para, {
      code: linha.code,
      temMotorista: linha.driver_id !== null,
    });

    // A driver may only move his own parcels; an operator moves anyone's.
    if (contexto.auth.role === 'MOTORISTA') {
      const meu = await client.query<{ driver_id: string | null }>(
        `SELECT o.driver_id FROM orders o
           JOIN drivers d ON d.id = o.driver_id
          WHERE o.id = $1 AND d.user_id = $2`,
        [orderId, contexto.auth.userId],
      );
      if (meu.rows.length === 0) {
        throw new AppError('FORBIDDEN', 'Só podes actualizar entregas atribuídas a ti.');
      }
    }

    driverAfectado = linha.driver_id;

    await encomendas.aplicarEstado(client, {
      companyId,
      orderId,
      de: linha.status,
      para,
      autorId: contexto.auth.userId,
      autorLabel: autorDe(contexto.auth).label,
      ...(note !== undefined ? { note } : {}),
      finalizar: isFinal(para),
    });

    if (para === 'EM_ENTREGA' && linha.driver_id !== null) {
      await client.query(
        `UPDATE drivers SET status = 'EM_ENTREGA', updated_at = now()
          WHERE company_id = $1 AND id = $2 AND status = 'DISPONIVEL'`,
        [companyId, linha.driver_id],
      );
    }
  });

  // Freeing the driver happens after the transaction commits: the query asks
  // whether any parcel is still open, and that answer must include this change.
  if (isFinal(para) && driverAfectado !== null) {
    await motoristas.reavaliarEstado(companyId, driverAfectado);
  }

  await registarAuditoria({
    companyId,
    actorId: contexto.auth.userId,
    actorLabel: contexto.auth.email,
    action: ACCOES_POR_ESTADO[para] ?? 'ORDER_UPDATED',
    resourceType: 'order',
    resourceId: orderId,
    metadata: { status: para },
    ip: contexto.ip,
    requestId: contexto.requestId,
  });

  return detalhe(companyId, orderId);
};
