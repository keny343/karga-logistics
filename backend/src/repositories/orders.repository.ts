import type { PoolClient } from 'pg';
import { query, transaction } from '../config/database.js';
import { transicoesDe, type OrderStatus } from '../domain/orderStatus.js';

export interface LinhaEncomenda {
  id: string;
  code: string;
  status: OrderStatus;
  customer_id: string;
  customer_name: string;
  driver_id: string | null;
  driver_name: string | null;
  description: string;
  weight_grams: number;
  value_cents: string;
  origin_description: string;
  origin_province: string;
  origin_municipality: string;
  origin_locality: string | null;
  origin_reference: string | null;
  origin_latitude: string | null;
  origin_longitude: string | null;
  dest_description: string;
  dest_province: string;
  dest_municipality: string;
  dest_locality: string | null;
  dest_reference: string | null;
  dest_latitude: string | null;
  dest_longitude: string | null;
  expected_delivery_at: Date | null;
  completed_at: Date | null;
  notes: string | null;
  created_at: Date;
  late: boolean;
}

export interface LinhaHistorico {
  status: OrderStatus;
  previous_status: OrderStatus | null;
  actor_label: string;
  note: string | null;
  created_at: Date;
}

const coordenada = (valor: string | null): number | undefined =>
  valor === null ? undefined : Number(valor);

const endereco = (prefixo: 'origin' | 'dest', linha: LinhaEncomenda) => {
  const pega = <T>(sufixo: string): T => (linha as unknown as Record<string, T>)[`${prefixo}_${sufixo}`] as T;
  const lat = coordenada(pega<string | null>('latitude'));
  const lng = coordenada(pega<string | null>('longitude'));
  const locality = pega<string | null>('locality');
  const reference = pega<string | null>('reference');
  return {
    description: pega<string>('description'),
    province: pega<string>('province'),
    municipality: pega<string>('municipality'),
    ...(locality !== null ? { locality } : {}),
    ...(reference !== null ? { reference } : {}),
    ...(lat !== undefined ? { latitude: lat } : {}),
    ...(lng !== undefined ? { longitude: lng } : {}),
  };
};

export const paraResumo = (linha: LinhaEncomenda) => ({
  id: linha.id,
  code: linha.code,
  status: linha.status,
  customerName: linha.customer_name,
  ...(linha.driver_name !== null ? { driverName: linha.driver_name } : {}),
  destination: `${linha.dest_municipality} — ${linha.dest_description}`,
  // Money crosses the wire as an integer, exactly as it is stored.
  valueCents: Number(linha.value_cents),
  createdAt: linha.created_at.toISOString(),
  ...(linha.expected_delivery_at !== null
    ? { expectedAt: linha.expected_delivery_at.toISOString() }
    : {}),
  late: linha.late,
});

export const paraDetalhe = (linha: LinhaEncomenda, historico: readonly LinhaHistorico[]) => ({
  ...paraResumo(linha),
  customerId: linha.customer_id,
  ...(linha.driver_id !== null ? { driverId: linha.driver_id } : {}),
  origin: endereco('origin', linha),
  destinationAddress: endereco('dest', linha),
  description: linha.description,
  weightGrams: linha.weight_grams,
  ...(linha.notes !== null ? { notes: linha.notes } : {}),
  ...(linha.completed_at !== null ? { completedAt: linha.completed_at.toISOString() } : {}),
  history: historico.map((entrada) => ({
    status: entrada.status,
    at: entrada.created_at.toISOString(),
    by: entrada.actor_label,
    ...(entrada.note !== null ? { note: entrada.note } : {}),
  })),
  // The interface renders exactly the moves the domain allows, so a button can
  // never offer a transition the API would refuse.
  allowedTransitions: transicoesDe(linha.status),
});

/**
 * `late` is computed here rather than stored: a stored flag needs a job to keep it
 * true, and the job is one more thing that can be down. An order that is already
 * finished is never late, whatever its due date said.
 */
