import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { Tone } from '../domain/orderStatus';
import './StatCard.css';

interface Props {
  readonly label: string;
  readonly value: number | string;
  readonly hint?: string;
  readonly tone?: Tone;
  readonly icon?: ReactNode;
  /** When a number has a list behind it, the card becomes the way to reach it. */
  readonly to?: string;
}

/**
 * A KPI is a number and its name. It is not a card the height of a phone: six of
 * these have to fit on one row without pushing the tables below the fold.
 *
 * "Seven late" is a question, and the answer is a filtered list. Where such a list
 * exists the whole card is a link, so the number is one click from the rows behind
 * it instead of leaving the reader to reconstruct the filter by hand.
 */
export const StatCard = ({ label, value, hint, tone = 'neutral', icon, to }: Props) => {
  const conteudo = (
    <>
      <div className="kpi__topo">
        <span className="kpi__rotulo">{label}</span>
        {icon !== undefined ? <span className="kpi__icone">{icon}</span> : null}
      </div>
      <strong className="kpi__valor">{value}</strong>
      {hint !== undefined ? <span className="kpi__nota">{hint}</span> : null}
    </>
  );

  return to === undefined ? (
    <div className="kpi" data-tone={tone}>
      {conteudo}
    </div>
  ) : (
    <Link className="kpi" data-tone={tone} to={to}>
      {conteudo}
    </Link>
  );
};
