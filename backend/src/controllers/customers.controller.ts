import type { Request, Response } from 'express';
import { empresaDe } from '../middleware/authenticate.js';
import * as repo from '../repositories/customers.repository.js';
import { registarAuditoria } from '../services/audit.service.js';
import { AppError } from '../utils/errors.js';
import { clienteSchema, filtrosSchema, idSchema } from '../validators/schemas.js';

export const listar = async (req: Request, res: Response): Promise<void> => {
  const filtros = filtrosSchema.parse(req.query);
  const { linhas, total } = await repo.listar(empresaDe(req), {
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

export const obter = async (req: Request, res: Response): Promise<void> => {
  const id = idSchema.parse(req.params.id);
  const linha = await repo.porId(empresaDe(req), id);
  if (linha === null) throw new AppError('NOT_FOUND', 'Cliente não encontrado.');
  res.json({ customer: repo.paraDto(linha) });
};

export const criar = async (req: Request, res: Response): Promise<void> => {
  const dados = clienteSchema.parse(req.body);
  const companyId = empresaDe(req);

  let linha: repo.LinhaCliente;
  try {
    linha = await repo.criar(companyId, dados);
  } catch (erro) {
    // 23505 is the unique index on (company_id, phone): the same customer twice is
    // a duplicate the operator should be told about, not a 500.
    if (typeof erro === 'object' && erro !== null && (erro as { code?: string }).code === '23505') {
      throw new AppError('CONFLICT', 'Já existe um cliente com este número de telefone.');
    }
    throw erro;
  }

  await registarAuditoria({
    companyId,
    actorId: req.auth?.userId ?? null,
    actorLabel: req.auth?.email ?? 'sistema',
    action: 'CUSTOMER_CREATED',
    resourceType: 'customer',
    resourceId: linha.id,
    ip: req.ip ?? null,
    requestId: req.requestId,
  });

  res.status(201).json({ customer: repo.paraDto(linha) });
};
