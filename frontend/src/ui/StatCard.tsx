import type { ReactNode } from 'react';
import type { Tone } from '../domain/orderStatus';
import './StatCard.css';

interface Props {
  readonly label: string;
  readonly value: number | string;
  readonly hint?: string;
  readonly tone?: Tone;
  readonly icon?: ReactNode;
}

/**
 * A KPI is a number and its name. It is not a card the height of a phone: six of
 * these have to fit on one row without pushing the tables below the fold.
 */
export const StatCard = ({ label, value, hint, tone = 'neutral', icon }: Props) => (
  <div className="kpi" data-tone={tone}>
    <div className="kpi__topo">
      <span className="kpi__rotulo">{label}</span>
      {icon !== undefined ? <span className="kpi__icone">{icon}</span> : null}
    </div>
    <strong className="kpi__valor">{value}</strong>
    {hint !== undefined ? <span className="kpi__nota">{hint}</span> : null}
  </div>
);
