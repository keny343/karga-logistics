import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { criarSocketFalso, type SocketFalso } from '../test/socketFalso';
import { PartilhaDePosicao } from './PartilhaDePosicao';
import { RealtimeProvider } from './RealtimeContext';

let socket: SocketFalso;

vi.mock('socket.io-client', () => ({ io: () => socket }));

vi.mock('../auth/SessionContext', () => ({
  useSession: () => ({
    user: {
      id: 'u9',
      name: 'Manuel Costa',
      email: 'manuel@karga.ao',
      role: 'MOTORISTA',
      companyId: 'c1',
      companyName: 'Karga',
    },
    loading: false,
    login: vi.fn(),
    logout: vi.fn(),
  }),
}));

const TALATONA = { latitude: -8.9167, longitude: 13.1833, accuracy: 12 };

interface Geo {
  watchPosition: ReturnType<typeof vi.fn>;
  clearWatch: ReturnType<typeof vi.fn>;
}

let geo: Geo;

/** Hands the position the browser would have reported to the watcher. */
const reportar = (coords = TALATONA) => {
  const aoReceber = geo.watchPosition.mock.calls[0]?.[0] as (p: unknown) => void;
  act(() => aoReceber({ coords, timestamp: Date.now() }));
};

/** Fails the watch the way a browser does when the person refuses. */
const recusarPermissao = () => {
  const aoFalhar = geo.watchPosition.mock.calls[0]?.[1] as (e: unknown) => void;
  act(() => aoFalhar({ code: 1, PERMISSION_DENIED: 1, message: 'User denied Geolocation' }));
};

const montar = () => {
  render(
    <RealtimeProvider>
      <PartilhaDePosicao />
    </RealtimeProvider>,
  );
  act(() => socket.receber('connect'));
};

beforeEach(() => {
  socket = criarSocketFalso();
  socket.responderA('posicao', { ok: true });
  geo = { watchPosition: vi.fn(() => 7), clearWatch: vi.fn() };
  vi.stubGlobal('navigator', { ...navigator, geolocation: geo });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('PartilhaDePosicao', () => {
  it('asks for nothing until the driver says so', () => {
    montar();

    // A phone that reports its location without being asked is surveillance, whoever
    // owns it.
    expect(geo.watchPosition).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Começar' })).toBeInTheDocument();
  });

  it('says up front what it costs before he agrees', () => {
    montar();

    // A driver paying for data by the megabyte is entitled to know this before
    // switching it on, not after noticing.
    expect(screen.getByText(/enquanto esta página estiver aberta/i)).toBeInTheDocument();
    expect(screen.getByText(/a cada 10\s*segundos/i)).toBeInTheDocument();
  });

  it('sends the position the phone reported', async () => {
    montar();
    await userEvent.click(screen.getByRole('button', { name: 'Começar' }));

    expect(screen.getByText(/confirma no aviso do telefone/i)).toBeInTheDocument();

    reportar();

    expect(socket.emit).toHaveBeenCalledWith(
      'posicao',
      { latitude: TALATONA.latitude, longitude: TALATONA.longitude, accuracyMeters: 12 },
      expect.any(Function),
    );
    expect(screen.getByText('A central está a ver-te')).toBeInTheDocument();
  });

  it('does not claim to be seen before a point has been accepted', async () => {
    // No acknowledgement from the server: the point left, nobody said it arrived.
    socket.responderA('posicao', undefined);
    montar();
    await userEvent.click(screen.getByRole('button', { name: 'Começar' }));

    expect(screen.getByText('A obter a tua posição')).toBeInTheDocument();

    reportar();

    // Telling a driver the office can see him when it cannot is the one lie here that
    // could leave somebody waiting on a roadside.
    expect(screen.queryByText('A central está a ver-te')).not.toBeInTheDocument();
  });

  it('sends one point per interval, not one per reading', async () => {
    montar();
    await userEvent.click(screen.getByRole('button', { name: 'Começar' }));

    reportar();
    reportar({ ...TALATONA, latitude: -8.9168 });
    reportar({ ...TALATONA, latitude: -8.9169 });

    // The browser reports as often as the hardware allows. This is a driver's battery
    // and data bundle being spent.
    expect(socket.emit).toHaveBeenCalledTimes(1);
  });

  it('explains how to undo a refusal instead of just naming it', async () => {
    montar();
    await userEvent.click(screen.getByRole('button', { name: 'Começar' }));

    recusarPermissao();

    expect(screen.getByText(/definições do navegador/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Começar' })).toBeInTheDocument();
  });

  it('repeats the reason the server gave for refusing a point', async () => {
    socket.responderA('posicao', { ok: false, message: 'A posição indicada está fora de Angola.' });
    montar();
    await userEvent.click(screen.getByRole('button', { name: 'Começar' }));

    reportar({ latitude: 48.85, longitude: 2.29, accuracy: 20 });

    expect(screen.getByRole('alert')).toHaveTextContent('fora de Angola');
  });

  it('stops watching when the driver turns it off', async () => {
    montar();
    await userEvent.click(screen.getByRole('button', { name: 'Começar' }));
    reportar();

    await userEvent.click(screen.getByRole('button', { name: 'Parar' }));

    expect(geo.clearWatch).toHaveBeenCalledWith(7);
    expect(screen.getByText(/deixa de te ver no mapa/i)).toBeInTheDocument();
  });

  it('stops claiming to share when the points reach nobody', async () => {
    montar();
    await userEvent.click(screen.getByRole('button', { name: 'Começar' }));
    reportar();

    act(() => socket.receber('disconnect'));

    // Collecting points and sending them nowhere while telling the driver he is
    // visible is the one failure that would get somebody stood up.
    expect(screen.getByText(/não está a chegar à central/i)).toBeInTheDocument();
  });

  it('admits when the browser cannot do it at all', async () => {
    vi.stubGlobal('navigator', { ...navigator, geolocation: undefined });
    montar();

    await userEvent.click(screen.getByRole('button', { name: 'Começar' }));

    expect(screen.getByText(/não sabe dar a localização/i)).toBeInTheDocument();
  });
});
