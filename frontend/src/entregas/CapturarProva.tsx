import { useRef, useState } from 'react';
import { Camera, Loader2, PenLine, Upload } from 'lucide-react';
import { ApiError, api, type DeliveryProof } from '../api/client';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { useToast } from '../ui/Toast';
import { Assinatura } from './Assinatura';
import { posicaoAgora, reduzirImagem } from './reduzirImagem';
import './CapturarProva.css';

/**
 * Where a delivery gets its evidence.
 *
 * Everything here is shaped by the situation it is used in: one hand holding a parcel, a
 * phone in the other, a customer waiting, and a connection that may be one bar. So the
 * photograph is taken with the camera rather than picked from a gallery, it is shrunk
 * before it is sent, the position is asked for once and never blocks the upload, and every
 * refusal is shown in the words the server used - "a imagem é demasiado grande" is
 * something a driver can act on, "erro ao enviar" is not.
 *
 * The two proofs are offered side by side and either is enough, which mirrors the rule the
 * API enforces. A camera that will not focus in a dark stairwell must not be able to strand
 * a driver who has already handed the parcel over.
 */

interface Props {
  readonly orderId: string;
  readonly onAnexada: (prova: DeliveryProof) => void;
}

export const CapturarProva = ({ orderId, onAnexada }: Props) => {
  const aviso = useToast();
  const lerAssinatura = useRef<(() => Promise<Blob | null>) | null>(null);

  const [aEnviar, setAEnviar] = useState<'FOTO' | 'ASSINATURA' | null>(null);
  const [assinado, setAssinado] = useState(false);
  const [semPosicao, setSemPosicao] = useState(false);

  const enviar = async (
    kind: 'FOTO' | 'ASSINATURA',
    blob: Blob,
    nome: string,
  ): Promise<void> => {
    setAEnviar(kind);
    try {
      // Asked for here rather than kept in state: the point that matters is where the
      // phone is at the moment of the proof, not where it was when the page loaded.
      const posicao = await posicaoAgora();
      setSemPosicao(posicao === null);

      const { proof } = await api.addProof(orderId, {
        kind,
        ficheiro: blob,
        nome,
        ...(posicao !== null
          ? {
              latitude: posicao.coords.latitude,
              longitude: posicao.coords.longitude,
              accuracyMeters: posicao.coords.accuracy,
            }
          : {}),
        capturedAt: new Date().toISOString(),
      });

      aviso.sucesso(kind === 'FOTO' ? 'Fotografia anexada.' : 'Assinatura anexada.');
      onAnexada(proof);
    } catch (falha) {
      aviso.erro(
        falha instanceof ApiError
          ? falha.message
          : 'Não foi possível enviar a prova. Verifica a ligação e tenta de novo.',
      );
    } finally {
      setAEnviar(null);
    }
  };

  const escolherFicheiro = async (ficheiro: File): Promise<void> => {
    const reduzida = await reduzirImagem(ficheiro);
    if (reduzida === null) {
      aviso.erro('Não foi possível ler esta imagem. Tira a fotografia com a câmara do telefone.');
      return;
    }
    await enviar('FOTO', reduzida.blob, reduzida.nome);
  };

  const enviarAssinatura = async (): Promise<void> => {
    const blob = await lerAssinatura.current?.();
    if (blob === null || blob === undefined) {
      aviso.erro('A assinatura está vazia.');
      return;
    }
    await enviar('ASSINATURA', blob, 'assinatura.png');
  };

  // Titled for the action, not the subject. The card listing what is already attached is the
  // one called "Prova de entrega", and the two sit one under the other on a driver's screen;
  // two cards with the same heading would read as the page repeating itself.
  return (
    <Card title="Anexar prova">
      <p className="prova-captura__intro">
        Uma fotografia da entrega ou a assinatura de quem recebe. Basta uma das duas.
      </p>
      <div className="prova-captura">
        <div className="prova-captura__foto">
          {/*
            The label wraps the input rather than pointing a button at it. That way there
            is one control instead of two: the input is what a screen reader announces,
            "Fotografar a entrega" is its name, and a tap anywhere on the label opens the
            camera without any JavaScript in between.
          */}
          <label className="btn prova-captura__botao" data-variant="primary" data-size="md">
            {aEnviar === 'FOTO' ? (
              <Loader2 className="btn__spinner" size={16} aria-hidden="true" />
            ) : (
              <Camera size={16} aria-hidden="true" />
            )}
            Fotografar a entrega
            <input
              type="file"
              className="prova-captura__input"
              // `capture` opens the camera on a phone instead of the gallery, which is what
              // a driver at a door wants; on a desktop it is ignored and the picker opens.
              accept="image/jpeg,image/png,image/webp"
              capture="environment"
              disabled={aEnviar !== null}
              onChange={(evento) => {
                const ficheiro = evento.target.files?.[0];
                // Reset first: picking the same file twice must fire the change again.
                evento.target.value = '';
                if (ficheiro !== undefined) void escolherFicheiro(ficheiro);
              }}
            />
          </label>
          <p className="prova-captura__nota">
            A fotografia é reduzida no telefone antes de subir, para gastar menos dados.
          </p>
        </div>

        <div className="prova-captura__assinatura">
          <h4 className="prova-captura__titulo">
            <PenLine size={14} aria-hidden="true" /> Assinatura
          </h4>
          <Assinatura
            onDesenhar={setAssinado}
            registarLeitor={(ler) => {
              lerAssinatura.current = ler;
            }}
          />
          <Button
            icon={<Upload size={16} />}
            loading={aEnviar === 'ASSINATURA'}
            disabled={!assinado}
            onClick={() => void enviarAssinatura()}
          >
            Anexar assinatura
          </Button>
        </div>
      </div>

      {semPosicao ? (
        <p className="prova-captura__aviso">
          A última prova foi guardada sem posição: o telefone não conseguiu localizar-te. A prova
          vale, apenas não diz onde foi tirada.
        </p>
      ) : null}
    </Card>
  );
};
