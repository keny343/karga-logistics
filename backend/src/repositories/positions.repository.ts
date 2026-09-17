import { query } from '../config/database.js';

/**
 * A driver's last known point. Upserted rather than appended — see
 * `migrations/005_driver_positions.sql` for why no trail is kept.
 */
export const registar = async (dados: {
  driverId: string;
  companyId: string;
  latitude: number;
  longitude: number;
  accuracyMeters?: number;
  orderId?: string;
}): Promise<void> => {
  await query(
    `INSERT INTO driver_positions
       (driver_id, company_id, latitude, longitude, accuracy_meters, order_id, reported_at)
     VALUES ($1, $2, $3, $4, $5, $6, now())
     ON CONFLICT (driver_id) DO UPDATE
        SET latitude = excluded.latitude,
            longitude = excluded.longitude,
            accuracy_meters = excluded.accuracy_meters,
            order_id = excluded.order_id,
            reported_at = excluded.reported_at`,
    [
      dados.driverId,
      dados.companyId,
      dados.latitude,
      dados.longitude,
      dados.accuracyMeters ?? null,
      dados.orderId ?? null,
    ],
  );
};

export interface PosicaoLinha {
  driver_id: string;
  name: string;
  status: string;
  latitude: string;
  longitude: string;
  accuracy_meters: number | null;
  order_id: string | null;
  order_code: string | null;
  reported_at: Date;
}

/**
 * Recent positions only. A point from two hours ago drawn like a current one is a
 * lie the map tells with a straight face — the driver may have finished, gone home,
 * or closed the browser tab that was reporting.
 */
export const recentes = async (
  companyId: string,
  minutos: number,
  driverId?: string,
): Promise<PosicaoLinha[]> => {
  const { rows } = await query<PosicaoLinha>(
    `SELECT p.driver_id, d.name, d.status, p.latitude, p.longitude, p.accuracy_meters,
            p.order_id, o.code AS order_code, p.reported_at
       FROM driver_positions p
       JOIN drivers d ON d.id = p.driver_id
       LEFT JOIN orders o ON o.id = p.order_id
      WHERE p.company_id = $1
        AND d.is_active
        AND p.reported_at > now() - ($2 || ' minutes')::interval
        AND ($3::uuid IS NULL OR p.driver_id = $3::uuid)
      ORDER BY p.reported_at DESC`,
    [companyId, String(minutos), driverId ?? null],
  );
  return rows;
};

export const paraDto = (linha: PosicaoLinha) => ({
  driverId: linha.driver_id,
  driverName: linha.name,
  latitude: Number(linha.latitude),
  longitude: Number(linha.longitude),
  ...(linha.accuracy_meters !== null ? { accuracyMeters: linha.accuracy_meters } : {}),
  ...(linha.order_id !== null ? { orderId: linha.order_id } : {}),
  ...(linha.order_code !== null ? { orderCode: linha.order_code } : {}),
  reportedAt: linha.reported_at.toISOString(),
});
