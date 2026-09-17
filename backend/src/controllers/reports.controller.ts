import type { Request, Response } from 'express';
import { ORDER_STATUSES, statusLegivel } from '../domain/orderStatus.js';
import { empresaDe } from '../middleware/authenticate.js';
import * as repo from '../repositories/reports.repository.js';
import { registarAuditoria } from '../services/audit.service.js';
import { documento } from '../utils/csv.js';
import { AppError } from '../utils/errors.js';
import { exportacaoSchema, intervaloSchema } from '../validators/schemas.js';

/**
 * The report is one response with every aggregate the screen shows. Five queries in
 * one round trip beat five round trips, and they are all reading the same window —
 * splitting them into endpoints would let a client show numbers that disagree
 * because they were fetched a second apart.
 */
export const resumo = async (req: Request, res: Response): Promise<void> => {
  const intervalo = intervaloSchema.parse(req.query);
  const companyId = empresaDe(req);

  const [totais, porDia, porEstado, porMotorista, porMunicipio] = await Promise.all([
    repo.totais(companyId, intervalo),
    repo.porDia(companyId, intervalo),
    repo.porEstado(companyId, intervalo),
    repo.porMotorista(companyId, intervalo),
    repo.porMunicipio(companyId, intervalo),
  ]);

  // The rate is computed here, not in SQL, because it needs a decision the database
  // should not make: with nothing finished yet the answer is "no data", not zero
  // per cent, and those two mean very different things to whoever reads them.
  const concluidas = totais.delivered + totais.failed + totais.returned;
  const successRate = concluidas === 0 ? null : Math.round((totais.delivered / concluidas) * 1000) / 10;

  res.json({
    range: intervalo,
    totals: { ...totais, completed: concluidas, successRate },
    perDay: porDia,
    byStatus: porEstado,
    byDriver: porMotorista,
    byMunicipality: porMunicipio,
  });
};

const CABECALHO = [
  'Código',
  'Estado',
  'Cliente',
  'Telefone',
  'Motorista',
  'Município',
  'Destino',
  'Peso (kg)',
  'Valor (Kz)',
  'Criada',
  'Prazo',
  'Concluída',
] as const;

const quando = (valor: Date | null): string =>
  valor === null ? '' : valor.toISOString().slice(0, 16).replace('T', ' ');

/**
 * Numbers in an export are written the way a spreadsheet in this locale reads them:
 * comma for decimals. They are converted from the integer grams and cêntimos the
 * database stores, and nowhere else in the system are they anything but integers.
 */
const decimal = (valor: number, divisor: number): string =>
  (valor / divisor).toFixed(2).replace('.', ',');

export const exportarEncomendas = async (req: Request, res: Response): Promise<void> => {
  const parametros = exportacaoSchema.parse(req.query);
  const companyId = empresaDe(req);

  if (
    parametros.status !== undefined &&
    !(ORDER_STATUSES as readonly string[]).includes(parametros.status)
  ) {
    throw new AppError('VALIDATION_ERROR', 'Estado desconhecido.', {
      details: [{ field: 'status', message: 'Estado desconhecido.' }],
    });
  }

  const linhas = await repo.paraExportacao(companyId, parametros, parametros.status);

  const csv = documento(
    CABECALHO,
    linhas.map((linha) => [
      linha.code,
      statusLegivel(linha.status),
      linha.customer_name,
      linha.customer_phone,
      linha.driver_name,
      linha.dest_municipality,
      linha.dest_description,
      decimal(linha.weight_grams, 1000),
      decimal(Number(linha.value_cents), 100),
      quando(linha.created_at),
      quando(linha.expected_delivery_at),
      quando(linha.completed_at),
    ]),
  );

  // An export carries customer names and phone numbers out of the system, which is
  // exactly the kind of action an audit trail exists for.
  await registarAuditoria({
    companyId,
    actorId: req.auth?.userId ?? null,
    actorLabel: req.auth?.email ?? 'sistema',
    action: 'REPORT_EXPORTED',
    resourceType: 'report',
    metadata: { from: parametros.from, to: parametros.to, rows: linhas.length },
    ip: req.ip ?? null,
    requestId: req.requestId,
  });

  const nome = `karga-encomendas-${parametros.from}-a-${parametros.to}.csv`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  // The filename is built from validated dates only, so it cannot carry a quote or
  // a newline into the header.
  res.setHeader('Content-Disposition', `attachment; filename="${nome}"`);
  res.setHeader('X-Row-Count', String(linhas.length));
  res.send(csv);
};
