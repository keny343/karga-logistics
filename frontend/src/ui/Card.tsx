import type { ReactNode } from 'react';
import './Card.css';

interface Props {
  readonly title?: string;
  readonly actions?: ReactNode;
  readonly padded?: boolean;
  readonly children: ReactNode;
}

/** A bordered surface. Separation comes from the border, not from a shadow. */
export const Card = ({ title, actions, padded = true, children }: Props) => (
  <section className="card">
    {title !== undefined || actions !== undefined ? (
      <header className="card__header">
        {title !== undefined ? <h3 className="card__title">{title}</h3> : <span />}
        {actions !== undefined ? <div className="card__actions">{actions}</div> : null}
      </header>
    ) : null}
    <div className="card__body" data-padded={padded}>
      {children}
    </div>
  </section>
);
