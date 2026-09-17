import { query } from '../config/database.js';
import type { OrderStatus } from '../domain/orderStatus.js';
import { FUSO_OPERACIONAL } from '../domain/tempo.js';

/**
 * Reporting aggregates. Every one of them counts in the database rather than
 * loading rows into Node: a month of a busy carrier is tens of thousands of orders,
 * and the answer is always a handful of numbers.
 *
 * The window is a pair of Luanda dates, inclusive on both ends, converted here to
 * the instants they name. A report that says "1 to 30 September" must not quietly
 * mean UTC, or the first and last day of every month would be wrong.
 */
export interface Intervalo {
  readonly from: string;
  readonly to: string;
}

const janela = (intervalo: Intervalo): [string, string] => [intervalo.from, intervalo.to];

// `to` is inclusive, so the upper bound is the start of the following day.
const DESDE = `($2::date)::timestamp AT TIME ZONE '${FUSO_OPERACIONAL}'`;
const ATE = `(($3::date + 1))::timestamp AT TIME ZONE '${FUSO_OPERACIONAL}'`;
const NA_JANELA = `o.company_id = $1 AND o.created_at >= ${DESDE} AND o.created_at < ${ATE}`;

export interface Totais {
  created: number;
  delivered: number;
  failed: number;
  cancelled: number;
  returned: number;
  inProgress: number;
  late: number;
  valueCents: number;
  weightGrams: number;
  /** Median is more honest than a mean here; see the comment in `totais`. */
  medianDeliveryMinutes: number | null;
}

export const totais = async (companyId: string, intervalo: Intervalo): Promise<Totais> => {
  const { rows } = await query<{
    created: string;
    delivered: string;
    failed: string;
    cancelled: string;
    returned: string;
    in_progress: string;
    late: string;
    value_cents: string;
    weight_grams: string;
    median_minutes: string | null;
  }>(
    `SELECT
       count(*) AS created,
       count(*) FILTER (WHERE o.status = 'ENTREGUE') AS delivered,
       count(*) FILTER (WHERE o.status = 'FALHA_ENTREGA') AS failed,
       count(*) FILTER (WHERE o.status = 'CANCELADO') AS cancelled,
       count(*) FILTER (WHERE o.status = 'DEVOLVIDO') AS returned,
       count(*) FILTER (WHERE o.status IN ('ATRIBUIDO', 'RECOLHIDO', 'EM_ENTREGA')) AS in_progress,
       count(*) FILTER (
         WHERE o.expected_delivery_at IS NOT NULL
           AND o.status = 'ENTREGUE'
           AND o.completed_at > o.expected_delivery_at
       ) AS late,
       coalesce(sum(o.value_cents), 0) AS value_cents,
       coalesce(sum(o.weight_grams), 0) AS weight_grams,
       -- The median, not the mean: one parcel that sat in the warehouse over a
       -- weekend drags an average far enough to make it useless for planning.
       percentile_cont(0.5) WITHIN GROUP (
         ORDER BY extract(epoch FROM (o.completed_at - o.created_at)) / 60
       ) FILTER (WHERE o.status = 'ENTREGUE' AND o.completed_at IS NOT NULL) AS median_minutes
     FROM orders o
     WHERE ${NA_JANELA}`,
    [companyId, ...janela(intervalo)],
  );

  const linha = rows[0];

  return {
    created: Number(linha?.created ?? 0),
    delivered: Number(linha?.delivered ?? 0),
    failed: Number(linha?.failed ?? 0),
    cancelled: Number(linha?.cancelled ?? 0),
    returned: Number(linha?.returned ?? 0),
    inProgress: Number(linha?.in_progress ?? 0),
    late: Number(linha?.late ?? 0),
    valueCents: Number(linha?.value_cents ?? 0),
    weightGrams: Number(linha?.weight_grams ?? 0),
    medianDeliveryMinutes:
      linha?.median_minutes === null || linha?.median_minutes === undefined
        ? null
        : Math.round(Number(linha.median_minutes)),
  };
};

/** One row per day of the window, zeroes included, so a chart has no gaps. */
export const porDia = async (
  companyId: string,
  intervalo: Intervalo,
): Promise<{ day: string; created: number; delivered: number }[]> => {
  const { rows } = await query<{ day: string; created: string; delivered: string }>(
    // Each series is aggregated before it is joined. Joining the orders table twice
    // and counting afterwards multiplies the two: a day with three created and two
    // delivered would report six of each.
    `WITH dias AS (
       SELECT generate_series($2::date, $3::date, interval '1 day')::date AS dia
     ),
     criadas AS (
       SELECT (o.created_at AT TIME ZONE '${FUSO_OPERACIONAL}')::date AS dia, count(*) AS total
         FROM orders o
        WHERE ${NA_JANELA}
        GROUP BY 1
     ),
     -- Deliveries are counted on the day they happened, not the day the order was
     -- created: "how many did we deliver on Tuesday" is the question being asked.
     entregues AS (
       SELECT (o.completed_at AT TIME ZONE '${FUSO_OPERACIONAL}')::date AS dia, count(*) AS total
         FROM orders o
        WHERE o.company_id = $1
          AND o.status = 'ENTREGUE'
          AND o.completed_at >= ${DESDE}
          AND o.completed_at < ${ATE}
        GROUP BY 1
     )
     SELECT to_char(dias.dia, 'YYYY-MM-DD') AS day,
            coalesce(criadas.total, 0) AS created,
            coalesce(entregues.total, 0) AS delivered
       FROM dias
       LEFT JOIN criadas ON criadas.dia = dias.dia
       LEFT JOIN entregues ON entregues.dia = dias.dia
      ORDER BY dias.dia`,
    [companyId, ...janela(intervalo)],
  );

  return rows.map((linha) => ({
    day: linha.day,
    created: Number(linha.created),
    delivered: Number(linha.delivered),
  }));
};

