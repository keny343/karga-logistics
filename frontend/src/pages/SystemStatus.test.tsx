import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SystemStatus } from './SystemStatus';

const responder = (corpo: unknown, init: ResponseInit = { status: 200 }): void => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify(corpo), {
        ...init,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  );
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SystemStatus', () => {
  it('reports the API as operational, with its uptime', async () => {
    responder({ status: 'ok', service: 'karga-api', uptimeSeconds: 42 });

    render(<SystemStatus />);

    expect(await screen.findByText('API operacional')).toBeInTheDocument();
    expect(screen.getByText(/karga-api/)).toHaveTextContent('42s de uptime');
  });

  it('shows the reason and the request id when the API answers with an error', async () => {
    responder(
      {
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'Base de dados inacessível.',
          requestId: 'abc123',
        },
      },
      { status: 503 },
    );

    render(<SystemStatus />);

    expect(await screen.findByText('API inacessível')).toBeInTheDocument();
    expect(screen.getByText(/Base de dados inacessível/)).toBeInTheDocument();
    expect(screen.getByText(/abc123/)).toBeInTheDocument();
  });

  it('explains a network failure instead of staying blank', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    render(<SystemStatus />);

    await waitFor(() => {
      expect(screen.getByText('API inacessível')).toBeInTheDocument();
    });
    expect(screen.getByText(/Sem ligação ao servidor/)).toBeInTheDocument();
  });
});
