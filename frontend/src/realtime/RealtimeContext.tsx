import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { io, type Socket } from 'socket.io-client';
import { useSession } from '../auth/SessionContext';

export type EstadoLigacao = 'ligado' | 'a-ligar' | 'desligado' | 'sem-sessao';

export interface AvisoTempoReal {
  readonly tipo: string;
  readonly mensagem: string;
  readonly orderId?: string;
}

interface TempoReal {
  readonly estado: EstadoLigacao;
  readonly socket: Socket | null;
}

const RealtimeContext = createContext<TempoReal>({ estado: 'sem-sessao', socket: null });

/**
 * One socket for the whole application, opened when there is a session and closed
 * when there is not.
 *
 * Nothing subscribes to anything: rooms are decided by the server from the session,
 * so a page here only listens for events it may already receive. The connection is a
 * convenience over polling, never the source of truth — every screen still loads its
 * own state over HTTP and refetches on reconnect, because a socket that was down for
 * a minute has missed events and cannot know it.
 */
export const RealtimeProvider = ({ children }: { readonly children: ReactNode }) => {
  const { user } = useSession();
  const [estado, setEstado] = useState<EstadoLigacao>('sem-sessao');
  const [socket, setSocket] = useState<Socket | null>(null);

  useEffect(() => {
    if (user === null) {
      setEstado('sem-sessao');
      return;
    }

    setEstado('a-ligar');
    const ligacao = io({
      path: '/realtime',
      // The cookie is httpOnly, so the handshake has to carry credentials the same
      // way a fetch does; there is no token for JavaScript to hold.
      withCredentials: true,
      transports: ['websocket', 'polling'],
    });

    ligacao.on('connect', () => setEstado('ligado'));
    ligacao.on('disconnect', () => setEstado('desligado'));
    ligacao.on('connect_error', () => setEstado('desligado'));
    // The server closes the socket when the session is revoked. Reconnecting would
    // be a loop against a closed door.
    ligacao.on('sessao:terminada', () => {
      setEstado('sem-sessao');
      ligacao.close();
    });

    setSocket(ligacao);

    return () => {
      ligacao.close();
      setSocket(null);
    };
  }, [user]);

  const valor = useMemo<TempoReal>(() => ({ estado, socket }), [estado, socket]);

  return <RealtimeContext.Provider value={valor}>{children}</RealtimeContext.Provider>;
};

export const useRealtime = (): TempoReal => useContext(RealtimeContext);

/**
 * Subscribes to one event for as long as the component is mounted.
 *
 * The handler is held in a ref so a caller can pass an inline function without
 * re-subscribing on every render — the usual way this hook gets written wrong is a
 * listener that is added and removed dozens of times a second.
 */
export const useEventoTempoReal = <T,>(evento: string, aoReceber: (dados: T) => void): void => {
  const { socket } = useRealtime();
  const actual = useRef(aoReceber);
  actual.current = aoReceber;

  useEffect(() => {
    if (socket === null) return;

    const ouvinte = (dados: T): void => actual.current(dados);
    socket.on(evento, ouvinte);

    return () => {
      socket.off(evento, ouvinte);
    };
  }, [socket, evento]);
};

/**
 * Refetches a screen when an event says its data changed, and again when the socket
 * comes back from being away.
 *
 * The refetch is held for a moment on purpose. A busy afternoon produces bursts —
 * three parcels dispatched in the same breath — and one request for the burst is both
 * kinder to the API and steadier to look at than three list redraws.
 *
 * Refetching at all, rather than patching the row the event carries, is the deliberate
 * part: whether an order still belongs in this filter, on this page, or in this map
 * group is a question about all of them, and the API is what answers it.
 */
export const useRecarregarCom = (evento: string, recarregar: () => void): void => {
  const pendente = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEventoTempoReal(evento, () => {
    if (pendente.current !== null) return;
    pendente.current = setTimeout(() => {
      pendente.current = null;
      recarregar();
    }, 400);
  });

  useEffect(
    () => () => {
      if (pendente.current !== null) clearTimeout(pendente.current);
    },
    [],
  );

  useAoReligar(recarregar);
};

/** Runs when the socket comes back after being away, which is when a refetch is due. */
export const useAoReligar = (recarregar: () => void): void => {
  const { estado } = useRealtime();
  const anterior = useRef<EstadoLigacao>(estado);
  const actual = useRef(recarregar);
  actual.current = recarregar;

  useEffect(() => {
    if (anterior.current === 'desligado' && estado === 'ligado') actual.current();
    anterior.current = estado;
  }, [estado]);
};
