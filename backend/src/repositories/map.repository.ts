import { query } from '../config/database.js';
import { ESTADOS_ABERTOS, type OrderStatus } from '../domain/orderStatus.js';

/**
 * What the map needs, and nothing else. The order list already returns full rows;
 * a map with two hundred markers wants six fields each, and sending the rest would
 * make the heaviest screen in the application heavier for nothing.
 */
export interface PontoEncomenda {
  id: string;
  code: string;
  status: OrderStatus;
  customer_name: string;
  driver_name: string | null;
  dest_municipality: string;
  dest_description: string;
  latitude: string;
  longitude: string;
  late: boolean;
}

export interface SemPonto {
  id: string;
  code: string;
  status: OrderStatus;
  customer_name: string;
  dest_municipality: string;
  dest_description: string;
}

const ABERTOS = ESTADOS_ABERTOS.map((status) => `'${status}'`).join(', ');

const ATRASADA = `(o.expected_delivery_at IS NOT NULL
                   AND o.expected_delivery_at < now()
                   AND o.status NOT IN ('ENTREGUE', 'CANCELADO', 'DEVOLVIDO'))`;

const AMBITO = `o.company_id = $1
                AND o.status IN (${ABERTOS})
                AND ($2::uuid IS NULL OR o.driver_id = $2::uuid)
                AND ($3::uuid IS NULL OR o.customer_id = $3::uuid)`;

export interface Ambito {
  readonly companyId: string;
  readonly driverId?: string;
  readonly customerId?: string;
}

const parametros = (ambito: Ambito) => [
  ambito.companyId,
  ambito.driverId ?? null,
  ambito.customerId ?? null,
];

/**
 * Only orders still in play. A delivered parcel from last month on the map is noise
 * covering the one thing the operator is looking for.
 */
export const pontos = async (ambito: Ambito): Promise<PontoEncomenda[]> => {
  const { rows } = await query<PontoEncomenda>(
    `SELECT o.id, o.code, o.status, cu.name AS customer_name, d.name AS driver_name,
            o.dest_municipality, o.dest_description,
            o.dest_latitude AS latitude, o.dest_longitude AS longitude,
            ${ATRASADA} AS late
       FROM orders o
       JOIN customers cu ON cu.id = o.customer_id
       LEFT JOIN drivers d ON d.id = o.driver_id
      WHERE ${AMBITO}
        AND o.dest_latitude IS NOT NULL
        AND o.dest_longitude IS NOT NULL
      ORDER BY o.created_at DESC
      LIMIT 500`,
    parametros(ambito),
  );
  return rows;
};

/**
 * The orders the map cannot draw. They are returned rather than silently dropped:
 * a dispatcher counting markers has to know that three parcels exist somewhere the
 * map is not showing, and each one is a link to the screen where the point can be
 * set.
 */
export const semCoordenadas = async (ambito: Ambito): Promise<SemPonto[]> => {
  const { rows } = await query<SemPonto>(
    `SELECT o.id, o.code, o.status, cu.name AS customer_name,
            o.dest_municipality, o.dest_description
       FROM orders o
       JOIN customers cu ON cu.id = o.customer_id
      WHERE ${AMBITO}
        AND (o.dest_latitude IS NULL OR o.dest_longitude IS NULL)
      ORDER BY o.created_at DESC
      LIMIT 100`,
    parametros(ambito),
  );
  return rows;
};

/** Distinct pickup points in play, so the map shows where the parcels leave from. */
export const origens = async (
  ambito: Ambito,
): Promise<{ description: string; municipality: string; latitude: string; longitude: string }[]> => {
  const { rows } = await query<{
    description: string;
    municipality: string;
    latitude: string;
    longitude: string;
  }>(
    `SELECT DISTINCT ON (o.origin_latitude, o.origin_longitude)
            o.origin_description AS description, o.origin_municipality AS municipality,
            o.origin_latitude AS latitude, o.origin_longitude AS longitude
       FROM orders o
      WHERE ${AMBITO}
        AND o.origin_latitude IS NOT NULL
        AND o.origin_longitude IS NOT NULL`,
    parametros(ambito),
  );
  return rows;
};

/** Coordinates are `numeric` in the database and arrive as strings. */
export const paraDto = (linha: PontoEncomenda) => ({
  id: linha.id,
  code: linha.code,
  status: linha.status,
  customerName: linha.customer_name,
  ...(linha.driver_name !== null ? { driverName: linha.driver_name } : {}),
  municipality: linha.dest_municipality,
  description: linha.dest_description,
  latitude: Number(linha.latitude),
  longitude: Number(linha.longitude),
  late: linha.late,
});

export const semPontoParaDto = (linha: SemPonto) => ({
  id: linha.id,
  code: linha.code,
  status: linha.status,
  customerName: linha.customer_name,
  municipality: linha.dest_municipality,
  description: linha.dest_description,
});
