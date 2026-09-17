import type { Request, Response } from 'express';
import { isOrderStatus } from '../domain/orderStatus.js';
import { empresaDe } from '../middleware/authenticate.js';
import * as motoristas from '../repositories/drivers.repository.js';
import * as repo from '../repositories/orders.repository.js';
import * as servico from '../services/orders.service.js';
import { ambitoDe } from '../services/ambito.service.js';
import { query } from '../config/database.js';
import { AppError } from '../utils/errors.js';
import {
  atribuicaoSchema,
  coordenadasSchema,
  encomendaSchema,
  filtrosSchema,
  idSchema,
  mudancaEstadoSchema,
} from '../validators/schemas.js';

const contextoDe = (req: Request): servico.Contexto => {
  if (req.auth === undefined) throw new AppError('UNAUTHENTICATED', 'Precisas de iniciar sessão.');
  return { auth: req.auth, requestId: req.requestId, ip: req.ip ?? null };
};

export const listar = async (req: Request, res: Response): Promise<void> => {
  const filtros = filtrosSchema.parse(req.query);
  const restricao = await ambitoDe(req.auth);

  if (restricao === 'vazio') {
    res.json({ items: [], total: 0, page: filtros.page, pageSize: filtros.pageSize });
    return;
  }

  if (filtros.status !== undefined && !isOrderStatus(filtros.status)) {
    throw new AppError('VALIDATION_ERROR', 'Estado desconhecido.', {
      details: [{ field: 'status', message: 'Estado desconhecido.' }],
    });
  }

  const { linhas, total } = await repo.listar(empresaDe(req), {
    ...(filtros.status !== undefined ? { status: filtros.status } : {}),
    ...(filtros.search !== undefined ? { search: filtros.search } : {}),
    ...(filtros.late !== undefined ? { late: filtros.late } : {}),
    // A driver's own id wins over anything the caller asked for.
    ...(restricao.driverId !== undefined
      ? { driverId: restricao.driverId }
      : filtros.driverId !== undefined
        ? { driverId: filtros.driverId }
        : {}),
    ...(restricao.customerId !== undefined ? { customerId: restricao.customerId } : {}),
    page: filtros.page,
    pageSize: filtros.pageSize,
  });

  res.json({
    items: linhas.map(repo.paraResumo),
    total,
    page: filtros.page,
    pageSize: filtros.pageSize,
  });
};

export const obter = async (req: Request, res: Response): Promise<void> => {
  const id = idSchema.parse(req.params.id);
  const encomenda = await servico.detalhe(empresaDe(req), id);

  const restricao = await ambitoDe(req.auth);
  if (restricao === 'vazio') throw new AppError('NOT_FOUND', 'Encomenda não encontrada.');
  if (restricao.driverId !== undefined && encomenda.driverId !== restricao.driverId) {
    throw new AppError('NOT_FOUND', 'Encomenda não encontrada.');
  }
  if (restricao.customerId !== undefined && encomenda.customerId !== restricao.customerId) {
    throw new AppError('NOT_FOUND', 'Encomenda não encontrada.');
  }

  res.json({ order: encomenda });
};

export const criar = async (req: Request, res: Response): Promise<void> => {
  const dados = encomendaSchema.parse(req.body);
  const contexto = contextoDe(req);

  // The customer must belong to the caller's company: an id from elsewhere would
  // otherwise create an order pointing at another tenant's record.
  const { rows } = await query<{ id: string }>(
    'SELECT id FROM customers WHERE company_id = $1 AND id = $2 AND is_active',
    [contexto.auth.companyId, dados.customerId],
  );
  if (rows.length === 0) throw new AppError('NOT_FOUND', 'Cliente não encontrado.');

  const encomenda = await servico.criar(contexto, {
    customerId: dados.customerId,
    description: dados.description,
    weightGrams: dados.weightGrams,
    valueCents: dados.valueCents,
    origin: dados.origin,
    destination: dados.destination,
    ...(dados.expectedAt !== undefined ? { expectedAt: dados.expectedAt } : {}),
    ...(dados.notes !== undefined ? { notes: dados.notes } : {}),
  });

  res.status(201).json({ order: encomenda });
};

export const atribuir = async (req: Request, res: Response): Promise<void> => {
  const id = idSchema.parse(req.params.id);
  const { driverId } = atribuicaoSchema.parse(req.body);
  const encomenda = await servico.atribuirMotorista(contextoDe(req), id, driverId);
  res.json({ order: encomenda });
};

export const definirCoordenadas = async (req: Request, res: Response): Promise<void> => {
  const id = idSchema.parse(req.params.id);
  const ponto = coordenadasSchema.parse(req.body);
  const encomenda = await servico.definirCoordenadas(contextoDe(req), id, ponto);
  res.json({ order: encomenda });
};

export const mudarEstado = async (req: Request, res: Response): Promise<void> => {
  const id = idSchema.parse(req.params.id);
  const dados = mudancaEstadoSchema.parse(req.body);
  const encomenda = await servico.mudarEstado(
    contextoDe(req),
    id,
    dados.status,
    dados.note,
  );
  res.json({ order: encomenda });
};

/** Drivers available to take a parcel right now, for the assignment dialog. */
export const motoristasDisponiveis = async (req: Request, res: Response): Promise<void> => {
  const { linhas } = await motoristas.listar(empresaDe(req), {
    status: 'DISPONIVEL',
    page: 1,
    pageSize: 100,
  });
  res.json({ items: linhas.map(motoristas.paraDto) });
};
