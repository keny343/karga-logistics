import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import './Button.css';

type Variant = 'primary' | 'secondary' | 'success' | 'danger' | 'ghost';

interface Props extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  readonly variant?: Variant;
  readonly size?: 'sm' | 'md';
  readonly loading?: boolean;
  readonly icon?: ReactNode;
  readonly children?: ReactNode;
}

/**
 * A button that is loading is also disabled: the operator must not be able to
 * fire a second assignment while the first is still in flight.
 */
export const Button = ({
  variant = 'secondary',
  size = 'md',
  loading = false,
  icon,
  children,
  disabled,
  type = 'button',
  ...resto
}: Props) => (
  <button
    type={type}
    className="btn"
    data-variant={variant}
    data-size={size}
    disabled={disabled === true || loading}
    aria-busy={loading}
    {...resto}
  >
    {loading ? <Loader2 className="btn__spinner" size={16} aria-hidden="true" /> : icon}
    {children}
  </button>
);