const CAMPOS = `o.id, o.code, o.status, o.customer_id, cu.name AS customer_name,
                o.driver_id, d.name AS driver_name, o.description, o.weight_grams, o.value_cents,
                o.origin_description, o.origin_province, o.origin_municipality,
                o.origin_locality, o.origin_reference, o.origin_latitude, o.origin_longitude,
                o.dest_description, o.dest_province, o.dest_municipality,
                o.dest_locality, o.dest_reference, o.dest_latitude, o.dest_longitude,
                o.expected_delivery_at, o.completed_at, o.notes, o.created_at,
                (o.expected_delivery_at IS NOT NULL
                   AND o.expected_delivery_at < now()
                   AND o.status NOT IN ('ENTREGUE', 'CANCELADO', 'DEVOLVIDO')) AS late`;

const DE = `FROM orders o
            JOIN customers cu ON cu.id = o.customer_id
            LEFT JOIN drivers d ON d.id = o.driver_id`;

export const listar = async (
  companyId: string,
  filtros: {
    status?: string;
    search?: string;
    driverId?: string;
    customerId?: string;
    late?: boolean;
    page: number;
    pageSize: number;
  },
): Promise<{ linhas: LinhaEncomenda[]; total: number }> => {
  const termo = filtros.search !== undefined ? `%${filtros.search}%` : null;

  const { rows } = await query<LinhaEncomenda & { total: string }>(
    `SELECT ${CAMPOS}, count(*) OVER() AS total
       ${DE}
      WHERE o.company_id = $1
        AND ($2::text IS NULL OR o.status = $2::order_status)
        AND ($3::text IS NULL OR o.code ILIKE $3 OR cu.name ILIKE $3 OR o.dest_description ILIKE $3)
        AND ($4::uuid IS NULL OR o.driver_id = $4::uuid)
        AND ($5::uuid IS NULL OR o.customer_id = $5::uuid)
        AND ($6::boolean IS NOT TRUE OR (
              o.expected_delivery_at IS NOT NULL
              AND o.expected_delivery_at < now()
              AND o.status NOT IN ('ENTREGUE', 'CANCELADO', 'DEVOLVIDO')))
      ORDER BY o.created_at DESC
      LIMIT $7 OFFSET $8`,
    [
      companyId,
      filtros.status ?? null,
      termo,
      filtros.driverId ?? null,
      filtros.customerId ?? null,
      filtros.late ?? null,
      filtros.pageSize,
      (filtros.page - 1) * filtros.pageSize,
    ],
  );

  return { linhas: rows, total: rows[0] !== undefined ? Number(rows[0].total) : 0 };
};

export const porId = async (companyId: string, id: string): Promise<LinhaEncomenda | null> => {
  const { rows } = await query<LinhaEncomenda>(
    `SELECT ${CAMPOS} ${DE} WHERE o.company_id = $1 AND o.id = $2`,
    [companyId, id],
  );
  return rows[0] ?? null;
};

export const historico = async (orderId: string): Promise<LinhaHistorico[]> => {
  const { rows } = await query<LinhaHistorico>(
    `SELECT status, previous_status, actor_label, note, created_at
       FROM order_status_history
      WHERE order_id = $1
      ORDER BY created_at, id`,
    [orderId],
  );
  return rows;
};

export interface NovaEncomenda {
  customerId: string;
  description: string;
  weightGrams: number;
  valueCents: number;
  origin: Record<string, unknown>;
  destination: Record<string, unknown>;
  expectedAt?: string;
  notes?: string;
}

const endereçoParaParametros = (endereco: Record<string, unknown>) => [
  endereco.description ?? '',
  endereco.province ?? 'Luanda',
  endereco.municipality ?? '',
  endereco.locality ?? null,
  endereco.reference ?? null,
  endereco.latitude ?? null,
  endereco.longitude ?? null,
];

