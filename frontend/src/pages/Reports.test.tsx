import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Relatorio } from '../api/client';
import { Reports } from './Reports';
import { ToastProvider } from '../ui/Toast';

const RELATORIO: Relatorio = {
  range: { from: '2026-08-19', to: '2026-09-17' },
  totals: {
    created: 14,
    delivered: 8,
    failed: 2,
    cancelled: 1,
    returned: 1,
    inProgress: 2,
    late: 1,
    completed: 10,
    valueCents: 308_300_000,
    weightGrams: 243_900,
    successRate: 80,
    medianDeliveryMinutes: 135,
  },
  perDay: [
    { day: '2026-09-16', created: 9, delivered: 3 },
    { day: '2026-09-17', created: 5, delivered: 5 },
  ],
  byStatus: [
    { status: 'ENTREGUE', count: 8 },
    { status: 'FALHA_ENTREGA', count: 2 },
  ],
  byDriver: [
    {
      driverId: 'd1',
      driverName: 'Sílvia Neto',
      assigned: 6,
      delivered: 5,
      failed: 1,
      medianDeliveryMinutes: 90,
    },
  ],
  byMunicipality: [{ municipality: 'Talatona', count: 6, delivered: 4 }],
};

const json = (corpo: unknown, status = 200): Response =>
  new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } });

const montar = (resposta: (url: string) => Response) => {
  const fetchMock = vi.fn((url: string | URL | Request) => Promise.resolve(resposta(String(url))));
  vi.stubGlobal('fetch', fetchMock);

  render(
    <MemoryRouter initialEntries={['/relatorios?de=2026-08-19&ate=2026-09-17']}>
      <ToastProvider>
        <Reports />
      </ToastProvider>
    </MemoryRouter>,
  );

  return fetchMock;
};

beforeEach(() => {
  // jsdom has neither of these, and the export path uses both.
  URL.createObjectURL = vi.fn(() => 'blob:relatorio');
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('Reports', () => {
  it('asks for the window in the URL and shows the totals it gets back', async () => {
    const fetchMock = montar(() => json(RELATORIO));

    expect(await screen.findByText('14')).toBeInTheDocument();
    expect(screen.getByText('80%')).toBeInTheDocument();
    expect(screen.getByText('Sobre 10 concluídas')).toBeInTheDocument();
    // 135 minutes reads as 2h 15, not as a raw number of minutes.
    expect(screen.getByText('2h 15')).toBeInTheDocument();
    expect(screen.getByText('Sílvia Neto')).toBeInTheDocument();
    expect(screen.getByText('Talatona')).toBeInTheDocument();

    const pedido = String(fetchMock.mock.calls[0]?.[0]);
    expect(pedido).toContain('from=2026-08-19');
    expect(pedido).toContain('to=2026-09-17');
  });

  it('says there is no rate rather than zero per cent when nothing finished', async () => {
    montar(() =>
      json({
        ...RELATORIO,
        totals: { ...RELATORIO.totals, completed: 0, successRate: null, medianDeliveryMinutes: null },
      }),
    );

    expect(await screen.findByText('Nada concluído no intervalo')).toBeInTheDocument();
    // A dash, because 0% would claim every delivery failed.
    expect(screen.queryByText('0%')).not.toBeInTheDocument();
  });

  it('reloads with a new window when a preset is chosen', async () => {
    const utilizador = userEvent.setup();
    const fetchMock = montar(() => json(RELATORIO));

    await screen.findByText('14');
    const antes = String(fetchMock.mock.calls[0]?.[0]);

    await utilizador.click(screen.getByRole('button', { name: '7 dias' }));

    await waitFor(() => {
      const ultimo = String(fetchMock.mock.calls.at(-1)?.[0]);
      expect(ultimo).not.toBe(antes);
      expect(ultimo).toContain('/api/reports/summary');
    });
  });

  it('downloads the export and confirms it', async () => {
    const utilizador = userEvent.setup();
    const fetchMock = montar((url) =>
      url.includes('orders.csv')
        ? new Response('\uFEFFCódigo;Estado\r\nKRG-000001;Entregue\r\n', {
            status: 200,
            headers: { 'Content-Type': 'text/csv; charset=utf-8' },
          })
        : json(RELATORIO),
    );

    await screen.findByText('14');
    await utilizador.click(screen.getByRole('button', { name: /Exportar CSV/ }));

    await waitFor(() => {
      const pedidos = fetchMock.mock.calls.map((chamada) => String(chamada[0]));
      expect(pedidos.some((url) => url.includes('/api/reports/orders.csv'))).toBe(true);
    });
    expect(await screen.findByText(/Exportação gerada/)).toBeInTheDocument();
    expect(URL.revokeObjectURL).toHaveBeenCalled();
  });

  it('explains a failed export instead of downloading the error', async () => {
    const utilizador = userEvent.setup();
    montar((url) =>
      url.includes('orders.csv')
        ? json(
            { error: { code: 'VALIDATION_ERROR', message: 'O intervalo não pode exceder 366 dias.' } },
            400,
          )
        : json(RELATORIO),
    );

    await screen.findByText('14');
    await utilizador.click(screen.getByRole('button', { name: /Exportar CSV/ }));

    expect(await screen.findByText(/não pode exceder 366 dias/)).toBeInTheDocument();
    expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled();
  });

  it('explains a failure to load and offers a retry', async () => {
    const utilizador = userEvent.setup();
    const fetchMock = montar(() =>
      json({ error: { code: 'INTERNAL_ERROR', message: 'Falha interna.', requestId: 'req-4' } }, 500),
    );

    expect(await screen.findByText('Não foi possível carregar o relatório.')).toBeInTheDocument();
    expect(screen.getByText(/req-4/)).toBeInTheDocument();

    const antes = fetchMock.mock.calls.length;
    await utilizador.click(screen.getByRole('button', { name: /Tentar de novo/ }));
    await waitFor(() => {
      expect(fetchMock.mock.calls.length).toBeGreaterThan(antes);
    });
  });
});
