import type { ReactNode } from 'react';
import './Table.css';

interface Coluna<T> {
  readonly key: string;
  readonly header: string;
  readonly render: (linha: T) => ReactNode;
  /** Right-aligned for quantities, so digits line up down the column. */
  readonly numeric?: boolean;
  /** Hidden below 768px, for columns that are context rather than identity. */
  readonly secondary?: boolean;
}

interface Props<T> {
  readonly columns: readonly Coluna<T>[];
  readonly rows: readonly T[];
  readonly rowKey: (linha: T) => string;
  readonly onRowClick?: (linha: T) => void;
  readonly caption?: string;
}

/**
 * Dense rows, one border between them, a discreet hover.
 *
 * `onRowClick` is a convenience for a mouse and nothing else: a `<tr>` with a
 * click handler is unreachable by keyboard, so a table that uses it must also put
 * a real link or button in one of its cells. Clicks that land on such a control
 * are left alone here, or Ctrl-clicking a link would open a tab and navigate this
 * one at the same time.
 */
export const Table = <T,>({ columns, rows, rowKey, onRowClick, caption }: Props<T>) => (
  <div className="tabela__envolvente">
    <table className="tabela">
      {caption !== undefined ? <caption className="sr-only">{caption}</caption> : null}
      <thead>
        <tr>
          {columns.map((coluna) => (
            <th
              key={coluna.key}
              scope="col"
              data-numeric={coluna.numeric === true}
              data-secondary={coluna.secondary === true}
            >
              {coluna.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((linha) => (
          <tr
            key={rowKey(linha)}
            data-clicavel={onRowClick !== undefined}
            {...(onRowClick !== undefined
              ? {
                  onClick: (evento) => {
                    const alvo = evento.target as HTMLElement;
                    if (alvo.closest('a, button, input, select, label') !== null) return;
                    onRowClick(linha);
                  },
                }
              : {})}
          >
            {columns.map((coluna) => (
              <td
                key={coluna.key}
                data-numeric={coluna.numeric === true}
                data-secondary={coluna.secondary === true}
              >
                {coluna.render(linha)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

export type { Coluna as TableColumn };
