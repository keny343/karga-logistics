import { useNavigate } from 'react-router-dom';
import { useEventoTempoReal, type AvisoTempoReal } from './RealtimeContext';
import { useToast } from '../ui/Toast';

/**
 * Turns the events somebody has to act on into a notification.
 *
 * Mounted once in the layout rather than per screen: a driver being handed a delivery
 * needs to hear about it wherever he is in the application, and two mounted copies
 * would show the same message twice.
 *
 * The server decides who is told what — the driver hears about his own assignment,
 * operators hear about deliveries moving. Nothing is filtered here, because a payload
 * that reached the wrong browser has already leaked.
 */
export const useAvisosTempoReal = (): void => {
  const aviso = useToast();
  const navegar = useNavigate();

  useEventoTempoReal<AvisoTempoReal>('aviso', (dados) => {
    const abrir =
      dados.orderId !== undefined
        ? { label: 'Abrir', onClick: () => navegar(`/encomendas/${dados.orderId}`) }
        : undefined;

    // A failed delivery is the one an operator has to deal with now, so it arrives as
    // an error rather than as one more line of news.
    if (dados.tipo === 'entrega:falhou') {
      aviso.erro(dados.mensagem, abrir);
      return;
    }

    aviso.info(dados.mensagem, abrir);
  });
};
