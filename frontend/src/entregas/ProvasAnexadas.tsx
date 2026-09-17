import { useState } from 'react';
import { Camera, MapPin, PenLine } from 'lucide-react';
import type { DeliveryProof } from '../api/client';
import { Card } from '../ui/Card';
import { Modal } from '../ui/Modal';
import { formatQuando } from '../utils/format';
import './ProvasAnexadas.css';

/**
 * The evidence, read by whoever is looking at the delivery.
 *
 * The job here is to be honest about what each proof does and does not say. A photograph is
 * shown with the time the phone claimed, and when the server received it minutes or hours
 * later, both are shown, because the gap is the interesting part in a dispute. A position
 * comes with its accuracy in metres rather than as a bare pin, since a point good to two
 * kilometres and a point good to ten look identical on a map and mean very different
 * things. And a proof with no position says so, instead of leaving a blank that reads like
 * an omission.
 */

const ICONE = {
  FOTO: Camera,
  ASSINATURA: PenLine,
} as const;

const NOME = {
  FOTO: 'Fotografia',
  ASSINATURA: 'Assinatura',
} as const;

/** Two timestamps only warrant a sentence when they actually disagree. */
const UM_MINUTO = 60_000;

const legendaDeTempo = (prova: DeliveryProof): string => {
  if (prova.capturedAt === undefined) return `Recebida ${formatQuando(prova.storedAt)}`;

  const diferenca = Math.abs(
    new Date(prova.storedAt).getTime() - new Date(prova.capturedAt).getTime(),
  );
  if (diferenca < UM_MINUTO) return formatQuando(prova.capturedAt);

  // The phone said one thing and the server received it later: a driver back in coverage,
  // or a clock that is wrong. Either way it is shown rather than smoothed over.
  return `${formatQuando(prova.capturedAt)}, recebida ${formatQuando(prova.storedAt)}`;
};

const legendaDeLugar = (prova: DeliveryProof): string => {
  if (prova.latitude === undefined || prova.longitude === undefined) return 'Sem posição';

  const ponto = `${prova.latitude.toFixed(5)}, ${prova.longitude.toFixed(5)}`;
  return prova.accuracyMeters === undefined
    ? ponto
    : `${ponto} · ±${Math.round(prova.accuracyMeters)} m`;
};

export const ProvasAnexadas = ({ provas }: { readonly provas: readonly DeliveryProof[] }) => {
  const [aberta, setAberta] = useState<DeliveryProof | null>(null);

  return (
    <Card title={provas.length === 0 ? 'Prova de entrega' : `Prova de entrega · ${provas.length}`}>
      {provas.length === 0 ? (
        <p className="provas__vazio">
          Ainda sem prova. Uma entrega só pode ser fechada depois de ter uma fotografia ou a
          assinatura de quem recebeu.
        </p>
      ) : (
        <ul className="provas">
          {provas.map((prova) => {
            const Icone = ICONE[prova.kind];
            return (
              <li className="provas__item" key={prova.id}>
                <button
                  type="button"
                  className="provas__miniatura"
                  onClick={() => setAberta(prova)}
                  aria-label={`Ver ${NOME[prova.kind].toLowerCase()} de ${legendaDeTempo(prova)}`}
                >
                  {/* Lazy, because a delivery can carry several and they are below the
                      fold on a phone. */}
                  <img src={prova.url} alt="" loading="lazy" />
                </button>
                <div className="provas__dados">
                  <p className="provas__tipo">
                    <Icone size={14} aria-hidden="true" /> {NOME[prova.kind]}
                  </p>
                  <p className="provas__quando">{legendaDeTempo(prova)}</p>
                  <p className="provas__onde">
                    <MapPin size={12} aria-hidden="true" /> {legendaDeLugar(prova)}
                  </p>
                  <p className="provas__quem">{prova.driverName ?? prova.uploadedBy}</p>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <Modal
        open={aberta !== null}
        title={aberta !== null ? NOME[aberta.kind] : ''}
        description={aberta !== null ? `${legendaDeTempo(aberta)} · ${legendaDeLugar(aberta)}` : ''}
        onClose={() => setAberta(null)}
      >
        {aberta !== null ? (
          <figure className="provas__grande">
            <img src={aberta.url} alt={`${NOME[aberta.kind]} da entrega`} />
            <figcaption>
              {aberta.driverName ?? aberta.uploadedBy}
              {/* The hash prefix is how somebody can tell two near-identical photographs
                  apart, and how they can check that a file was not swapped. */}
              <span className="provas__hash">sha256 {aberta.sha256.slice(0, 12)}</span>
            </figcaption>
          </figure>
        ) : null}
      </Modal>
    </Card>
  );
};
