import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionProvider } from '../auth/SessionContext';
import { Login } from './Login';

const json = (corpo: unknown, status = 200): Response =>
  new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } });

const montar = (respostas: (url: string, init?: RequestInit) => Response) => {
  const fetchMock = vi.fn((url: string | URL | Request, init?: RequestInit) =>
    Promise.resolve(respostas(String(url), init)),
  );
  vi.stubGlobal('fetch', fetchMock);

  render(
    <MemoryRouter>
      <SessionProvider>
        <Login />
      </SessionProvider>
    </MemoryRouter>,
  );

  return fetchMock;
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Login', () => {
  it('sends the credentials the user typed', async () => {
    const utilizador = userEvent.setup();
    const fetchMock = montar((url) =>
      url.includes('/api/auth/me')
        ? json({ user: null })
        : json({
            user: {
              id: '1',
              name: 'Ana',
              email: 'admin@karga.ao',
              role: 'ADMIN',
              companyId: 'c1',
              companyName: 'Karga',
            },
          }),
    );

    await utilizador.type(screen.getByLabelText('Email'), 'admin@karga.ao');
    await utilizador.type(screen.getByLabelText('Palavra-passe'), 'Karga2026!');
    await utilizador.click(screen.getByRole('button', { name: 'Entrar' }));

    await waitFor(() => {
      const pedidoLogin = fetchMock.mock.calls.find((chamada) =>
        String(chamada[0]).includes('/api/auth/login'),
      );
      expect(pedidoLogin).toBeDefined();
      expect(JSON.parse(String(pedidoLogin?.[1]?.body))).toEqual({
        email: 'admin@karga.ao',
        password: 'Karga2026!',
      });
    });
  });

  it('shows the reason the API gave for refusing', async () => {
    const utilizador = userEvent.setup();
    montar((url) =>
      url.includes('/api/auth/me')
        ? json({ user: null })
        : json(
            { error: { code: 'UNAUTHENTICATED', message: 'Email ou palavra-passe incorrectos.' } },
            401,
          ),
    );

    await utilizador.type(screen.getByLabelText('Email'), 'admin@karga.ao');
    await utilizador.type(screen.getByLabelText('Palavra-passe'), 'errada');
    await utilizador.click(screen.getByRole('button', { name: 'Entrar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Email ou palavra-passe incorrectos.');
  });

  it('explains a lockout rather than repeating "erro"', async () => {
    const utilizador = userEvent.setup();
    montar((url) =>
      url.includes('/api/auth/me')
        ? json({ user: null })
        : json(
            {
              error: {
                code: 'RATE_LIMITED',
                message: 'Demasiadas tentativas falhadas. Espera 15 minutos antes de tentar de novo.',
              },
            },
            429,
          ),
    );

    await utilizador.type(screen.getByLabelText('Email'), 'admin@karga.ao');
    await utilizador.type(screen.getByLabelText('Palavra-passe'), 'errada');
    await utilizador.click(screen.getByRole('button', { name: 'Entrar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('15 minutos');
  });

  it('fills the form from a demo account button', async () => {
    const utilizador = userEvent.setup();
    montar(() => json({ user: null }));

    await utilizador.click(screen.getByRole('button', { name: /Operador/ }));

    expect(screen.getByLabelText('Email')).toHaveValue('operador@karga.ao');
    expect(screen.getByLabelText('Palavra-passe')).toHaveValue('Karga2026!');
  });
});
