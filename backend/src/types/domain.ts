export const ROLES = ['ADMIN', 'OPERADOR', 'MOTORISTA', 'CLIENTE'] as const;
export type Role = (typeof ROLES)[number];

export const isRole = (valor: unknown): valor is Role =>
  typeof valor === 'string' && (ROLES as readonly string[]).includes(valor);

/** Who is making the request, resolved from the session cookie and never from input. */
export interface Autenticado {
  readonly sessionId: string;
  readonly userId: string;
  readonly companyId: string;
  readonly companyName: string;
  readonly name: string;
  readonly email: string;
  readonly role: Role;
}

export const DRIVER_STATUSES = ['DISPONIVEL', 'EM_ENTREGA', 'INDISPONIVEL', 'OFFLINE'] as const;
export type DriverStatus = (typeof DRIVER_STATUSES)[number];

export const VEHICLE_TYPES = ['MOTA', 'CARRO', 'CARRINHA'] as const;
export type VehicleType = (typeof VEHICLE_TYPES)[number];
