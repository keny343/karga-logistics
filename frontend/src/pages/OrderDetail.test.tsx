import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Order, User } from '../api/client';
import { instalarCanvasFalso } from '../test/canvasFalso';
import { ToastProvider } from '../ui/Toast';
import { OrderDetail } from './OrderDetail';

/**
 * The delivery screen, from the side of whoever is holding the parcel.
 *
 * The case worth a test is the one that is easy to get wrong: a driver taps "Entregue", the
 * API refuses because there is no proof, and what he sees next has to be an instruction he
 * can follow rather than a red message that vanishes. A toast would be the lazy answer -
 * it disappears, and it does not say what to do.
 */

const MOTORISTA: User = {
  id: 'u9',
  name: 'Manuel Cardoso',
  email: 'manuel@karga.ao',
  role: 'MOTORISTA',
  companyId: 'c1',
  companyName: 'Karga Luanda',
};

const ENDERECO = {
  description: 'Via S8, Edifício Kilamba Center, loja 4',
  province: 'Luanda',
  municipality: 'Talatona',
};

const ENCOMENDA: Order = {
  id: 'o1',
  code: 'KRG-000123',
  status: 'EM_ENTREGA',
  customerId: 'cl1',
  customerName: 'Farmácia Talatona',
  driverId: 'd1',
  driverName: 'Manuel Cardoso',
  destination: 'Talatona — Via S8',
  destinationAddress: ENDERECO,
  origin: { ...ENDERECO, description: 'Armazém Karga', municipality: 'Cacuaco' },
  description: 'Duas caixas de medicamentos',
  weightGrams: 8400,
  valueCents: 7_400_000,
  createdAt: new Date().toISOString(),
  late: false,
  history: [{ status: 'CRIADO', at: new Date().toISOString(), by: 'Bia' }],
  allowedTransitions: ['ENTREGUE', 'FALHA_ENTREGA'],
  proofs: [],
};

const json = (corpo: unknown, status = 200): Response =>
  new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } });

vi.mock('../auth/SessionContext', () => ({
  useSession: () => ({ user: MOTORISTA, loading: false, login: vi.fn(), logout: vi.fn() }),
}));

// The realtime layer is exercised in its own suite; here it must simply not get in the way.
vi.mock('../realtime/RealtimeContext', () => ({
  useEventoTempoReal: vi.fn(),
  useAoReligar: vi.fn(),
}));

const montar = (responder: (url: string, init?: RequestInit) => Response) => {
  const fetchMock = vi.fn((url: string | URL | Request, init?: RequestInit) =>
    Promise.resolve(responder(String(url), init)),
  );
  vi.stubGlobal('fetch', fetchMock);

  render(
    <MemoryRouter initialEntries={['/encomendas/o1']}>
      <ToastProvider>
        <Routes>
          <Route path="/encomendas/:id" element={<OrderDetail />} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  );

  return fetchMock;
};

beforeEach(() => {
  instalarCanvasFalso();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('OrderDetail e a prova de entrega', () => {
  it('diz ao motorista o que fazer quando a entrega é recusada sem prova', async () => {
    montar((url, init) => {
      if (url.endsWith('/status') && init?.method === 'POST') {
        return json(
          {
            error: {
              code: 'PROOF_REQUIRED',
              message: 'A encomenda KRG-000123 precisa de uma prova de entrega.',
            },
          },
          409,
        );
      }
      return json({ order: ENCOMENDA });
    });

    expect(await screen.findByText('KRG-000123')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Entregue' }));

    // An instruction that stays on the page, next to the camera it is asking him to use.
    const aviso = await screen.findByRole('status');
    expect(aviso).toHaveTextContent(/ainda não tem prova/i);
    expect(aviso).toHaveTextContent(/fotografia|assinatura/i);
    expect(screen.getByLabelText(/fotografar a entrega/i)).toBeInTheDocument();
  });

  it('oferece a captura enquanto a encomenda está a caminho', async () => {
    montar(() => json({ order: ENCOMENDA }));

    expect(await screen.findByText('KRG-000123')).toBeInTheDocument();
    expect(screen.getByLabelText(/fotografar a entrega/i)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /área de assinatura/i })).toBeInTheDocument();
    // And says, in the panel that lists them, that there is nothing yet.
    expect(screen.getByText(/ainda sem prova/i)).toBeInTheDocument();
  });

  it('não oferece captura numa encomenda já fechada, mas mostra o que ficou provado', async () => {
    const entregue: Order = {
      ...ENCOMENDA,
      status: 'ENTREGUE',
      allowedTransitions: [],
      completedAt: new Date().toISOString(),
      proofs: [
        {
          id: 'p1',
          kind: 'FOTO',
          mimeType: 'image/jpeg',
          byteSize: 210_000,
          sha256: 'f'.repeat(64),
          driverName: 'Manuel Cardoso',
          uploadedBy: 'Manuel Cardoso (manuel@karga.ao)',
          latitude: -8.9167,
          longitude: 13.1833,
          accuracyMeters: 9,
          capturedAt: new Date().toISOString(),
          storedAt: new Date().toISOString(),
          url: '/api/orders/o1/proofs/p1/file',
        },
      ],
    };

    montar(() => json({ order: entregue }));

    expect(await screen.findByText('KRG-000123')).toBeInTheDocument();
    // Evidence is append-only and this delivery is history: nothing here invites more.
    expect(screen.queryByLabelText(/fotografar a entrega/i)).not.toBeInTheDocument();
    expect(screen.getByText('Prova de entrega · 1')).toBeInTheDocument();
    expect(screen.getByText(/±9 m/)).toBeInTheDocument();
  });

  it('anexa a fotografia e volta a pedir a encomenda ao servidor', async () => {
    const fetchMock = montar((url, init) => {
      if (url.endsWith('/proofs') && init?.method === 'POST') {
        return json(
          {
            proof: {
              id: 'p1',
              kind: 'FOTO',
              mimeType: 'image/jpeg',
              byteSize: 1024,
              sha256: 'a'.repeat(64),
              uploadedBy: 'Manuel Cardoso (manuel@karga.ao)',
              storedAt: new Date().toISOString(),
              url: '/api/orders/o1/proofs/p1/file',
            },
          },
          201,
        );
      }
      return json({ order: ENCOMENDA });
    });

    expect(await screen.findByText('KRG-000123')).toBeInTheDocument();

    await userEvent.upload(
      screen.getByLabelText<HTMLInputElement>(/fotografar a entrega/i),
      new File([new Uint8Array(1024)], 'foto.jpg', { type: 'image/jpeg' }),
    );

    await waitFor(() => {
      const enviou = fetchMock.mock.calls.some(
        ([url, init]) => String(url).endsWith('/proofs') && (init as RequestInit | undefined)?.method === 'POST',
      );
      expect(enviou).toBe(true);
    });

    // The order is fetched again, so the panel and the buttons reflect the new proof.
    await waitFor(() => {
      const leituras = fetchMock.mock.calls.filter(
        ([url, init]) =>
          String(url).endsWith('/api/orders/o1') && (init as RequestInit | undefined)?.method === undefined,
      );
      expect(leituras.length).toBeGreaterThan(1);
    });
  });
});
