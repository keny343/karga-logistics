import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OrderSummary, User } from '../api/client';
import { Orders } from './Orders';
import { ToastProvider } from '../ui/Toast';

const OPERADOR: User = {
  id: 'u1',
  name: 'Bia Kiala',
  email: 'operador@karga.ao',
  role: 'OPERADOR',
  companyId: 'c1',
  companyName: 'Karga Luanda',
};

const ENCOMENDA: OrderSummary = {
  id: 'o1',
  code: 'KRG-000123',
  status: 'EM_ENTREGA',
  customerName: 'Farmácia Talatona',
  driverName: 'Manuel Cardoso',
  destination: 'Talatona — Via S8',
  valueCents: 185_000,
  createdAt: new Date().toISOString(),
  late: false,
};

const json = (corpo: unknown, status = 200): Response =>
  new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } });

vi.mock('../auth/SessionContext', () => ({
  useSession: () => ({ user: OPERADOR, loading: false, login: vi.fn(), logout: vi.fn() }),
}));

const montar = (resposta: (url: string) => Response) => {
  const fetchMock = vi.fn((url: string | URL | Request) => Promise.resolve(resposta(String(url))));
  vi.stubGlobal('fetch', fetchMock);

  render(
    <MemoryRouter>
      <ToastProvider>
        <Orders />
      </ToastProvider>
    </MemoryRouter>,
  );

  return fetchMock;
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('Orders', () => {
  it('lists the orders with their state', async () => {
    montar(() => json({ items: [ENCOMENDA], total: 1, page: 1, pageSize: 20 }));

    expect(await screen.findByText('KRG-000123')).toBeInTheDocument();
    expect(screen.getByText('Farmácia Talatona')).toBeInTheDocument();
    // Scoped to the table: "Em entrega" is also one of the filter options.
    const linha = screen.getByText('KRG-000123').closest('tr');
    expect(linha).not.toBeNull();
    expect(linha).toHaveTextContent('Em entrega');
    expect(linha).toHaveTextContent('Manuel Cardoso');
    // Money is formatted from integer cêntimos, never shown raw. The thousands
    // separator Intl produces is a non-breaking space, so match on the decimals.
    expect(linha).toHaveTextContent(/850,00 Kz/);
    // The row reacts to a click, but the code is a real link so the detail is
    // reachable by keyboard and can be opened in a new tab.
    expect(screen.getByRole('link', { name: 'KRG-000123' })).toHaveAttribute(
      'href',
      '/encomendas/o1',
    );
    expect(linha).not.toHaveTextContent('185000');
  });

  it('marks an order past its due date', async () => {
    montar(() => json({ items: [{ ...ENCOMENDA, late: true }], total: 1, page: 1, pageSize: 20 }));
    expect(await screen.findByText('Atrasada')).toBeInTheDocument();
  });

  it('asks the API for the chosen status filter', async () => {
    const utilizador = userEvent.setup();
    const fetchMock = montar(() => json({ items: [ENCOMENDA], total: 1, page: 1, pageSize: 20 }));

    await screen.findByText('KRG-000123');
    await utilizador.selectOptions(screen.getByLabelText('Estado'), 'ENTREGUE');

    await waitFor(() => {
      const pedidos = fetchMock.mock.calls.map((chamada) => String(chamada[0]));
      expect(pedidos.some((url) => url.includes('status=ENTREGUE'))).toBe(true);
    });
  });

  it('says the list is empty instead of showing a blank table', async () => {
    montar(() => json({ items: [], total: 0, page: 1, pageSize: 20 }));

    expect(await screen.findByText('Nenhuma encomenda encontrada.')).toBeInTheDocument();
    expect(screen.getByText(/Cria a primeira encomenda/)).toBeInTheDocument();
  });

  it('explains a failure and offers a retry', async () => {
    const utilizador = userEvent.setup();
    const fetchMock = montar(() =>
      json({ error: { code: 'INTERNAL_ERROR', message: 'Falha interna.', requestId: 'req-9' } }, 500),
    );

    expect(await screen.findByText('Não foi possível carregar as encomendas.')).toBeInTheDocument();
    expect(screen.getByText(/req-9/)).toBeInTheDocument();

    const chamadasAntes = fetchMock.mock.calls.length;
    await utilizador.click(screen.getByRole('button', { name: /Tentar de novo/ }));
    await waitFor(() => {
      expect(fetchMock.mock.calls.length).toBeGreaterThan(chamadasAntes);
    });
  });

  it('offers order creation to an operator', async () => {
    montar(() => json({ items: [], total: 0, page: 1, pageSize: 20 }));
    expect(await screen.findByRole('button', { name: /Nova encomenda/ })).toBeInTheDocument();
  });
});
