import type { ReactNode } from 'react';
import './PageHeader.css';

interface Props {
  readonly title: string;
  readonly description?: string;
  readonly actions?: ReactNode;
}

export const PageHeader = ({ title, description, actions }: Props) => (
  <header className="cabecalho-pagina">
    <div className="cabecalho-pagina__texto">
      <h1>{title}</h1>
      {description !== undefined ? <p>{description}</p> : null}
    </div>
    {actions !== undefined ? <div className="cabecalho-pagina__acoes">{actions}</div> : null}
  </header>
);
