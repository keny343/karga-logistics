import { query } from '../config/database.js';
import type { Autenticado } from '../types/domain.js';

/**
 * Turns a session into the slice of data it may see.
 *
 * A driver sees the parcels he is carrying, a customer sees the orders placed for
 * them, an operator sees the company. None of this is ever taken from the query
 * string, and it is resolved here rather than in each controller so the order list
 * and the map cannot disagree about what a driver is allowed to see.
 *
 * `'vazio'` means the session has a role that is scoped to a record that does not
 * exist — a driver account with no driver row. The answer is an empty list, not
 * everything: a missing link must fail closed.
 */
export type Ambito = { driverId?: string; customerId?: string } | 'vazio';

export const ambitoDe = async (auth: Autenticado | undefined): Promise<Ambito> => {
  if (auth === undefined) return 'vazio';

  if (auth.role === 'MOTORISTA') {
    const { rows } = await query<{ id: string }>(
      'SELECT id FROM drivers WHERE company_id = $1 AND user_id = $2 AND is_active',
      [auth.companyId, auth.userId],
    );
    const motorista = rows[0];
    return motorista === undefined ? 'vazio' : { driverId: motorista.id };
  }

  if (auth.role === 'CLIENTE') {
    const { rows } = await query<{ id: string }>(
      'SELECT id FROM customers WHERE company_id = $1 AND user_id = $2 AND is_active',
      [auth.companyId, auth.userId],
    );
    const cliente = rows[0];
    return cliente === undefined ? 'vazio' : { customerId: cliente.id };
  }

  return {};
};
