import type { ReactNode } from 'react';
import {
  driverStatusLabel,
  driverStatusTone,
  statusLabel,
  statusTone,
  type DriverStatus,
  type OrderStatus,
  type Tone,
} from '../domain/orderStatus';
import './Badge.css';

interface BadgeProps {
  readonly tone?: Tone;
  readonly children: ReactNode;
}

export const Badge = ({ tone = 'neutral', children }: BadgeProps) => (
  <span className="badge" data-tone={tone}>
    {children}
  </span>
);

/**
 * Status always ships as a word plus a colour. Colour alone would exclude anyone
 * who cannot distinguish these hues, and a screen reader reads nothing from a
 * background.
 */
export const StatusBadge = ({ status }: { readonly status: OrderStatus }) => (
  <Badge tone={statusTone(status)}>{statusLabel(status)}</Badge>
);

export const DriverStatusBadge = ({ status }: { readonly status: DriverStatus }) => (
  <Badge tone={driverStatusTone(status)}>{driverStatusLabel(status)}</Badge>
);
