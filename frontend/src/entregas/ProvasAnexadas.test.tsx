import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { DeliveryProof } from '../api/client';
import { ProvasAnexadas } from './ProvasAnexadas';

/**
 * What the evidence says, and what it admits it does not say.
 *
 * The assertions here are all about honesty, because that is where this component earns its
 * place: a proof with no position must say so rather than leave a gap, a position must carry
 * its accuracy rather than pass for a certainty, and a photograph the phone dated at 15:41
 * but the server received at 18:10 must show both - that gap is the first thing anybody asks
 * about when a delivery is disputed.
 */

const base: DeliveryProof = {
  id: 'p1',
  kind: 'FOTO',
  mimeType: 'image/jpeg',
  byteSize: 240_000,
  sha256: 'abc123def456' + '0'.repeat(52),
  driverName: 'Manuel Cardoso',
  uploadedBy: 'Manuel Cardoso (manuel@karga.ao)',
  latitude: -8.9167,
  longitude: 13.1833,
  accuracyMeters: 12,
  capturedAt: '2026-09-17T14:41:00.000Z',
  storedAt: '2026-09-17T14:41:20.000Z',
  url: '/api/orders/o1/proofs/p1/file',
};

describe('ProvasAnexadas', () => {
  it('explica o que falta quando não há prova nenhuma', () => {
    render(<ProvasAnexadas provas={[]} />);

    expect(screen.getByText(/ainda sem prova/i)).toBeInTheDocument();
    // And says what the consequence is, rather than leaving an empty box.
    expect(screen.getByText(/só pode ser fechada/i)).toBeInTheDocument();
  });

  it('mostra a posição com a precisão ao lado', () => {
    render(<ProvasAnexadas provas={[base]} />);

    expect(screen.getByText(/-8\.91670, 13\.18330 · ±12 m/)).toBeInTheDocument();
    expect(screen.getByText('Fotografia')).toBeInTheDocument();
    expect(screen.getByText('Manuel Cardoso')).toBeInTheDocument();
  });

  it('diz "sem posição" em vez de deixar um espaço vazio', () => {
    const semPonto: DeliveryProof = { ...base };
    delete (semPonto as { latitude?: number }).latitude;
    delete (semPonto as { longitude?: number }).longitude;
    delete (semPonto as { accuracyMeters?: number }).accuracyMeters;

    render(<ProvasAnexadas provas={[semPonto]} />);

    expect(screen.getByText(/sem posição/i)).toBeInTheDocument();
  });

  it('mostra as duas horas quando o telefone e o servidor discordam', () => {
    const atrasada: DeliveryProof = {
      ...base,
      capturedAt: '2026-09-17T14:41:00.000Z',
      // Uploaded three hours later, back in coverage.
      storedAt: '2026-09-17T17:52:00.000Z',
    };

    render(<ProvasAnexadas provas={[atrasada]} />);

    expect(screen.getByText(/recebida/i)).toBeInTheDocument();
  });

  it('não inventa uma segunda hora quando as duas são a mesma', () => {
    render(<ProvasAnexadas provas={[base]} />);

    expect(screen.queryByText(/recebida/i)).not.toBeInTheDocument();
  });

  it('abre a prova em grande, com o início do hash para se distinguir de outra igual', async () => {
    const assinatura: DeliveryProof = { ...base, id: 'p2', kind: 'ASSINATURA' };
    render(<ProvasAnexadas provas={[base, assinatura]} />);

    expect(screen.getByText('Prova de entrega · 2')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /ver fotografia/i }));

    const dialogo = screen.getByRole('dialog');
    expect(dialogo).toBeInTheDocument();
    expect(screen.getByAltText(/fotografia da entrega/i)).toHaveAttribute('src', base.url);
    expect(screen.getByText(/sha256 abc123def456/)).toBeInTheDocument();
  });
});
