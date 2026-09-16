import { query } from '../config/database.js';
import type { DriverStatus, VehicleType } from '../types/domain.js';

export interface LinhaMotorista {
  id: string;
  name: string;
  phone: string;
  document_id: string | null;
  status: DriverStatus;
  vehicle_type: VehicleType | null;
  vehicle_plate: string | null;
  is_active: boolean;
  active_orders: string;
  delivered_count: string;
}

export const paraDto = (linha: LinhaMotorista) => ({
  id: linha.id,
  name: linha.name,
  phone: linha.phone,
  ...(linha.document_id !== null ? { documentId: linha.document_id } : {}),
  status: linha.status,
  ...(linha.vehicle_type !== null ? { vehicleType: linha.vehicle_type } : {}),
  ...(linha.vehicle_plate !== null ? { vehiclePlate: linha.vehicle_plate } : {}),
  activeOrders: Number(linha.active_orders),
  deliveredCount: Number(linha.delivered_count),
  isActive: linha.is_active,
});

/** The states in which a driver is holding a parcel. */
export const ESTADOS_COM_CARGA = ['ATRIBUIDO', 'RECOLHIDO', 'EM_ENTREGA'] as const;

const CAMPOS = `d.id, d.name, d.phone, d.document_id, d.status, d.vehicle_type,
                d.vehicle_plate, d.is_active,
                (SELECT count(*) FROM orders o
                  WHERE o.driver_id = d.id
                    AND o.status IN ('ATRIBUIDO', 'RECOLHIDO', 'EM_ENTREGA')) AS active_orders,
                (SELECT count(*) FROM orders o
                  WHERE o.driver_id = d.id AND o.status = 'ENTREGUE') AS delivered_count`;

export const listar = async (
  companyId: string,
  filtros: { status?: string; search?: string; page: number; pageSize: number },
): Promise<{ linhas: LinhaMotorista[]; total: number }> => {
  const termo = filtros.search !== undefined ? `%${filtros.search}%` : null;

  const { rows } = await query<LinhaMotorista & { total: string }>(
    `SELECT ${CAMPOS}, count(*) OVER() AS total
       FROM drivers d
      WHERE d.company_id = $1
        AND d.is_active
        AND ($2::text IS NULL OR d.status = $2::driver_status)
        AND ($3::text IS NULL OR d.name ILIKE $3 OR d.phone ILIKE $3)
      ORDER BY d.name
      LIMIT $4 OFFSET $5`,
    [companyId, filtros.status ?? null, termo, filtros.pageSize, (filtros.page - 1) * filtros.pageSize],
  );

  return { linhas: rows, total: rows[0] !== undefined ? Number(rows[0].total) : 0 };
};

export const porId = async (companyId: string, id: string): Promise<LinhaMotorista | null> => {
  const { rows } = await query<LinhaMotorista>(
    `SELECT ${CAMPOS} FROM drivers d WHERE d.company_id = $1 AND d.id = $2`,
    [companyId, id],
  );
  return rows[0] ?? null;
};

// Optional fields are `?: T | undefined` for the same reason as in the customers
// repository: a validated payload gives absence and undefined the same meaning.
export interface NovoMotorista {
  name: string;
  phone: string;
  documentId?: string | undefined;
  vehicleType?: VehicleType | undefined;
  vehiclePlate?: string | undefined;
}

export const criar = async (companyId: string, dados: NovoMotorista): Promise<LinhaMotorista> => {
  const { rows } = await query<{ id: string }>(
    `INSERT INTO drivers (company_id, name, phone, document_id, vehicle_type, vehicle_plate, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'DISPONIVEL')
     RETURNING id`,
    [
      companyId,
      dados.name,
      dados.phone,
      dados.documentId ?? null,
      dados.vehicleType ?? null,
      dados.vehiclePlate ?? null,
    ],
  );
  const criado = rows[0];
  if (criado === undefined) throw new Error('motorista não foi criado');
  const linha = await porId(companyId, criado.id);
  if (linha === null) throw new Error('motorista criado mas não encontrado');
  return linha;
};

export const definirEstado = async (
  companyId: string,
  id: string,
  status: DriverStatus,
): Promise<void> => {
  await query(
    'UPDATE drivers SET status = $3, updated_at = now() WHERE company_id = $1 AND id = $2',
    [companyId, id, status],
  );
};

/**
 * Called after an order reaches a terminal state: a driver with nothing left to
 * carry becomes available again, and one who still has a parcel stays out.
 */
export const reavaliarEstado = async (companyId: string, driverId: string): Promise<void> => {
  await query(
    `UPDATE drivers d
        SET status = CASE
              WHEN EXISTS (
                SELECT 1 FROM orders o
                 WHERE o.driver_id = d.id
                   AND o.status IN ('ATRIBUIDO', 'RECOLHIDO', 'EM_ENTREGA')
              ) THEN 'EM_ENTREGA'::driver_status
              ELSE 'DISPONIVEL'::driver_status
            END,
            updated_at = now()
      WHERE d.company_id = $1
        AND d.id = $2
        AND d.status <> 'INDISPONIVEL'
        AND d.status <> 'OFFLINE'`,
    [companyId, driverId],
  );
};
