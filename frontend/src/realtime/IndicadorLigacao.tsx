import { Radio, WifiOff } from 'lucide-react';
import { useRealtime } from './RealtimeContext';
import './IndicadorLigacao.css';

/**
 * Whether the screens are updating themselves.
 *
 * A dead socket must be visible. Without this, a dispatcher watching a list that has
 * quietly stopped changing believes the operation is calm, and the difference between
 * "nothing is happening" and "I am no longer being told" is the whole point of the
 * indicator.
 */
export const IndicadorLigacao = () => {
  const { estado } = useRealtime();

  if (estado === 'sem-sessao') return null;

  const ligado = estado === 'ligado';
  const aLigar = estado === 'a-ligar';

  return (
    <span
      className="ligacao"
      data-estado={estado}
      title={
        ligado
          ? 'Os ecrãs actualizam-se sozinhos.'
          : aLigar
            ? 'A estabelecer ligação em tempo real.'
            : 'Sem ligação em tempo real. Actualiza a página para ver o estado actual.'
      }
    >
      {ligado || aLigar ? (
        <Radio size={14} aria-hidden="true" />
      ) : (
        <WifiOff size={14} aria-hidden="true" />
      )}
      <span className="ligacao__texto">
        {ligado ? 'Em directo' : aLigar ? 'A ligar' : 'Sem ligação'}
      </span>
      {/* Colour alone would leave this unreadable for a colour-blind operator, and
          the text is short enough to keep at every width. */}
      <span className="sr-only" role="status">
        {ligado
          ? 'Ligação em tempo real activa.'
          : aLigar
            ? 'A ligar em tempo real.'
            : 'Ligação em tempo real perdida.'}
      </span>
    </span>
  );
};
