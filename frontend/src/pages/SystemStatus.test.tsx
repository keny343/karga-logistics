import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SystemStatus } from './SystemStatus';

const responder = (corpo: unknown, status = 200) =>
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      text: async () => JSON.stringify(corpo),
    }),
  );

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('system status page', () => {
  it('reports a reachable API', async () => {
    responder({ status: 'ok', service: 'karga-api', uptimeSeconds: 12 });
    render(<SystemStatus />);
    expect(await screen.findByText('API operacional')).toBeInTheDocument();
    expect(screen.getByText(/karga-api/)).toBeInTheDocument();
  });

  it('shows the API message and the request id when the call fails', async () => {
    responder(
      { error: { code: 'SERVICE_UNAVAILABLE', message: 'Base de dados inacessível.', requestId: 'req-77' } },
      503,
    );
    render(<SystemStatus />);
    expect(await screen.findByText('API inacessível')).toBeInTheDocument();
    expect(screen.getByText(/Base de dados inacessível/)).toBeInTheDocument();
    expect(screen.getByText(/req-77/)).toBeInTheDocument();
  });

  it('explains a network failure instead of showing a blank panel', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('failed to fetch')));
    render(<SystemStatus />);
    expect(await screen.findByText(/Sem ligação ao servidor/)).toBeInTheDocument();
  });
});
