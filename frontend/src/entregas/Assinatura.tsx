import { useCallback, useEffect, useRef, useState } from 'react';
import { Eraser } from 'lucide-react';
import { Button } from '../ui/Button';
import './Assinatura.css';

/**
 * A finger on a phone, standing at a door.
 *
 * Pointer events rather than touch or mouse events: one code path covers a finger, a stylus
 * and the mouse an operator uses at a desk, and `setPointerCapture` keeps a stroke that
 * wanders off the edge of the box attached to it instead of ending in mid-air.
 *
 * The canvas is sized from its own layout box multiplied by the device pixel ratio, so a
 * signature on a phone is not a blurry upscale of a 300 px bitmap. It is painted white
 * rather than left transparent, because it is encoded as PNG and a transparent signature
 * viewed on a dark background is invisible ink.
 */

/** Wide enough to read once the signature is scaled down in a list. */
const ESPESSURA = 2.4;

interface Props {
  readonly onDesenhar: (temTraco: boolean) => void;
  /** Called with the signature as a PNG, or null when the box is empty. */
  readonly registarLeitor: (ler: () => Promise<Blob | null>) => void;
}

export const Assinatura = ({ onDesenhar, registarLeitor }: Props) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const desenhando = useRef(false);
  const [temTraco, setTemTraco] = useState(false);

  const contexto = (): CanvasRenderingContext2D | null =>
    canvasRef.current?.getContext('2d') ?? null;

  const limpar = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = contexto();
    if (canvas === null || ctx === null) return;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    setTemTraco(false);
    onDesenhar(false);
  }, [onDesenhar]);

  // Sized once, on mount. Resizing the canvas clears it, so a phone rotating mid-signature
  // would wipe what the customer just wrote; the box has a fixed aspect ratio in CSS for
  // that reason.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;

    const caixa = canvas.getBoundingClientRect();
    const densidade = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(caixa.width * densidade));
    canvas.height = Math.max(1, Math.round(caixa.height * densidade));

    const ctx = canvas.getContext('2d');
    if (ctx === null) return;
    ctx.scale(densidade, densidade);
    ctx.lineWidth = ESPESSURA;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#111827';
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }, []);

  useEffect(() => {
    registarLeitor(async () => {
      const canvas = canvasRef.current;
      if (canvas === null || !temTraco) return null;
      return new Promise<Blob | null>((resolver) => {
        canvas.toBlob(resolver, 'image/png');
      });
    });
  }, [registarLeitor, temTraco]);

  const pontoDe = (evento: React.PointerEvent<HTMLCanvasElement>): { x: number; y: number } => {
    const caixa = evento.currentTarget.getBoundingClientRect();
    return { x: evento.clientX - caixa.left, y: evento.clientY - caixa.top };
  };

  const comecar = (evento: React.PointerEvent<HTMLCanvasElement>): void => {
    const ctx = contexto();
    if (ctx === null) return;

    evento.currentTarget.setPointerCapture(evento.pointerId);
    desenhando.current = true;
    const { x, y } = pontoDe(evento);
    ctx.beginPath();
    ctx.moveTo(x, y);
    // A dot is a signature too - an X, an initial - so the first press already counts.
    ctx.lineTo(x, y);
    ctx.stroke();

    if (!temTraco) {
      setTemTraco(true);
      onDesenhar(true);
    }
  };

  const mover = (evento: React.PointerEvent<HTMLCanvasElement>): void => {
    if (!desenhando.current) return;
    const ctx = contexto();
    if (ctx === null) return;

    const { x, y } = pontoDe(evento);
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const terminar = (): void => {
    desenhando.current = false;
  };

  return (
    <div className="assinatura">
      <canvas
        ref={canvasRef}
        className="assinatura__area"
        // The label is what a screen reader announces; the hint below is what everybody
        // else reads.
        aria-label="Área de assinatura. Assina com o dedo."
        role="img"
        onPointerDown={comecar}
        onPointerMove={mover}
        onPointerUp={terminar}
        onPointerCancel={terminar}
      />
      <div className="assinatura__pe">
        <p className="assinatura__dica">
          {temTraco ? 'Assinado. Podes limpar e assinar de novo.' : 'Pede a quem recebe para assinar aqui.'}
        </p>
        <Button icon={<Eraser size={14} />} onClick={limpar} disabled={!temTraco}>
          Limpar
        </Button>
      </div>
    </div>
  );
};
