import { Check } from 'lucide-react';
import './Timeline.css';

export interface TimelinePasso {
  readonly label: string;
  readonly at?: string;
  readonly by?: string;
  readonly note?: string;
  readonly state: 'done' | 'current' | 'pending' | 'failed';
}

/**
 * The history of an order. The current step is marked by shape as well as by
 * colour - a filled ring against a check against an empty circle - so the state
 * survives being printed in black and white.
 */
export const Timeline = ({ steps }: { readonly steps: readonly TimelinePasso[] }) => (
  <ol className="linha-tempo">
    {steps.map((passo, indice) => (
      <li className="linha-tempo__item" data-estado={passo.state} key={`${passo.label}-${indice}`}>
        <span className="linha-tempo__marca" aria-hidden="true">
          {passo.state === 'done' ? <Check size={11} strokeWidth={3} /> : null}
        </span>
        <div className="linha-tempo__conteudo">
          <span className="linha-tempo__rotulo">{passo.label}</span>
          {passo.at !== undefined ? <span className="linha-tempo__hora mono">{passo.at}</span> : null}
          {passo.by !== undefined ? <span className="linha-tempo__autor">por {passo.by}</span> : null}
          {passo.note !== undefined ? <p className="linha-tempo__nota">{passo.note}</p> : null}
        </div>
      </li>
    ))}
  </ol>
);