export const criar = async (
  companyId: string,
  autor: { id: string; label: string },
  dados: NovaEncomenda,
): Promise<string> =>
  transaction(async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO orders (
         company_id, code, customer_id, description, weight_grams, value_cents,
         origin_description, origin_province, origin_municipality, origin_locality,
         origin_reference, origin_latitude, origin_longitude,
         dest_description, dest_province, dest_municipality, dest_locality,
         dest_reference, dest_latitude, dest_longitude,
         expected_delivery_at, notes, created_by
       ) VALUES (
         $1, 'KRG-' || lpad(nextval('order_code_seq')::text, 6, '0'), $2, $3, $4, $5,
         $6, $7, $8, $9, $10, $11, $12,
         $13, $14, $15, $16, $17, $18, $19,
         $20, $21, $22
       ) RETURNING id`,
      [
        companyId,
        dados.customerId,
        dados.description,
        dados.weightGrams,
        dados.valueCents,
        ...endereçoParaParametros(dados.origin),
        ...endereçoParaParametros(dados.destination),
        dados.expectedAt ?? null,
        dados.notes ?? null,
        autor.id,
      ],
    );

    const criada = rows[0];
    if (criada === undefined) throw new Error('encomenda não foi criada');

    // The first history row is written in the same transaction as the order, so an
    // order can never exist without the record of how it started.
    await client.query(
      `INSERT INTO order_status_history (order_id, company_id, status, changed_by, actor_label)
       VALUES ($1, $2, 'CRIADO', $3, $4)`,
      [criada.id, companyId, autor.id, autor.label],
    );

    return criada.id;
  });

/** Locks the row for the duration of a state change, so two operators cannot both win. */
export const paraActualizacao = async (
  client: PoolClient,
  companyId: string,
  id: string,
): Promise<{ id: string; code: string; status: OrderStatus; driver_id: string | null } | null> => {
  const { rows } = await client.query<{
    id: string;
    code: string;
    status: OrderStatus;
    driver_id: string | null;
  }>(
    `SELECT id, code, status, driver_id FROM orders
      WHERE company_id = $1 AND id = $2
      FOR UPDATE`,
    [companyId, id],
  );
  return rows[0] ?? null;
};

export const aplicarEstado = async (
  client: PoolClient,
  dados: {
    companyId: string;
    orderId: string;
    de: OrderStatus;
    para: OrderStatus;
    autorId: string;
    autorLabel: string;
    note?: string;
    finalizar: boolean;
  },
): Promise<void> => {
  await client.query(
    `UPDATE orders
        SET status = $3,
            completed_at = CASE WHEN $4 THEN now() ELSE completed_at END,
            updated_at = now()
      WHERE company_id = $1 AND id = $2`,
    [dados.companyId, dados.orderId, dados.para, dados.finalizar],
  );

  await client.query(
    `INSERT INTO order_status_history
       (order_id, company_id, status, previous_status, changed_by, actor_label, note)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      dados.orderId,
      dados.companyId,
      dados.para,
      dados.de,
      dados.autorId,
      dados.autorLabel,
      dados.note ?? null,
    ],
  );
};

export const definirMotorista = async (
  client: PoolClient,
  companyId: string,
  orderId: string,
  driverId: string,
): Promise<void> => {
  await client.query(
    'UPDATE orders SET driver_id = $3, updated_at = now() WHERE company_id = $1 AND id = $2',
    [companyId, orderId, driverId],
  );
};

/** The invariant behind "este motorista já tem uma entrega activa". */
export const contarActivasDoMotorista = async (
  client: PoolClient,
  companyId: string,
  driverId: string,
): Promise<number> => {
  const { rows } = await client.query<{ total: string }>(
    `SELECT count(*) AS total FROM orders
      WHERE company_id = $1
        AND driver_id = $2
        AND status IN ('ATRIBUIDO', 'RECOLHIDO', 'EM_ENTREGA')`,
    [companyId, driverId],
  );
  return Number(rows[0]?.total ?? 0);
};
