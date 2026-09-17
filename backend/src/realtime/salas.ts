import type { Autenticado } from '../types/domain.js';

/**
 * Room names, in one place.
 *
 * Every room begins with the company, so a broadcast cannot reach another tenant
 * even if a later handler forgets to think about it: there is no room that spans two
 * companies, and no client is ever in a room it was not put in at connect time from
 * its own session.
 */
export const salaOperacao = (companyId: string): string => `empresa:${companyId}:operacao`;

export const salaMotorista = (companyId: string, driverId: string): string =>
  `empresa:${companyId}:motorista:${driverId}`;

export const salaCliente = (companyId: string, customerId: string): string =>
  `empresa:${companyId}:cliente:${customerId}`;

/**
 * Which rooms a session belongs in. Operators get the company feed; a driver and a
 * customer get only the room named after their own record, so narrowing happens at
 * subscription time rather than by filtering payloads afterwards — a payload that
 * arrives at the wrong browser has already leaked.
 */
export const salasDe = (
  auth: Autenticado,
  vinculo: { driverId?: string; customerId?: string },
): readonly string[] => {
  if (auth.role === 'ADMIN' || auth.role === 'OPERADOR') return [salaOperacao(auth.companyId)];

  if (auth.role === 'MOTORISTA') {
    return vinculo.driverId === undefined
      ? []
      : [salaMotorista(auth.companyId, vinculo.driverId)];
  }

  return vinculo.customerId === undefined
    ? []
    : [salaCliente(auth.companyId, vinculo.customerId)];
};