export const porEstado = async (
  companyId: string,
  intervalo: Intervalo,
): Promise<{ status: OrderStatus; count: number }[]> => {
  const { rows } = await query<{ status: OrderStatus; count: string }>(
    `SELECT o.status, count(*) AS count
       FROM orders o
      WHERE ${NA_JANELA}
      GROUP BY o.status
      ORDER BY count(*) DESC`,
    [companyId, ...janela(intervalo)],
  );
  return rows.map((linha) => ({ status: linha.status, count: Number(linha.count) }));
};

export interface DesempenhoMotorista {
  driverId: string;
  driverName: string;
  assigned: number;
  delivered: number;
  failed: number;
  medianDeliveryMinutes: number | null;
}

/**
 * Per-driver performance over the window. Drivers with nothing assigned are left
 * out: a table of zeroes says nothing, and the drivers list already shows who
 * exists.
 */
export const porMotorista = async (
  companyId: string,
  intervalo: Intervalo,
): Promise<DesempenhoMotorista[]> => {
  const { rows } = await query<{
    driver_id: string;
    driver_name: string;
    assigned: string;
    delivered: string;
    failed: string;
    median_minutes: string | null;
  }>(
    `SELECT d.id AS driver_id,
            d.name AS driver_name,
            count(*) AS assigned,
            count(*) FILTER (WHERE o.status = 'ENTREGUE') AS delivered,
            count(*) FILTER (WHERE o.status = 'FALHA_ENTREGA') AS failed,
            percentile_cont(0.5) WITHIN GROUP (
              ORDER BY extract(epoch FROM (o.completed_at - o.created_at)) / 60
            ) FILTER (WHERE o.status = 'ENTREGUE' AND o.completed_at IS NOT NULL) AS median_minutes
       FROM orders o
       JOIN drivers d ON d.id = o.driver_id
      WHERE ${NA_JANELA}
      GROUP BY d.id, d.name
      ORDER BY count(*) FILTER (WHERE o.status = 'ENTREGUE') DESC, d.name`,
    [companyId, ...janela(intervalo)],
  );

  return rows.map((linha) => ({
    driverId: linha.driver_id,
    driverName: linha.driver_name,
    assigned: Number(linha.assigned),
    delivered: Number(linha.delivered),
    failed: Number(linha.failed),
    medianDeliveryMinutes:
      linha.median_minutes === null ? null : Math.round(Number(linha.median_minutes)),
  }));
};

export interface Zona {
  municipality: string;
  count: number;
  delivered: number;
}

/** Where the parcels go. Municipality is the unit an operator plans routes in. */
export const porMunicipio = async (companyId: string, intervalo: Intervalo): Promise<Zona[]> => {
  const { rows } = await query<{ municipality: string; count: string; delivered: string }>(
    `SELECT o.dest_municipality AS municipality,
            count(*) AS count,
            count(*) FILTER (WHERE o.status = 'ENTREGUE') AS delivered
       FROM orders o
      WHERE ${NA_JANELA}
      GROUP BY o.dest_municipality
      ORDER BY count(*) DESC, o.dest_municipality
      LIMIT 12`,
    [companyId, ...janela(intervalo)],
  );

  return rows.map((linha) => ({
    municipality: linha.municipality,
    count: Number(linha.count),
    delivered: Number(linha.delivered),
  }));
};

export interface LinhaExportacao {
  code: string;
  status: OrderStatus;
  customer_name: string;
  customer_phone: string;
  driver_name: string | null;
  dest_municipality: string;
  dest_description: string;
  weight_grams: number;
  value_cents: string;
  created_at: Date;
  expected_delivery_at: Date | null;
  completed_at: Date | null;
}

/**
 * The export reads the same window as the report. It is capped: an operator who
 * asks for a year gets the first fifty thousand rows rather than a request that
 * holds a connection open until it times out.
 */
export const MAXIMO_EXPORTACAO = 50_000;

export const paraExportacao = async (
  companyId: string,
  intervalo: Intervalo,
  status?: string,
): Promise<LinhaExportacao[]> => {
  const { rows } = await query<LinhaExportacao>(
    `SELECT o.code, o.status, cu.name AS customer_name, cu.phone AS customer_phone,
            d.name AS driver_name, o.dest_municipality, o.dest_description,
            o.weight_grams, o.value_cents, o.created_at, o.expected_delivery_at, o.completed_at
       FROM orders o
       JOIN customers cu ON cu.id = o.customer_id
       LEFT JOIN drivers d ON d.id = o.driver_id
      WHERE ${NA_JANELA}
        AND ($4::text IS NULL OR o.status = $4::order_status)
      ORDER BY o.created_at
      LIMIT ${MAXIMO_EXPORTACAO}`,
    [companyId, ...janela(intervalo), status ?? null],
  );
  return rows;
};
