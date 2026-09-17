import { statusLabel, statusTone, type OrderStatus } from '../domain/orderStatus';
import './Distribution.css';

interface Props {
  readonly dados: readonly { readonly status: OrderStatus; readonly count: number }[];
  /**
   * The denominator. Passed in rather than summed here because the dashboard and the
   * report count different things — everything ever, and everything in a window —
   * and a percentage of the wrong total is worse than no percentage.
   */
  readonly total?: number;
}

/**
 * How many orders sit in each state, as a row of bars. The colour is the status's
 * own semantic tone, so a state that is red here is red in a badge and red in the
 * timeline.
 */
export const Distribution = ({ dados, total }: Props) => {
  const soma = total ?? dados.reduce((acumulado, item) => acumulado + item.count, 0);
  const ordenado = [...dados].sort((a, b) => b.count - a.count);

  return (
    <ul className="distribuicao">
      {ordenado.map((item) => (
        <li className="distribuicao__linha" key={item.status}>
          <span className="distribuicao__rotulo">{statusLabel(item.status)}</span>
          <span className="distribuicao__barra" aria-hidden="true">
            <span
              data-tone={statusTone(item.status)}
              style={{ width: `${soma === 0 ? 0 : (item.count / soma) * 100}%` }}
            />
          </span>
          <span className="distribuicao__valor">{item.count}</span>
        </li>
      ))}
    </ul>
  );
};
