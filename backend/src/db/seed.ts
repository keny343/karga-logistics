import { closePool, query, transaction } from '../config/database.js';
import { hashDePassword } from '../services/auth.service.js';
import { logger } from '../utils/logger.js';
import type { OrderStatus } from '../domain/orderStatus.js';

/**
 * Demonstration data: one carrier, one account per role, real Luanda municipalities
 * and orders spread across the state machine so every screen has something honest
 * to show.
 *
 * Idempotent by design - it can be run again on a database that already has the
 * data, and it will not duplicate it. Passwords are the same for every demo
 * account and exist only here; there is nothing real behind them.
 */

const EMPRESA = { name: 'Karga Logistics Luanda', slug: 'karga-luanda', phone: '+244923000000' };

const PASSWORD_DEMO = 'Karga2026!';

const CONTAS = [
  { name: 'Adnírcio Inocêncio', email: 'admin@karga.ao', role: 'ADMIN' as const },
  { name: 'Beatriz Kiala', email: 'operador@karga.ao', role: 'OPERADOR' as const },
  { name: 'Manuel Cardoso', email: 'motorista@karga.ao', role: 'MOTORISTA' as const },
  { name: 'Luísa Domingos', email: 'cliente@karga.ao', role: 'CLIENTE' as const },
];

const CLIENTES = [
  {
    name: 'Farmácia Talatona',
    phone: '+244923111222',
    email: 'compras@farmaciatalatona.ao',
    municipality: 'Talatona',
    description: 'Via S8, Edifício Kilamba Center, loja 4',
    reference: 'Em frente ao Talatona Imperial',
    latitude: -8.9167,
    longitude: 13.1833,
  },
  {
    name: 'Mercearia do Bairro Operário',
    phone: '+244923333444',
    municipality: 'Ingombota',
    description: 'Rua Comandante Che Guevara 118',
    latitude: -8.8115,
    longitude: 13.2302,
  },
  {
    name: 'Luísa Domingos',
    phone: '+244923555666',
    email: 'cliente@karga.ao',
    municipality: 'Viana',
    description: 'Bairro Vila Flor, casa 27',
    reference: 'Portão azul, junto à escola',
    latitude: -8.9036,
    longitude: 13.3741,
  },
  {
    name: 'Restaurante Ilha Verde',
    phone: '+244923777888',
    municipality: 'Ilha do Cabo',
    description: 'Avenida Murtala Mohamed, quiosque 12',
    latitude: -8.7911,
    longitude: 13.2404,
  },
  {
    name: 'Clínica Girassol Anexo',
    phone: '+244923999000',
    municipality: 'Maianga',
    description: 'Rua Amílcar Cabral 210',
    latitude: -8.8207,
    longitude: 13.2317,
  },
];

const MOTORISTAS = [
  { name: 'Manuel Cardoso', phone: '+244924111000', vehicleType: 'MOTA' as const, vehiclePlate: 'LD-42-19-MA', email: 'motorista@karga.ao' },
  { name: 'Sílvia Neto', phone: '+244924222000', vehicleType: 'CARRO' as const, vehiclePlate: 'LD-88-01-CA' },
  { name: 'João Baptista', phone: '+244924333000', vehicleType: 'CARRINHA' as const, vehiclePlate: 'LD-11-77-CR' },
];

const ARMAZEM = {
  description: 'Armazém Karga, Estrada de Cacuaco km 8, pavilhão B',
  province: 'Luanda',
  municipality: 'Cacuaco',
  latitude: -8.7776,
  longitude: 13.3672,
};

