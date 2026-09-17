import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MapaOperacao, PontoMapa } from '../api/client';
import { MapaOperacional } from './MapaOperacional';
import type { MarcadorMapa } from '../ui/LeafletMap';

/**
 * Leaflet is replaced by something that renders its markers as text. What is worth
 * testing here is which markers the page builds — the grouping, the colours, the
 * counts — and none of that needs a tile server or a laid-out canvas.
 */
vi.mock('../ui/LeafletMap', () => ({
  LeafletMap: ({ marcadores }: { marcadores: readonly MarcadorMapa[] }) => (
    <div data-testid="mapa">
      {marcadores.map((marcador) => (
        <span key={marcador.id} data-tone={marcador.tone} data-kind={marcador.kind ?? 'destino'}>
          {marcador.label}
        </span>
      ))}
    </div>
  ),
}));

const ponto = (extra: Partial<PontoMapa> & { id: string }): PontoMapa => ({
  code: `KRG-00000${extra.id}`,
  status: 'EM_ENTREGA',
  customerName: 'Farmácia Talatona',
  municipality: 'Talatona',
  description: 'Via S8, loja 4',
  latitude: -8.9167,
  longitude: 13.1833,
  late: false,
  ...extra,
});

const RESPOSTA: MapaOperacao = {
  items: [ponto({ id: '1' })],
  origins: [
    {
      description: 'Armazém Karga',
      municipality: 'Cacuaco',
      latitude: -8.7776,
      longitude: 13.3672,
    },
  ],
  withoutCoordinates: [],
  center: { latitude: -8.8383, longitude: 13.2344 },
};

const montar = (corpo: unknown, status = 200) => {
  const fetchMock = vi.fn(() =>
    Promise.resolve(
      new Response(JSON.stringify(corpo), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  );
  vi.stubGlobal('fetch', fetchMock);

  render(
    <MemoryRouter>
      <MapaOperacional />
    </MemoryRouter>,
  );

  return fetchMock;
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('MapaOperacional', () => {
  it('draws one marker per order plus the pickup points', async () => {
    montar(RESPOSTA);

    const mapa = await screen.findByTestId('mapa');
    expect(within(mapa).getByText('000001')).toBeInTheDocument();
    expect(within(mapa).getByText('Recolha')).toHaveAttribute('data-kind', 'origem');
    expect(screen.getByText('1 encomenda no mapa')).toBeInTheDocument();
  });

  it('collapses orders that share an address into one marker', async () => {
    montar({
      ...RESPOSTA,
      items: [
        ponto({ id: '1' }),
        ponto({ id: '2', status: 'PRONTO' }),
        ponto({ id: '3' }),
        ponto({ id: '4', latitude: -8.81, longitude: 13.23 }),
      ],
    });

    const mapa = await screen.findByTestId('mapa');
    // Three parcels at the same gate are one pin. Otherwise the map draws two
    // markers, the counter says four, and the dispatcher trusts the markers.
    expect(within(mapa).getByText('3 aqui')).toBeInTheDocument();
    expect(within(mapa).getByText('000004')).toBeInTheDocument();
    expect(screen.getByText('4 encomendas no mapa')).toBeInTheDocument();
  });

  it('draws a late parcel as needing attention whatever state it is in', async () => {
    montar({ ...RESPOSTA, items: [ponto({ id: '1', status: 'RECOLHIDO', late: true })] });

    const mapa = await screen.findByTestId('mapa');
    expect(within(mapa).getByText('000001')).toHaveAttribute('data-tone', 'danger');
  });

  it('takes the most urgent tone for a group', async () => {
    montar({
      ...RESPOSTA,
      items: [ponto({ id: '1' }), ponto({ id: '2', late: true })],
    });

    const mapa = await screen.findByTestId('mapa');
    expect(within(mapa).getByText('2 aqui')).toHaveAttribute('data-tone', 'danger');
  });

  it('lists the orders it cannot draw instead of leaving them out silently', async () => {
    montar({
      ...RESPOSTA,
      withoutCoordinates: [
        {
          id: 'sem-1',
          code: 'KRG-000013',
          status: 'CRIADO' as const,
          customerName: 'Restaurante Ilha Verde',
          municipality: 'Ilha do Cabo',
          description: 'Avenida Murtala Mohamed, quiosque 12',
        },
      ],
    });

    expect(await screen.findByText('Sem ponto no mapa (1)')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'KRG-000013' })).toHaveAttribute(
      'href',
      '/encomendas/sem-1',
    );
  });

  it('filters to a single state without touching the API again', async () => {
    const utilizador = userEvent.setup();
    const fetchMock = montar({
      ...RESPOSTA,
      items: [ponto({ id: '1' }), ponto({ id: '2', status: 'PRONTO', latitude: -8.81 })],
    });

    await screen.findByText('2 encomendas no mapa');
    const chamadas = fetchMock.mock.calls.length;

    await utilizador.selectOptions(screen.getByLabelText('Estado'), 'PRONTO');

    await waitFor(() => {
      expect(screen.getByText('1 encomenda no mapa')).toBeInTheDocument();
    });
    // The whole operation is already in memory; re-fetching it to hide markers would
    // be a request for nothing.
    expect(fetchMock.mock.calls.length).toBe(chamadas);
  });

  it('offers only the states that are on the map', async () => {
    montar({ ...RESPOSTA, items: [ponto({ id: '1', status: 'EM_ENTREGA' })] });

    await screen.findByTestId('mapa');
    const filtro = screen.getByLabelText('Estado');
    expect(within(filtro).getByRole('option', { name: 'Em entrega' })).toBeInTheDocument();
    // A filter that offers "Criado" when nothing is CRIADO empties the map for no
    // visible reason.
    expect(within(filtro).queryByRole('option', { name: 'Criado' })).not.toBeInTheDocument();
  });

  it('says the map is empty rather than showing a blank frame', async () => {
    montar({ ...RESPOSTA, items: [], origins: [] });

    expect(
      await screen.findByText('Nenhuma encomenda em curso com ponto no mapa.'),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('mapa')).not.toBeInTheDocument();
  });

  it('explains a failure with the request id and offers a retry', async () => {
    const utilizador = userEvent.setup();
    const fetchMock = montar(
      { error: { code: 'INTERNAL_ERROR', message: 'Falha interna.', requestId: 'req-8' } },
      500,
    );

    expect(await screen.findByText('Não foi possível carregar o mapa.')).toBeInTheDocument();
    expect(screen.getByText(/req-8/)).toBeInTheDocument();

    const antes = fetchMock.mock.calls.length;
    await utilizador.click(screen.getByRole('button', { name: /Tentar de novo/ }));
    await waitFor(() => {
      expect(fetchMock.mock.calls.length).toBeGreaterThan(antes);
    });
  });
});
