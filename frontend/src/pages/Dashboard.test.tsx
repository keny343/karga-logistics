import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DashboardResumo } from '../api/client';
import { Dashboard } from './Dashboard';

const RESUMO: DashboardResumo = {
  ordersToday: 4,
  inDelivery: 3,
  delivered: 8,
  failed: 2,
  late: 7,
  activeDrivers: 3,
  byStatus: [{ status: 'ENTREGUE', count: 8 }],
  perDay: [
    { day: '2026-09-16', count: 9 },
    { day: '2026-09-17', count: 4 },
  ],
  recent: [],
};

const montar = (corpo: unknown, status = 200) => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify(corpo), {
          status,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    ),
  );

  render(
    <MemoryRouter>
      <Dashboard />
    </MemoryRouter>,
  );
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('Dashboard', () => {
  it('turns each KPI into the filtered list behind it', async () => {
    montar(RESUMO);

    // "Seven late" is a question; the card is the way to the seven rows.
    const atraso = await screen.findByRole('link', { name: /Em atraso/ });
    expect(atraso).toHaveAttribute('href', '/encomendas?late=true');
    expect(screen.getByRole('link', { name: /Em entrega/ })).toHaveAttribute(
      'href',
      '/encomendas?status=EM_ENTREGA',
    );
    expect(screen.getByRole('link', { name: /Falhas/ })).toHaveAttribute(
      'href',
      '/encomendas?status=FALHA_ENTREGA',
    );
  });

  it('gives the chart a table a screen reader can read', async () => {
    montar(RESUMO);

    await screen.findByRole('link', { name: /Em atraso/ });
    // The bars are decorative; these are the numbers behind them.
    const tabela = screen.getByRole('table', { name: /Encomendas criadas por dia/ });
    expect(tabela).toHaveTextContent('2026-09-17');
    expect(tabela).toHaveTextContent('9');
  });

  it('says nothing is registered instead of showing an empty table', async () => {
    montar(RESUMO);
    expect(await screen.findByText('Nenhuma encomenda registada.')).toBeInTheDocument();
  });

  it('explains a failure with the request id', async () => {
    montar({ error: { code: 'INTERNAL_ERROR', message: 'Falha interna.', requestId: 'req-7' } }, 500);

    expect(await screen.findByText('Não foi possível carregar o dashboard.')).toBeInTheDocument();
    expect(screen.getByText(/req-7/)).toBeInTheDocument();
  });
});