/** Each entry is the path an order walked, ending where it is now. */
const GUIOES: readonly {
  readonly cliente: number;
  readonly descricao: string;
  readonly kg: number;
  readonly kz: number;
  readonly caminho: readonly OrderStatus[];
  readonly motorista?: number;
  readonly horasAtras: number;
  readonly prazoHoras?: number;
  readonly nota?: string;
}[] = [
  { cliente: 0, descricao: 'Caixa de medicamentos refrigerados', kg: 6.5, kz: 185000, caminho: ['CONFIRMADO', 'PREPARANDO', 'PRONTO', 'ATRIBUIDO', 'RECOLHIDO', 'EM_ENTREGA', 'ENTREGUE'], motorista: 1, horasAtras: 52, prazoHoras: 48 },
  { cliente: 1, descricao: 'Duas grades de bebidas', kg: 24, kz: 96000, caminho: ['CONFIRMADO', 'PREPARANDO', 'PRONTO', 'ATRIBUIDO', 'RECOLHIDO', 'EM_ENTREGA', 'ENTREGUE'], motorista: 2, horasAtras: 30, prazoHoras: 24 },
  { cliente: 2, descricao: 'Encomenda pessoal — electrodomésticos pequenos', kg: 9, kz: 240000, caminho: ['CONFIRMADO', 'PREPARANDO', 'PRONTO', 'ATRIBUIDO', 'RECOLHIDO', 'EM_ENTREGA'], motorista: 0, horasAtras: 5, prazoHoras: 8 },
  { cliente: 3, descricao: 'Peixe fresco em caixa térmica', kg: 18, kz: 132000, caminho: ['CONFIRMADO', 'PREPARANDO', 'PRONTO', 'ATRIBUIDO', 'RECOLHIDO'], motorista: 1, horasAtras: 3, prazoHoras: 6 },
  { cliente: 4, descricao: 'Material clínico descartável', kg: 12, kz: 310000, caminho: ['CONFIRMADO', 'PREPARANDO', 'PRONTO', 'ATRIBUIDO'], motorista: 2, horasAtras: 2, prazoHoras: 10 },
  { cliente: 0, descricao: 'Reposição de stock — analgésicos', kg: 4, kz: 74000, caminho: ['CONFIRMADO', 'PREPARANDO', 'PRONTO'], horasAtras: 6, prazoHoras: 12 },
  { cliente: 1, descricao: 'Sacos de arroz 25 kg', kg: 50, kz: 210000, caminho: ['CONFIRMADO', 'PREPARANDO'], horasAtras: 4, prazoHoras: 20 },
  { cliente: 4, descricao: 'Consumíveis de laboratório', kg: 7, kz: 158000, caminho: ['CONFIRMADO'], horasAtras: 2, prazoHoras: 30 },
  { cliente: 2, descricao: 'Documentos e contratos', kg: 0.4, kz: 15000, caminho: [], horasAtras: 1, prazoHoras: 26 },
  { cliente: 3, descricao: 'Grelhador industrial', kg: 46, kz: 890000, caminho: [], horasAtras: 0.5, prazoHoras: 40 },
  {
    cliente: 1,
    descricao: 'Encomenda mista — mercearia',
    kg: 15,
    kz: 88000,
    caminho: ['CONFIRMADO', 'PREPARANDO', 'PRONTO', 'ATRIBUIDO', 'RECOLHIDO', 'EM_ENTREGA', 'FALHA_ENTREGA'],
    motorista: 1,
    horasAtras: 26,
    prazoHoras: 20,
    nota: 'Ninguém no local. Cliente pediu nova tentativa amanhã.',
  },
  {
    cliente: 0,
    descricao: 'Vacinas — cadeia de frio',
    kg: 3,
    kz: 420000,
    caminho: ['CONFIRMADO', 'PREPARANDO', 'PRONTO', 'CANCELADO'],
    horasAtras: 20,
    nota: 'Cancelada pelo cliente antes da recolha.',
  },
  { cliente: 4, descricao: 'Equipamento devolvido ao fornecedor', kg: 11, kz: 0, caminho: ['CONFIRMADO', 'PREPARANDO', 'PRONTO', 'ATRIBUIDO', 'RECOLHIDO', 'EM_ENTREGA', 'FALHA_ENTREGA', 'DEVOLVIDO'], motorista: 2, horasAtras: 74, prazoHoras: 70, nota: 'Endereço não existe. Devolvido ao armazém.' },
  { cliente: 2, descricao: 'Móvel desmontado', kg: 38, kz: 265000, caminho: ['CONFIRMADO', 'PREPARANDO', 'PRONTO'], horasAtras: 40, prazoHoras: 12 },
];

