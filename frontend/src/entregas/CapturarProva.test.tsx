import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '../api/client';
import { instalarCanvasFalso } from '../test/canvasFalso';
import { ToastProvider } from '../ui/Toast';
import { CapturarProva } from './CapturarProva';

/**
 * Capturing proof at a door.
 *
 * What is worth testing here is not that a button exists. It is that a photograph is shrunk
 * before it goes up, that the position is attached when the phone has one and left out when
 * it does not, that a signature cannot be sent empty, and that the server's own words reach
 * the driver when it refuses. Every one of those is a thing that would fail silently in the
 * situation the feature exists for: one hand, one bar of signal, a customer waiting.
 */

const TALATONA = { latitude: -8.9167, longitude: 13.1833, accuracy: 11 };

const PROVA = {
  id: 'p1',
  kind: 'FOTO' as const,
  mimeType: 'image/jpeg',
  byteSize: 1024,
  sha256: 'a'.repeat(64),
  uploadedBy: 'Manuel (manuel@karga.ao)',
  storedAt: new Date().toISOString(),
  url: '/api/orders/o1/proofs/p1/file',
};

let anexada: ReturnType<typeof vi.fn>;

const montar = () => {
  anexada = vi.fn();
  render(
    <ToastProvider>
      <CapturarProva orderId="o1" onAnexada={anexada} />
    </ToastProvider>,
  );
};

/** The file a camera hands over: a few megabytes with a JPEG type. */
const fotografia = () =>
  new File([new Uint8Array(2 * 1024 * 1024)], 'IMG_2043.jpg', { type: 'image/jpeg' });

const comPosicao = (coords = TALATONA) => {
  vi.stubGlobal('navigator', {
    ...navigator,
    geolocation: {
      getCurrentPosition: vi.fn((ok: (p: unknown) => void) => {
        ok({ coords, timestamp: Date.now() });
      }),
    },
  });
};

const semPosicao = () => {
  vi.stubGlobal('navigator', {
    ...navigator,
    geolocation: {
      // The browser's failure path: no fix, a timeout, or a refused permission.
      getCurrentPosition: vi.fn((_ok: unknown, falhou: (e: unknown) => void) => {
        falhou({ code: 3, message: 'Timeout' });
      }),
    },
  });
};

beforeEach(() => {
  instalarCanvasFalso();
  vi.spyOn(api, 'addProof').mockResolvedValue({ proof: PROVA });
  comPosicao();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('a fotografia', () => {
  it('sobe reduzida, como JPEG, com a posição e a hora da captura', async () => {
    montar();

    await userEvent.upload(screen.getByLabelText<HTMLInputElement>(/fotografar a entrega/i), fotografia());

    await waitFor(() => expect(api.addProof).toHaveBeenCalledTimes(1));

    const argumentos = vi.mocked(api.addProof).mock.calls[0]?.[1];
    expect(argumentos?.kind).toBe('FOTO');
    expect(argumentos?.nome).toBe('prova.jpg');
    // Re-encoded, not forwarded: what goes up is the canvas output, which is a fraction of
    // the two megabytes that came in.
    expect(argumentos?.ficheiro.type).toBe('image/jpeg');
    expect(argumentos?.ficheiro.size).toBeLessThan(1024);
    expect(argumentos).toMatchObject({
      latitude: TALATONA.latitude,
      longitude: TALATONA.longitude,
      accuracyMeters: 11,
    });
    expect(argumentos?.capturedAt).toBeDefined();

    expect(anexada).toHaveBeenCalledWith(PROVA);
    expect(await screen.findByText(/fotografia anexada/i)).toBeInTheDocument();
  });

  it('sobe sem posição quando o telefone não consegue localizar, e diz-lo', async () => {
    semPosicao();
    montar();

    await userEvent.upload(screen.getByLabelText<HTMLInputElement>(/fotografar a entrega/i), fotografia());

    await waitFor(() => expect(api.addProof).toHaveBeenCalledTimes(1));

    const argumentos = vi.mocked(api.addProof).mock.calls[0]?.[1];
    expect(argumentos?.latitude).toBeUndefined();
    expect(argumentos?.accuracyMeters).toBeUndefined();

    // The proof still counts, and the interface says what it is missing instead of
    // implying the upload half-worked.
    expect(await screen.findByText(/guardada sem posição/i)).toBeInTheDocument();
  });

  it('não envia nada quando o ficheiro não é uma imagem', async () => {
    montar();

    const naoImagem = new File(['texto qualquer'], 'notas.txt', { type: 'text/plain' });
    // `applyAccept: false` on purpose: the accept attribute filters the picker, but an
    // Android camera intent can still hand back something that will not decode, and that
    // is the case this branch exists for.
    await userEvent.upload(
      screen.getByLabelText<HTMLInputElement>(/fotografar a entrega/i),
      naoImagem,
      { applyAccept: false },
    );

    expect(await screen.findByText(/não foi possível ler esta imagem/i)).toBeInTheDocument();
    expect(api.addProof).not.toHaveBeenCalled();
  });

  it('mostra a recusa do servidor pelas palavras dele', async () => {
    vi.mocked(api.addProof).mockRejectedValue(
      new ApiError(413, {
        error: { code: 'PAYLOAD_TOO_LARGE', message: 'A imagem é demasiado grande. O limite é 5 MB por prova.' },
      }),
    );
    montar();

    await userEvent.upload(screen.getByLabelText<HTMLInputElement>(/fotografar a entrega/i), fotografia());

    expect(await screen.findByText(/demasiado grande/i)).toBeInTheDocument();
    expect(anexada).not.toHaveBeenCalled();
  });
});

describe('a assinatura', () => {
  it('só pode ser anexada depois de alguém assinar', async () => {
    montar();

    const botao = screen.getByRole('button', { name: /anexar assinatura/i });
    expect(botao).toBeDisabled();

    await assinar();

    expect(screen.getByRole('button', { name: /anexar assinatura/i })).toBeEnabled();
    expect(screen.getByText(/assinado/i)).toBeInTheDocument();
  });

  it('sobe como PNG', async () => {
    montar();
    await assinar();

    await userEvent.click(screen.getByRole('button', { name: /anexar assinatura/i }));

    await waitFor(() => expect(api.addProof).toHaveBeenCalledTimes(1));
    const argumentos = vi.mocked(api.addProof).mock.calls[0]?.[1];
    expect(argumentos?.kind).toBe('ASSINATURA');
    expect(argumentos?.nome).toBe('assinatura.png');
    expect(argumentos?.ficheiro.type).toBe('image/png');
  });

  it('limpa o que foi assinado e volta a bloquear o envio', async () => {
    montar();
    await assinar();

    await userEvent.click(screen.getByRole('button', { name: /limpar/i }));

    expect(screen.getByRole('button', { name: /anexar assinatura/i })).toBeDisabled();
    expect(screen.getByText(/pede a quem recebe para assinar/i)).toBeInTheDocument();
  });
});

/** A finger crossing the box: press, drag, release. */
const assinar = async (): Promise<void> => {
  const area = screen.getByRole('img', { name: /área de assinatura/i });
  await userEvent.pointer([
    { target: area, coords: { clientX: 20, clientY: 30 }, keys: '[MouseLeft>]' },
    { target: area, coords: { clientX: 90, clientY: 60 } },
    { keys: '[/MouseLeft]' },
  ]);
};
