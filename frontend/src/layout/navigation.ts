import {
  Bell,
  ClipboardList,
  LayoutDashboard,
  Map,
  Package,
  Search,
  Settings,
  Truck,
  Users,
} from 'lucide-react';
import type { Role } from '../api/client';

export interface ItemNav {
  readonly to: string;
  readonly label: string;
  readonly icon: typeof Package;
  readonly roles: readonly Role[];
  /** Screens that arrive in a later phase are shown as disabled, not hidden. */
  readonly pending?: boolean;
}

export interface GrupoNav {
  readonly title: string;
  readonly items: readonly ItemNav[];
}

const TODOS: readonly Role[] = ['ADMIN', 'OPERADOR', 'MOTORISTA', 'CLIENTE'];
const OPERACAO: readonly Role[] = ['ADMIN', 'OPERADOR'];

/**
 * One source of truth for navigation, filtered by role. The menu never offers a
 * page the API would refuse - and the API refuses independently, because a hidden
 * link is not a permission check.
 */
export const NAVEGACAO: readonly GrupoNav[] = [
  {
    title: 'Principal',
    items: [
      { to: '/', label: 'Dashboard', icon: LayoutDashboard, roles: TODOS },
      { to: '/encomendas', label: 'Encomendas', icon: Package, roles: TODOS },
    ],
  },
  {
    title: 'Operações',
    items: [
      { to: '/motoristas', label: 'Motoristas', icon: Truck, roles: OPERACAO },
      { to: '/clientes', label: 'Clientes', icon: Users, roles: OPERACAO },
      // The map narrows itself by session, so a driver seeing only his own parcel on
      // it is useful rather than a leak.
      { to: '/mapa', label: 'Mapa', icon: Map, roles: TODOS },
      { to: '/rastreio', label: 'Rastreamento', icon: Search, roles: TODOS, pending: true },
    ],
  },
  {
    title: 'Gestão',
    items: [
      { to: '/relatorios', label: 'Relatórios', icon: ClipboardList, roles: OPERACAO },
      { to: '/notificacoes', label: 'Notificações', icon: Bell, roles: TODOS, pending: true },
      { to: '/definicoes', label: 'Definições', icon: Settings, roles: ['ADMIN'], pending: true },
    ],
  },
];

export const gruposPara = (papel: Role): readonly GrupoNav[] =>
  NAVEGACAO.map((grupo) => ({
    ...grupo,
    items: grupo.items.filter((item) => item.roles.includes(papel)),
  })).filter((grupo) => grupo.items.length > 0);
