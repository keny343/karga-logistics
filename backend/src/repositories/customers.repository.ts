import { query } from '../config/database.js';

export interface LinhaCliente {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  addr_description: string;
  addr_province: string;
  addr_municipality: string;
  addr_locality: string | null;
  addr_reference: string | null;
  addr_latitude: string | null;
  addr_longitude: string | null;
  is_active: boolean;
  created_at: Date;
  orders_count: string;
}

const numeroOuUndefined = (valor: string | null): number | undefined =>
  valor === null ? undefined : Number(valor);

export const paraDto = (linha: LinhaCliente) => ({
  id: linha.id,
  name: linha.name,
  phone: linha.phone,
  ...(linha.email !== null ? { email: linha.email } : {}),
  address: {
    description: linha.addr_description,
    province: linha.addr_province,
    municipality: linha.addr_municipality,
    ...(linha.addr_locality !== null ? { locality: linha.addr_locality } : {}),
    ...(linha.addr_reference !== null ? { reference: linha.addr_reference } : {}),
    ...(numeroOuUndefined(linha.addr_latitude) !== undefined
      ? { latitude: Number(linha.addr_latitude) }
      : {}),
    ...(numeroOuUndefined(linha.addr_longitude) !== undefined
      ? { longitude: Number(linha.addr_longitude) }
      : {}),
  },
  ordersCount: Number(linha.orders_count),
  isActive: linha.is_active,
  createdAt: linha.created_at.toISOString(),
});

const CAMPOS = `c.id, c.name, c.phone, c.email, c.addr_description, c.addr_province,
                c.addr_municipality, c.addr_locality, c.addr_reference,
                c.addr_latitude, c.addr_longitude, c.is_active, c.created_at,
                (SELECT count(*) FROM orders o WHERE o.customer_id = c.id) AS orders_count`;

/** Every query in this file filters on company_id. There is no overload that does not. */
export const listar = async (
  companyId: string,
  filtros: { search?: string; page: number; pageSize: number },
): Promise<{ linhas: LinhaCliente[]; total: number }> => {
  const termo = filtros.search !== undefined ? `%${filtros.search}%` : null;

  const { rows } = await query<LinhaCliente & { total: string }>(
    `SELECT ${CAMPOS}, count(*) OVER() AS total
       FROM customers c
      WHERE c.company_id = $1
        AND c.is_active
        AND ($2::text IS NULL OR c.name ILIKE $2 OR c.phone ILIKE $2)
      ORDER BY c.name
      LIMIT $3 OFFSET $4`,
    [companyId, termo, filtros.pageSize, (filtros.page - 1) * filtros.pageSize],
  );

  return { linhas: rows, total: rows[0] !== undefined ? Number(rows[0].total) : 0 };
};

export const porId = async (companyId: string, id: string): Promise<LinhaCliente | null> => {
  const { rows } = await query<LinhaCliente>(
    `SELECT ${CAMPOS} FROM customers c WHERE c.company_id = $1 AND c.id = $2`,
    [companyId, id],
  );
  return rows[0] ?? null;
};

/**
 * The optional fields are written `?: T | undefined` rather than `?: T` because
 * that is what a validated payload actually looks like under
 * `exactOptionalPropertyTypes`: an omitted field and a field explicitly set to
 * undefined both mean "no value", and both end up as NULL in the column.
 */
export interface NovoCliente {
  name: string;
  phone: string;
  email?: string | undefined;
  address: {
    description: string;
    province: string;
    municipality: string;
    locality?: string | undefined;
    reference?: string | undefined;
    latitude?: number | undefined;
    longitude?: number | undefined;
  };
}

export const criar = async (companyId: string, dados: NovoCliente): Promise<LinhaCliente> => {
  const { rows } = await query<{ id: string }>(
    `INSERT INTO customers
       (company_id, name, phone, email, addr_description, addr_province, addr_municipality,
        addr_locality, addr_reference, addr_latitude, addr_longitude)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING id`,
    [
      companyId,
      dados.name,
      dados.phone,
      dados.email ?? null,
      dados.address.description,
      dados.address.province,
      dados.address.municipality,
      dados.address.locality ?? null,
      dados.address.reference ?? null,
      dados.address.latitude ?? null,
      dados.address.longitude ?? null,
    ],
  );

  const criado = rows[0];
  if (criado === undefined) throw new Error('cliente não foi criado');
  const linha = await porId(companyId, criado.id);
  if (linha === null) throw new Error('cliente criado mas não encontrado');
  return linha;
};
