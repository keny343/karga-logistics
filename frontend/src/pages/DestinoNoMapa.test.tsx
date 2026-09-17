import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Order } from '../api/client';
import { DestinoNoMapa } from './DestinoNoMapa';
import { ToastProvider } from '../ui/Toast';
import type { MarcadorMapa } from '../ui/LeafletMap';

/**
 * The map is replaced by a button that reports a fixed point, which is the only part
 * of Leaflet this screen depends on: a click that hands back a latitude and a
 * longitude.
 */
const PONTO_CLICADO = { latitude: -8.9167, longitude: 13.1833 };

vi.mock('../ui/LeafletMap', () => ({
  LeafletMap: ({
    marcadores,
    onEscolherPonto,
  }: {
    marcadores: readonly MarcadorMapa[];
    onEscolherPonto?: (ponto: { latitude: number; longitude: number }) => void;
  }) => (
    <div data-testid="mapa">
      {marcadores.map((marcador) => (
        <span key={marcador.id}>{marcador.label}</span>
      ))}
      {onEscolherPonto !== undefined ? (
        <button type="button" onClick={() => onEscolherPonto(PONTO_CLICADO)}>
          simular clique no mapa
        </button>
      ) : null}
    </div>
  ),
}));

const encomenda = (extra: Partial<Order> = {}): Order =>
  ({
    id: 'enc-1',
    code: 'KRG-000013',
    status: 'CRIADO',
    customerId: 'cli-1',
    customerName: 'Restaurante Ilha Verde',
    description: 'Grelhador industrial',
    weightGrams: 46000,
    valueCents: 89_000_000,
    origin: { description: 'Armazém Karga', province: 'Luanda', municipality: 'Cacuaco' },
    destinationAddress: {
      description: 'Avenida Murtala Mohamed, quiosque 12',
      province: 'Luanda',
      municipality: 'Ilha do Cabo',
    },
    late: false,
    allowedTransitions: [],
    history: [],
    createdAt: '2026-09-16T22:17:00.000Z',
    ...extra,
  }) as Order;

const montar = (
  props: { encomenda?: Order; podeEditar?: boolean } = {},
  resposta: { corpo: unknown; status: number } = { corpo: {}, status: 200 },
) => {
  const fetchMock = vi.fn(() =>
    Promise.resolve(
      new Response(JSON.stringify(resposta.corpo), {
        status: resposta.status,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  );
  vi.stubGlobal('fetch', fetchMock);

  const onGuardado = vi.fn();
  render(
    <ToastProvider>
      <DestinoNoMapa
        encomenda={props.encomenda ?? encomenda()}
        podeEditar={props.podeEditar ?? true}
        onGuardado={onGuardado}
      />
    </ToastProvider>,
  );

  return { fetchMock, onGuardado };
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('DestinoNoMapa', () => {
  it('asks for a point when the order has none', () => {
    montar();

    expect(
      screen.getByText('Clica no mapa para marcar onde a encomenda deve ser entregue.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Guardar ponto' })).not.toBeInTheDocument();
  });

  it('shows the proposed point beside the current one before committing', async () => {
    const utilizador = userEvent.setup();
    montar({
      encomenda: encomenda({
        destinationAddress: {
          description: 'Avenida Murtala Mohamed, quiosque 12',
          province: 'Luanda',
          municipality: 'Ilha do Cabo',
          latitude: -8.7911,
          longitude: 13.2404,
        },
      }),
    });

    expect(screen.getByText('000013')).toBeInTheDocument();

    await utilizador.click(screen.getByRole('button', { name: 'simular clique no mapa' }));

    // Both pins are drawn: the operator has to see how far the point moved before
    // saving it.
    expect(screen.getByText('000013')).toBeInTheDocument();
    expect(screen.getByText('Novo')).toBeInTheDocument();
  });

  it('sends the clicked point and reports it saved', async () => {
    const utilizador = userEvent.setup();
    const { fetchMock, onGuardado } = montar(
      {},
      { corpo: { order: encomenda() }, status: 200 },
    );

    await utilizador.click(screen.getByRole('button', { name: 'simular clique no mapa' }));
    await utilizador.click(screen.getByRole('button', { name: 'Guardar ponto' }));

    await waitFor(() => {
      expect(onGuardado).toHaveBeenCalled();
    });

    const [url, opcoes] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/orders/enc-1/coordinates');
    expect(opcoes.method).toBe('PATCH');
    expect(JSON.parse(String(opcoes.body))).toEqual(PONTO_CLICADO);
    expect(screen.getByText('Destino marcado no mapa.')).toBeInTheDocument();
  });

  it('discards a point without calling the API', async () => {
    const utilizador = userEvent.setup();
    const { fetchMock } = montar();

    await utilizador.click(screen.getByRole('button', { name: 'simular clique no mapa' }));
    await utilizador.click(screen.getByRole('button', { name: 'Descartar' }));

    expect(screen.queryByText('Novo')).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows the reason the API gives when it refuses the point', async () => {
    const utilizador = userEvent.setup();
    montar(
      {},
      {
        corpo: {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Latitude e longitude parecem trocadas.',
          },
        },
        status: 400,
      },
    );

    await utilizador.click(screen.getByRole('button', { name: 'simular clique no mapa' }));
    await utilizador.click(screen.getByRole('button', { name: 'Guardar ponto' }));

    // The API names the mistake; a generic "erro ao guardar" would throw that away.
    expect(await screen.findByText('Latitude e longitude parecem trocadas.')).toBeInTheDocument();
  });

  it('does not offer to move a point that cannot be moved', () => {
    montar({
      podeEditar: false,
      encomenda: encomenda({
        status: 'ENTREGUE',
        destinationAddress: {
          description: 'Avenida Murtala Mohamed, quiosque 12',
          province: 'Luanda',
          municipality: 'Ilha do Cabo',
          latitude: -8.7911,
          longitude: 13.2404,
        },
      }),
    });

    expect(screen.getByTestId('mapa')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'simular clique no mapa' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/Clica no mapa/)).not.toBeInTheDocument();
  });

  it('tells a reader without permission that there is no point yet', () => {
    montar({ podeEditar: false });

    expect(
      screen.getByText('Esta encomenda ainda não tem ponto marcado no mapa.'),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('mapa')).not.toBeInTheDocument();
  });
});
