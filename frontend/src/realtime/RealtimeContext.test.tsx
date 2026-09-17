import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '../api/client';
import { criarSocketFalso, type SocketFalso } from '../test/socketFalso';
import { IndicadorLigacao } from './IndicadorLigacao';
import { RealtimeProvider, useEventoTempoReal, useRecarregarCom } from './RealtimeContext';

let socket: SocketFalso;
/** Typed with the options argument, so a test can assert what the provider asked for. */
const ligar = vi.fn((_opcoes?: Record<string, unknown>) => socket);

vi.mock('socket.io-client', () => ({
  io: (opcoes?: Record<string, unknown>) => ligar(opcoes),
}));

let utilizador: User | null = {
  id: 'u1',
  name: 'Bia Op',
  email: 'bia@karga.ao',
  role: 'OPERADOR',
  companyId: 'c1',
  companyName: 'Karga',
};

vi.mock('../auth/SessionContext', () => ({
  useSession: () => ({ user: utilizador, loading: false, login: vi.fn(), logout: vi.fn() }),
}));

const montar = (interior: React.ReactNode) =>
  render(
    <RealtimeProvider>
      <IndicadorLigacao />
      {interior}
    </RealtimeProvider>,
  );

/** The provider only reports "ligado" once the socket says it connected. */
const ligado = () => act(() => socket.receber('connect'));

beforeEach(() => {
  socket = criarSocketFalso();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('RealtimeProvider', () => {
  it('opens one socket with the session cookie', () => {
    montar(null);

    expect(ligar).toHaveBeenCalledTimes(1);
    // The session cookie is httpOnly, so the handshake has to be told to send
    // credentials; there is no token for JavaScript to attach.
    expect(ligar.mock.calls[0]?.[0]).toMatchObject({ withCredentials: true, path: '/realtime' });
  });

  it('says it is live only once the socket connects', () => {
    montar(null);

    expect(screen.getByText('A ligar')).toBeInTheDocument();
    ligado();
    expect(screen.getByText('Em directo')).toBeInTheDocument();
  });

  it('admits when the connection is gone instead of looking calm', () => {
    montar(null);
    ligado();

    act(() => socket.receber('disconnect'));

    // A dispatcher watching a list that quietly stopped changing believes the
    // operation is calm. The difference between "nothing is happening" and "I am no
    // longer being told" is the whole point of this indicator.
    expect(screen.getByText('Sem ligação')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('perdida');
  });

  it('stops reconnecting when the server says the session ended', () => {
    montar(null);
    ligado();

    act(() => socket.receber('sessao:terminada'));

    expect(socket.close).toHaveBeenCalled();
    expect(screen.queryByText('Em directo')).not.toBeInTheDocument();
  });

  it('opens no socket at all with nobody signed in', () => {
    utilizador = null;
    montar(null);

    expect(ligar).not.toHaveBeenCalled();
    expect(screen.queryByText('A ligar')).not.toBeInTheDocument();

    utilizador = {
      id: 'u1',
      name: 'Bia Op',
      email: 'bia@karga.ao',
      role: 'OPERADOR',
      companyId: 'c1',
      companyName: 'Karga',
    };
  });
});

describe('useEventoTempoReal', () => {
  const Ouvinte = ({ aoReceber }: { aoReceber: (dados: unknown) => void }) => {
    useEventoTempoReal('aviso', aoReceber);
    return null;
  };

  it('hands the event to the component', () => {
    const recebido = vi.fn();
    montar(<Ouvinte aoReceber={recebido} />);

    act(() => socket.receber('aviso', { mensagem: 'Nova entrega' }));

    expect(recebido).toHaveBeenCalledWith({ mensagem: 'Nova entrega' });
  });

  it('lets go of the listener when the component leaves', () => {
    const recebido = vi.fn();
    const { unmount } = montar(<Ouvinte aoReceber={recebido} />);

    unmount();
    socket.receber('aviso', { mensagem: 'Nova entrega' });

    expect(recebido).not.toHaveBeenCalled();
  });
});

describe('useRecarregarCom', () => {
  const Ecra = ({ recarregar }: { recarregar: () => void }) => {
    useRecarregarCom('encomenda:actualizada', recarregar);
    return null;
  };

  it('asks for the data once for a burst of events', () => {
    vi.useFakeTimers();
    const recarregar = vi.fn();
    montar(<Ecra recarregar={recarregar} />);

    act(() => {
      socket.receber('encomenda:actualizada', {});
      socket.receber('encomenda:actualizada', {});
      socket.receber('encomenda:actualizada', {});
    });

    expect(recarregar).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(500));

    // Three parcels dispatched in the same breath is one refetch, not three list
    // redraws.
    expect(recarregar).toHaveBeenCalledTimes(1);
  });

  it('asks again after the socket comes back, because it missed what happened', () => {
    const recarregar = vi.fn();
    montar(<Ecra recarregar={recarregar} />);
    ligado();

    act(() => socket.receber('disconnect'));
    act(() => socket.receber('connect'));

    expect(recarregar).toHaveBeenCalledTimes(1);
  });
});
