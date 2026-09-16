import type { ReactNode } from 'react';
import { AlertCircle, Inbox, RefreshCw } from 'lucide-react';
import { Button } from './Button';
import './States.css';

/**
 * Every screen that loads data owes the user one of these. An area that is simply
 * blank tells them nothing about whether to wait, retry or give up.
 */

export const LoadingState = ({ rows = 4 }: { readonly rows?: number }) => (
  <div className="state" role="status" aria-live="polite">
    <span className="sr-only">A carregar…</span>
    <div className="skeleton-lista" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div className="skeleton" key={i} />
      ))}
    </div>
  </div>
);

interface EmptyProps {
  readonly title: string;
  readonly description?: string;
  readonly action?: ReactNode;
}

export const EmptyState = ({ title, description, action }: EmptyProps) => (
  <div className="state state--centro">
    <Inbox className="state__icone" size={28} aria-hidden="true" />
    <p className="state__titulo">{title}</p>
    {description !== undefined ? <p className="state__texto">{description}</p> : null}
    {action}
  </div>
);

interface ErrorProps {
  readonly title?: string;
  readonly message: string;
  readonly requestId?: string;
  readonly onRetry?: () => void;
}

export const ErrorState = ({
  title = 'Não foi possível carregar os dados.',
  message,
  requestId,
  onRetry,
}: ErrorProps) => (
  <div className="state state--centro" role="alert">
    <AlertCircle className="state__icone state__icone--erro" size={28} aria-hidden="true" />
    <p className="state__titulo">{title}</p>
    <p className="state__texto">{message}</p>
    {/* The id is here so a user can quote it and the cause can be found in the logs. */}
    {requestId !== undefined ? <p className="state__ref mono">Referência: {requestId}</p> : null}
    {onRetry !== undefined ? (
      <Button icon={<RefreshCw size={16} />} onClick={onRetry}>
        Tentar de novo
      </Button>
    ) : null}
  </div>
);
