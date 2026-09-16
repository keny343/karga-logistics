import { z } from 'zod';
import { ORDER_STATUSES } from '../domain/orderStatus.js';
import { DRIVER_STATUSES, VEHICLE_TYPES } from '../types/domain.js';

/**
 * Validation lives here, once, and the controllers only call it. Every string is
 * trimmed and bounded: an unbounded text field is a way to fill a disk.
 */

const texto = (min: number, max: number) => z.string().trim().min(min).max(max);

/** Angolan mobile numbers: nine digits after +244. */
export const telefone = z
  .string()
  .trim()
  .transform((valor) => {
    const digitos = valor.replace(/\D/g, '');
    const nacional = digitos.startsWith('244') ? digitos.slice(3) : digitos;
    return `+244${nacional}`;
  })
  .refine((valor) => /^\+244[0-9]{9}$/.test(valor), {
    message: 'Número inválido. Usa nove dígitos, por exemplo 923 456 789.',
  });

export const enderecoSchema = z.object({
  description: texto(3, 300),
  province: texto(2, 80).default('Luanda'),
  municipality: texto(2, 80),
  locality: texto(2, 80).optional(),
  reference: texto(2, 200).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
});

export const clienteSchema = z.object({
  name: texto(2, 160),
  phone: telefone,
  email: z.string().trim().email('Email inválido.').max(200).optional(),
  address: enderecoSchema,
});

export const motoristaSchema = z.object({
  name: texto(2, 160),
  phone: telefone,
  documentId: texto(4, 40).optional(),
  vehicleType: z.enum(VEHICLE_TYPES).optional(),
  vehiclePlate: texto(4, 20).optional(),
});

export const estadoMotoristaSchema = z.object({
  status: z.enum(DRIVER_STATUSES),
});

export const encomendaSchema = z.object({
  customerId: z.string().uuid('Cliente inválido.'),
  description: texto(3, 500),
  // Weight and value are integers in grams and cêntimos; the interface converts.
  weightGrams: z.number().int().min(0).max(2_000_000),
  valueCents: z.number().int().min(0).max(100_000_000_000),
  origin: enderecoSchema,
  destination: enderecoSchema,
  expectedAt: z.string().datetime({ offset: true }).optional(),
  notes: texto(1, 1000).optional(),
});

export const mudancaEstadoSchema = z.object({
  status: z.enum(ORDER_STATUSES),
  note: texto(1, 500).optional(),
});

export const atribuicaoSchema = z.object({
  driverId: z.string().uuid('Motorista inválido.'),
});

export const idSchema = z.string().uuid('Identificador inválido.');

/** Page size is capped so a caller cannot ask for the whole table in one request. */
export const filtrosSchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: texto(1, 120).optional(),
  status: z.string().trim().max(40).optional(),
  driverId: z.string().uuid().optional(),
  late: z
    .enum(['true', 'false'])
    .transform((valor) => valor === 'true')
    .optional(),
});
