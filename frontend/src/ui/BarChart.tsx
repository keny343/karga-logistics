import './BarChart.css';

export interface PontoBarra {
  /** `YYYY-MM-DD`, or any short label already formatted for reading. */
  readonly label: string;
  readonly values: readonly number[];
}

export interface SerieBarra {
  readonly label: string;
  readonly tone: 'primary' | 'success';
}

interface Props {
  readonly pontos: readonly PontoBarra[];
  readonly series: readonly SerieBarra[];
  readonly caption: string;
}

/**
 * A bar chart in plain CSS. A charting library would add a dependency and a hundred
 * kilobytes to draw a few dozen rectangles, and this version reads the same on a
 * modest machine.
 *
 * The bars are decorative — a screen reader gets the same numbers from the table
 * below them, which is the honest way to make a chart accessible rather than
 * inventing an aria description of a shape.
 */
/** More labels than this and they collide; the bars stay, the labels thin out. */
const MAXIMO_ROTULOS = 12;

export const BarChart = ({ pontos, series, caption }: Props) => {
  const maximo = Math.max(1, ...pontos.flatMap((ponto) => ponto.values));
  const umaSerie = series.length === 1;
  // Thirty dates side by side render as a grey smear. Every nth one is labelled
  // instead, and the table below still carries all of them.
  const passo = Math.ceil(pontos.length / MAXIMO_ROTULOS);

  return (
    <div className="grafico-barras">
      {umaSerie ? null : (
        <ul className="grafico-barras__legenda">
          {series.map((serie) => (
            <li key={serie.label}>
              <span data-tone={serie.tone} aria-hidden="true" />
              {serie.label}
            </li>
          ))}
        </ul>
      )}

      <div className="grafico-barras__area" aria-hidden="true">
        {pontos.map((ponto, indice) => (
          <div className="grafico-barras__coluna" key={ponto.label}>
            <div className="grafico-barras__pilha">
              {ponto.values.map((valor, indice) => (
                <div
                  className="grafico-barras__barra"
                  key={series[indice]?.label ?? indice}
                  data-tone={series[indice]?.tone ?? 'primary'}
                  // A zero still draws two pixels, so an empty day reads as a day
                  // with nothing rather than as a gap in the data.
                  style={{ height: `${Math.max(2, (valor / maximo) * 100)}%` }}
                />
              ))}
            </div>
            {umaSerie ? (
              <span className="grafico-barras__valor">{ponto.values[0]}</span>
            ) : null}
            <span className="grafico-barras__rotulo">
              {indice % passo === 0 || indice === pontos.length - 1
                ? etiquetaCurta(ponto.label)
                : ''}
            </span>
          </div>
        ))}
      </div>

      <table className="sr-only">
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Dia</th>
            {series.map((serie) => (
              <th scope="col" key={serie.label}>
                {serie.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {pontos.map((ponto) => (
            <tr key={ponto.label}>
              <th scope="row">{ponto.label}</th>
              {ponto.values.map((valor, indice) => (
                <td key={series[indice]?.label ?? indice}>{valor}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

/** `2026-09-17` reads as `17/09`; anything else is already a label. */
const etiquetaCurta = (label: string): string => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(label)) return label;
  const [, mes, dia] = label.split('-');
  return `${dia}/${mes}`;
};