const horasAtras = (horas: number): Date => new Date(Date.now() - horas * 60 * 60 * 1000);
const horasAFrente = (base: Date, horas: number): Date =>
  new Date(base.getTime() + horas * 60 * 60 * 1000);

const seed = async (): Promise<void> => {
  const existente = await query<{ id: string }>('SELECT id FROM companies WHERE slug = $1', [
    EMPRESA.slug,
  ]);
  if (existente.rows.length > 0) {
    logger.info('seed skipped: demo company already present', { slug: EMPRESA.slug });
    return;
  }

  const hash = await hashDePassword(PASSWORD_DEMO);

  await transaction(async (client) => {
    const empresa = await client.query<{ id: string }>(
      'INSERT INTO companies (name, slug, phone) VALUES ($1, $2, $3) RETURNING id',
      [EMPRESA.name, EMPRESA.slug, EMPRESA.phone],
    );
    const companyId = empresa.rows[0]?.id;
    if (companyId === undefined) throw new Error('empresa não criada');

    const utilizadores = new Map<string, string>();
    for (const conta of CONTAS) {
      const criado = await client.query<{ id: string }>(
        `INSERT INTO users (company_id, name, email, password_hash, role)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [companyId, conta.name, conta.email, hash, conta.role],
      );
      const id = criado.rows[0]?.id;
      if (id === undefined) throw new Error(`utilizador ${conta.email} não criado`);
      utilizadores.set(conta.email, id);
    }

    const adminId = utilizadores.get('admin@karga.ao');
    const operadorId = utilizadores.get('operador@karga.ao');
    if (adminId === undefined || operadorId === undefined) throw new Error('contas base em falta');

    const clientes: string[] = [];
    for (const cliente of CLIENTES) {
      const contaLigada =
        cliente.email !== undefined ? (utilizadores.get(cliente.email) ?? null) : null;
      const criado = await client.query<{ id: string }>(
        `INSERT INTO customers
           (company_id, user_id, name, phone, email, addr_description, addr_province,
            addr_municipality, addr_reference, addr_latitude, addr_longitude)
         VALUES ($1, $2, $3, $4, $5, $6, 'Luanda', $7, $8, $9, $10)
         RETURNING id`,
        [
          companyId,
          contaLigada,
          cliente.name,
          cliente.phone,
          cliente.email ?? null,
          cliente.description,
          cliente.municipality,
          cliente.reference ?? null,
          cliente.latitude,
          cliente.longitude,
        ],
      );
      const id = criado.rows[0]?.id;
      if (id === undefined) throw new Error(`cliente ${cliente.name} não criado`);
      clientes.push(id);
    }

    const motoristas: string[] = [];
    for (const motorista of MOTORISTAS) {
      const contaLigada =
        motorista.email !== undefined ? (utilizadores.get(motorista.email) ?? null) : null;
      const criado = await client.query<{ id: string }>(
        `INSERT INTO drivers
           (company_id, user_id, name, phone, vehicle_type, vehicle_plate, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'DISPONIVEL')
         RETURNING id`,
        [
          companyId,
          contaLigada,
          motorista.name,
          motorista.phone,
          motorista.vehicleType,
          motorista.vehiclePlate,
        ],
      );
      const id = criado.rows[0]?.id;
      if (id === undefined) throw new Error(`motorista ${motorista.name} não criado`);
      motoristas.push(id);
    }

    for (const guiao of GUIOES) {
      const clienteId = clientes[guiao.cliente];
      const cliente = CLIENTES[guiao.cliente];
      if (clienteId === undefined || cliente === undefined) throw new Error('cliente inválido no guião');

      const criadaEm = horasAtras(guiao.horasAtras);
      const motoristaId =
        guiao.motorista !== undefined ? (motoristas[guiao.motorista] ?? null) : null;

      const encomenda = await client.query<{ id: string; code: string }>(
        `INSERT INTO orders (
           company_id, code, customer_id, driver_id, status, description, weight_grams, value_cents,
           origin_description, origin_province, origin_municipality, origin_latitude, origin_longitude,
           dest_description, dest_province, dest_municipality, dest_reference,
           dest_latitude, dest_longitude,
           expected_delivery_at, notes, created_by, created_at, updated_at
         ) VALUES (
           $1, 'KRG-' || lpad(nextval('order_code_seq')::text, 6, '0'), $2, $3, 'CRIADO', $4, $5, $6,
           $7, 'Luanda', $8, $9, $10,
           $11, 'Luanda', $12, $13, $14, $15,
           $16, $17, $18, $19, $19
         ) RETURNING id, code`,
        [
          companyId,
          clienteId,
          motoristaId,
          guiao.descricao,
          Math.round(guiao.kg * 1000),
          guiao.kz * 100,
          ARMAZEM.description,
          ARMAZEM.municipality,
          ARMAZEM.latitude,
          ARMAZEM.longitude,
          cliente.description,
          cliente.municipality,
          cliente.reference ?? null,
          cliente.latitude,
          cliente.longitude,
          guiao.prazoHoras !== undefined ? horasAFrente(criadaEm, guiao.prazoHoras) : null,
          guiao.nota ?? null,
          operadorId,
          criadaEm,
        ],
      );

      const orderId = encomenda.rows[0]?.id;
      if (orderId === undefined) throw new Error('encomenda não criada');

      // Walk the script, writing one history row per step at a plausible time, so
      // the timeline on screen is not a stack of identical timestamps.
      await client.query(
        `INSERT INTO order_status_history (order_id, company_id, status, changed_by, actor_label, created_at)
         VALUES ($1, $2, 'CRIADO', $3, $4, $5)`,
        [orderId, companyId, operadorId, 'Beatriz Kiala (operador@karga.ao)', criadaEm],
      );

      let anterior: OrderStatus = 'CRIADO';
      let momento = criadaEm;
      const passo = guiao.caminho.length > 0 ? guiao.horasAtras / (guiao.caminho.length + 1) : 0;

      for (const [indice, estado] of guiao.caminho.entries()) {
        momento = horasAFrente(momento, Math.max(passo, 0.25));
        const ultimo = indice === guiao.caminho.length - 1;
        await client.query(
          `INSERT INTO order_status_history
             (order_id, company_id, status, previous_status, changed_by, actor_label, note, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            orderId,
            companyId,
            estado,
            anterior,
            operadorId,
            'Beatriz Kiala (operador@karga.ao)',
            ultimo ? (guiao.nota ?? null) : null,
            momento,
          ],
        );
        anterior = estado;
      }

      const estadoFinal = guiao.caminho.at(-1) ?? 'CRIADO';
      const terminou = ['ENTREGUE', 'CANCELADO', 'DEVOLVIDO'].includes(estadoFinal);

      await client.query(
        `UPDATE orders SET status = $2, completed_at = $3, updated_at = $4 WHERE id = $1`,
        [orderId, estadoFinal, terminou ? momento : null, momento],
      );
    }

    // Drivers still holding a parcel are out on delivery; the rest are available.
    await client.query(
      `UPDATE drivers d
          SET status = CASE
                WHEN EXISTS (
                  SELECT 1 FROM orders o
                   WHERE o.driver_id = d.id
                     AND o.status IN ('ATRIBUIDO', 'RECOLHIDO', 'EM_ENTREGA')
                ) THEN 'EM_ENTREGA'::driver_status
                ELSE 'DISPONIVEL'::driver_status
              END
        WHERE d.company_id = $1`,
      [companyId],
    );

    logger.info('seed complete', {
      company: EMPRESA.slug,
      users: CONTAS.length,
      customers: CLIENTES.length,
      drivers: MOTORISTAS.length,
      orders: GUIOES.length,
    });
  });
};

seed()
  .then(() => closePool())
  .then(() => process.exit(0))
  .catch((erro: unknown) => {
    logger.error('seed failed', { message: erro instanceof Error ? erro.message : String(erro) });
    process.exit(1);
  });
