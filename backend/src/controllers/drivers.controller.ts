import type { Request, Response } from 'express';
import { empresaDe } from '../middleware/authenticate.js';
import * as repo from '../repositories/drivers.repository.js';
import { registarAuditoria } from '../services/audit.service.js';
import { AppError } from '../utils/errors.js';
import {
  estadoMotoristaSchema,
  filtrosSchema,
  idSchema,
  motoristaSchema,
} from '../validators/schemas.js';
import { DRIVER_STATUSES } from '../types/domain.js';

export const listar = async (req: Request, res: Response): Promise<void> => {
  const filtros = filtrosSchema.parse(req.query);

  if (filtros.status !== undefined && !(DRIVER_STATUSES as readonly string[]).includes(filtros.status)) {
    throw new AppError('VALIDATION_ERROR', 'Estado de motorista desconhecido.', {
      details: [{ field: 'status', message: 'Estado desconhecido.' }],
    });
  }

  const { linhas, total } = await repo.listar(empresaDe(req), {
    ...(filtros.status !== undefined ? { status: filtros.status } : {}),
    ...(filtros.search !== undefined ? { search: filtros.search } : {}),
    page: filtros.page,
    pageSize: filtros.pageSize,
  });

  res.json({
    items: linhas.map(repo.paraDto),
    total,
    page: filtros.page,
    pageSize: filtros.pageSize,
  });
};

export const criar = async (req: Request, res: Response): Promise<void> => {
  const dados = motoristaSchema.parse(req.body);
  const companyId = empresaDe(req);
  const linha = await repo.criar(companyId, dados);

  await registarAuditoria({
    companyId,
    actorId: req.auth?.userId ?? null,
    actorLabel: req.auth?.email ?? 'sistema',
    action: 'DRIVER_CREATED',
    resourceType: 'driver',
    resourceId: linha.id,
    ip: req.ip ?? null,
    requestId: req.requestId,
  });

  res.status(201).json({ driver: repo.paraDto(linha) });
};

export const actualizarEstado = async (req: Request, res: Response): Promise<void> => {
  const id = idSchema.parse(req.params.id);
  const { status } = estadoMotoristaSchema.parse(req.body);
  const companyId = empresaDe(req);

  const linha = await repo.porId(companyId, id);
  if (linha === null || !linha.is_active) throw new AppError('NOT_FOUND', 'Motorista não encontrado.');

  // Taking a driver off duty while he is holding a parcel would leave the parcel
  // with nobody responsible for it.
  const saiDeServico = status === 'INDISPONIVEL' || status === 'OFFLINE';
  if (saiDeServico && Number(linha.active_orders) > 0) {
    throw new AppError(
      'CONFLICT',
      `${linha.name} tem ${linha.active_orders} entrega(s) activa(s) e não pode sair de serviço.`,
    );
  }

  await repo.definirEstado(companyId, id, status);
  const actualizado = await repo.porId(companyId, id);
  if (actualizado === null) throw new AppError('NOT_FOUND', 'Motorista não encontrado.');

  await registarAuditoria({
    companyId,
    actorId: req.auth?.userId ?? null,
    actorLabel: req.auth?.email ?? 'sistema',
    action: 'DRIVER_STATUS_CHANGED',
    resourceType: 'driver',
    resourceId: id,
    metadata: { status },
    ip: req.ip ?? null,
    requestId: req.requestId,
  });

  res.json({ driver: repo.paraDto(actualizado) });
};
